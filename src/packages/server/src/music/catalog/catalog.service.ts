import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { nowISO } from '@mu/shared';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
	albumArtists,
	albumGenres,
	albums,
	artistGenres,
	artists,
	musicGenres,
	trackArtists,
	trackFiles,
	tracks,
} from '../../database/schema/index.js';
import { EntityLifecycleService } from '../../entities/entity-lifecycle.service.js';
import { albumArtistCredit, albumGroupKey } from '../ingest/grouping.js';
import { normKey, sortName, titleKey } from '../ingest/normalize.js';
import type { TrackTags } from '../ingest/tags.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { ArtworkService } from './artwork.service.js';

export type IngestResult =
	| { status: 'added'; trackId: string; albumId: string; newAlbum: boolean }
	| { status: 'attached'; trackId: string; albumId: string }
	| { status: 'updated'; trackId: string; albumId: string }
	| { status: 'skipped-duration' };

const FOLDER_ART = [
	'cover.jpg',
	'cover.png',
	'folder.jpg',
	'folder.png',
	'front.jpg',
	'front.png',
	'album.jpg',
];

/**
 * Writes one tagged audio file into the catalogue: artist → album → track →
 * track_file, find-or-create at every level so re-scans are idempotent.
 */
@Injectable()
export class MusicCatalogService {
	private readonly logger = new Logger('MusicCatalog');

	constructor(
		private readonly database: DatabaseService,
		private readonly artwork: ArtworkService,
		private readonly musicSettings: MusicSettingsService,
		@Optional() private readonly lifecycle?: EntityLifecycleService,
	) {}

	/** Find-or-create an artist by MBID, else by normalised name. */
	findOrCreateArtist(name: string, mbid: string | null): string {
		const db = this.database.db;
		if (mbid) {
			const byMbid = db
				.select({ id: artists.id })
				.from(artists)
				.where(eq(artists.mbid, mbid))
				.get();
			if (byMbid) return byMbid.id;
		}
		const norm = normKey(name);
		const byName = db
			.select({ id: artists.id, mbid: artists.mbid })
			.from(artists)
			.where(eq(artists.normName, norm))
			.get();
		if (byName) {
			if (mbid && !byName.mbid)
				db.update(artists).set({ mbid }).where(eq(artists.id, byName.id)).run();
			return byName.id;
		}
		const id = randomUUID();
		const now = nowISO();
		db.insert(artists)
			.values({
				id,
				name,
				sortName: sortName(name),
				normName: norm,
				mbid,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		return id;
	}

	private findOrCreateGenre(name: string): string {
		const norm = normKey(name);
		const row = this.database.db
			.select({ id: musicGenres.id })
			.from(musicGenres)
			.where(eq(musicGenres.normName, norm))
			.get();
		if (row) return row.id;
		const id = randomUUID();
		this.database.db
			.insert(musicGenres)
			.values({ id, name, normName: norm })
			.onConflictDoNothing()
			.run();
		return (
			this.database.db
				.select({ id: musicGenres.id })
				.from(musicGenres)
				.where(eq(musicGenres.normName, norm))
				.get()?.id ?? id
		);
	}

	async ingest(
		sourceId: string,
		filePath: string,
		tags: TrackTags,
		file: { size: number; modifiedAt: string },
		opts: { uploadedBy?: string | null } = {},
	): Promise<IngestResult> {
		const settings = this.musicSettings.get();
		if (
			tags.durationSeconds != null &&
			tags.durationSeconds > 0 &&
			tags.durationSeconds < settings.minDurationSeconds
		) {
			return { status: 'skipped-duration' };
		}

		const db = this.database.db;
		const groupKey = albumGroupKey(tags, filePath, settings.grouping);
		const credit = albumArtistCredit(tags);
		const now = nowISO();

		const result = db.transaction(() => {
			// ── Album ──────────────────────────────────────────────────────
			let album = db
				.select({
					id: albums.id,
					artId: albums.artId,
					year: albums.year,
					artistCredit: albums.artistCredit,
					isCompilation: albums.isCompilation,
				})
				.from(albums)
				.where(eq(albums.groupKey, groupKey))
				.get();
			let newAlbum = false;
			if (!album) {
				const id = randomUUID();
				const title = tags.album ?? '(Unknown Album)';
				db.insert(albums)
					.values({
						id,
						title,
						sortTitle: sortName(title),
						normTitle: normKey(title),
						mbidReleaseGroup: tags.mbid.releaseGroup,
						isCompilation: credit.various,
						primaryType: credit.various ? 'compilation' : 'album',
						year: tags.year,
						originalYear: tags.originalYear,
						artistCredit: credit.credit,
						folderPath: dirname(filePath),
						groupKey,
						addedAt: now,
						updatedAt: now,
					})
					.run();
				credit.names.forEach((name, i) => {
					const artistId = this.findOrCreateArtist(
						name,
						tags.mbid.albumArtists[i] ?? null,
					);
					db.insert(albumArtists)
						.values({ albumId: id, artistId, role: 'primary', position: i })
						.onConflictDoNothing()
						.run();
				});
				for (const g of tags.genres) {
					const genreId = this.findOrCreateGenre(g);
					db.insert(albumGenres)
						.values({ albumId: id, genreId })
						.onConflictDoNothing()
						.run();
				}
				album = {
					id,
					artId: null,
					year: tags.year,
					artistCredit: credit.credit,
					isCompilation: credit.various,
				};
				newAlbum = true;
			} else {
				if (album.year == null && tags.year != null) {
					db.update(albums)
						.set({ year: tags.year, updatedAt: now })
						.where(eq(albums.id, album.id))
						.run();
				}
				// Untagged compilation: a second performer turned up on an album
				// whose credit came from the first track's artist. Promote it to
				// "Various Artists" rather than crediting it all to one performer.
				if (
					!album.isCompilation &&
					!tags.albumArtistCredit &&
					album.artistCredit &&
					normKey(album.artistCredit) !== normKey(credit.credit)
				) {
					db.update(albums)
						.set({
							isCompilation: true,
							primaryType: 'compilation',
							artistCredit: 'Various Artists',
							updatedAt: now,
						})
						.where(eq(albums.id, album.id))
						.run();
					db.delete(albumArtists).where(eq(albumArtists.albumId, album.id)).run();
					album = { ...album, isCompilation: true, artistCredit: 'Various Artists' };
				}
			}

			// ── Track (same album + disc + number + title ⇒ same track) ─────
			const tKey = titleKey(tags.title);
			const candidates = db
				.select({
					id: tracks.id,
					normTitle: tracks.normTitle,
					trackNo: tracks.trackNo,
					discNo: tracks.discNo,
				})
				.from(tracks)
				.where(eq(tracks.albumId, album.id))
				.all();
			let track = candidates.find(
				(c) =>
					c.normTitle === tKey &&
					(c.discNo ?? 1) === tags.discNo &&
					(c.trackNo == null || tags.trackNo == null || c.trackNo === tags.trackNo),
			);
			let attached = false;
			if (!track) {
				const id = randomUUID();
				db.insert(tracks)
					.values({
						id,
						albumId: album.id,
						title: tags.title,
						normTitle: tKey,
						discNo: tags.discNo,
						trackNo: tags.trackNo,
						durationSeconds: tags.durationSeconds,
						artistCredit: tags.artistCredit,
						mbidRecording: tags.mbid.recording,
						isrc: tags.isrc,
						addedAt: now,
						updatedAt: now,
					})
					.run();
				const roles: [string, string, string | null][] = [
					...tags.artists.map(
						(n, i) =>
							[n, 'primary', tags.mbid.artists[i] ?? null] as [
								string,
								string,
								string | null,
							],
					),
					...tags.featured.map(
						(n) => [n, 'featured', null] as [string, string, string | null],
					),
					...tags.composer.map(
						(n) => [n, 'composer', null] as [string, string, string | null],
					),
				];
				roles.forEach(([name, role, mbid], i) => {
					const artistId = this.findOrCreateArtist(name, mbid);
					db.insert(trackArtists)
						.values({ trackId: id, artistId, role, position: i })
						.onConflictDoNothing()
						.run();
					if (role === 'primary' && tags.genres.length > 0) {
						for (const g of tags.genres) {
							db.insert(artistGenres)
								.values({ artistId, genreId: this.findOrCreateGenre(g) })
								.onConflictDoNothing()
								.run();
						}
					}
				});
				track = { id, normTitle: tKey, trackNo: tags.trackNo, discNo: tags.discNo };
			} else {
				attached = true;
			}

			// ── File ───────────────────────────────────────────────────────
			db.insert(trackFiles)
				.values({
					id: randomUUID(),
					trackId: track.id,
					sourceId,
					filePath,
					fileName: basename(filePath),
					fileSize: file.size,
					fileModifiedAt: file.modifiedAt,
					container: tags.container,
					codec: tags.codec,
					bitrate: tags.bitrate,
					sampleRate: tags.sampleRate,
					bitDepth: tags.bitDepth,
					channels: tags.channels,
					lossless: tags.lossless,
					durationSeconds: tags.durationSeconds,
					replaygainTrack: tags.replaygainTrack,
					replaygainAlbum: tags.replaygainAlbum,
					uploadedBy: opts.uploadedBy ?? null,
					available: true,
					addedAt: now,
				})
				.run();

			this.recomputeAlbumAggregates(album.id);
			return {
				trackId: track.id,
				albumId: album.id,
				newAlbum,
				attached,
				needsArt: !album.artId,
			};
		});

		if (result.needsArt) await this.attachAlbumArt(result.albumId, filePath, tags);

		return result.attached
			? { status: 'attached', trackId: result.trackId, albumId: result.albumId }
			: {
					status: 'added',
					trackId: result.trackId,
					albumId: result.albumId,
					newAlbum: result.newAlbum,
				};
	}

	/** Refresh stream facts for a file whose bytes changed (re-tag / re-encode). */
	refreshFile(
		trackFileId: string,
		tags: TrackTags,
		file: { size: number; modifiedAt: string },
	): void {
		this.database.db
			.update(trackFiles)
			.set({
				fileSize: file.size,
				fileModifiedAt: file.modifiedAt,
				container: tags.container,
				codec: tags.codec,
				bitrate: tags.bitrate,
				sampleRate: tags.sampleRate,
				bitDepth: tags.bitDepth,
				channels: tags.channels,
				lossless: tags.lossless,
				durationSeconds: tags.durationSeconds,
				replaygainTrack: tags.replaygainTrack,
				replaygainAlbum: tags.replaygainAlbum,
				waveformPath: null,
				available: true,
			})
			.where(eq(trackFiles.id, trackFileId))
			.run();
	}

	recomputeAlbumAggregates(albumId: string): void {
		const agg = this.database.db
			.select({
				count: sql<number>`count(*)`,
				total: sql<number>`coalesce(sum(${tracks.durationSeconds}), 0)`,
			})
			.from(tracks)
			.where(eq(tracks.albumId, albumId))
			.get();
		this.database.db
			.update(albums)
			.set({
				trackCount: agg?.count ?? 0,
				totalSeconds: Math.round(agg?.total ?? 0),
				updatedAt: nowISO(),
			})
			.where(eq(albums.id, albumId))
			.run();
	}

	/** Embedded picture first, then cover.jpg/folder.jpg in the album folder. */
	private async attachAlbumArt(
		albumId: string,
		filePath: string,
		tags: TrackTags,
	): Promise<void> {
		const pref = this.musicSettings.get().artPreference;
		let artId: string | null = null;
		for (const p of pref) {
			if (p === 'embedded' && tags.picture) {
				artId = await this.artwork.store(
					tags.picture.data,
					tags.picture.mime,
					'album',
					'embedded',
				);
			} else if (p === 'folder') {
				const dir = dirname(filePath);
				for (const name of FOLDER_ART) {
					const candidate = join(dir, name);
					if (existsSync(candidate)) {
						artId = await this.artwork.storeFile(candidate, 'album', 'folder');
						if (artId) break;
					}
				}
			}
			if (artId) break;
		}
		if (artId) {
			this.database.db
				.update(albums)
				.set({ artId })
				.where(and(eq(albums.id, albumId), isNull(albums.artId)))
				.run();
		}
	}

	/**
	 * Remove track_files whose source path vanished, then tracks with no files,
	 * albums with no tracks and artists with no albums/tracks. Returns the
	 * number of track_files removed.
	 */
	purgeOrphans(missingFileIds: string[]): number {
		if (missingFileIds.length === 0) return 0;
		const db = this.database.db;
		return db.transaction(() => {
			// Albums to re-aggregate must be collected BEFORE the deletes.
			const affectedAlbums = new Set(
				db
					.select({ albumId: tracks.albumId })
					.from(trackFiles)
					.innerJoin(tracks, eq(tracks.id, trackFiles.trackId))
					.where(inArray(trackFiles.id, missingFileIds))
					.all()
					.map((r) => r.albumId),
			);
			db.delete(trackFiles).where(inArray(trackFiles.id, missingFileIds)).run();
			const ids = (q: ReturnType<typeof sql>) => db.all<{ id: string }>(q).map((r) => r.id);
			const deadTracks = ids(
				sql`SELECT id FROM tracks WHERE id NOT IN (SELECT DISTINCT track_id FROM track_files)`,
			);
			db.run(
				sql`DELETE FROM tracks WHERE id NOT IN (SELECT DISTINCT track_id FROM track_files)`,
			);
			const deadAlbums = ids(
				sql`SELECT id FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)`,
			);
			db.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)`);
			const orphanArtists = sql`SELECT id FROM artists WHERE id NOT IN (SELECT artist_id FROM album_artists) AND id NOT IN (SELECT artist_id FROM track_artists)`;
			const deadArtists = ids(orphanArtists);
			db.run(
				sql`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM album_artists) AND id NOT IN (SELECT artist_id FROM track_artists)`,
			);
			// User data (ratings, comments, favorites, playlist rows, history) has
			// no FK to these tables — clean it explicitly, like a cascade would.
			this.lifecycle?.purgeMany('track', deadTracks);
			this.lifecycle?.purgeMany('album', deadAlbums);
			this.lifecycle?.purgeMany('artist', deadArtists);
			const surviving = db
				.select({ id: albums.id })
				.from(albums)
				.where(inArray(albums.id, [...affectedAlbums, '-']))
				.all();
			for (const a of surviving) this.recomputeAlbumAggregates(a.id);
			return missingFileIds.length;
		});
	}
}
