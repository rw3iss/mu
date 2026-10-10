import type {
	AlbumDetail,
	AlbumSummary,
	ArtistDetail,
	ArtistSummary,
	TrackDetail,
	TrackSummary,
} from '@mu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
	albumArtists,
	albumGenres,
	albumReleases,
	albums,
	artistGenres,
	artists,
	entityRatings,
	lyrics,
	musicGenres,
	trackArtists,
	trackFiles,
	tracks,
} from '../../database/schema/index.js';

export const artUrl = (artId: string | null | undefined, size = 600): string | null =>
	artId ? `/api/v1/music/art/${artId}?size=${size}` : null;

export type AlbumSort = 'added' | 'title' | 'artist' | 'year' | 'rating';
export type ArtistSort = 'name' | 'added' | 'albums';
export type TrackSort = 'title' | 'artist' | 'album' | 'duration' | 'added' | 'plays' | 'rating';

export interface ListQuery {
	q?: string;
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	minRating?: number;
	artistId?: string;
	sort?: string;
	order?: 'asc' | 'desc';
	page?: number;
	pageSize?: number;
}

export interface Page<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}

/** Quote user input for an FTS5 prefix query: "foo"* "bar"* */
export function ftsQuery(q: string): string | null {
	const terms = q
		.replace(/["*^:()]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 8);
	return terms.length ? terms.map((t) => `"${t}"*`).join(' ') : null;
}

/** Read side of the music catalogue: lists, detail pages, search. */
@Injectable()
export class MusicQueryService {
	constructor(private readonly database: DatabaseService) {}

	private get db() {
		return this.database.db;
	}

	private paging(q: ListQuery) {
		const pageSize = Math.min(Math.max(q.pageSize ?? 60, 1), 200);
		const page = Math.max(q.page ?? 1, 1);
		return { pageSize, page, offset: (page - 1) * pageSize };
	}

	private ftsIds(table: 'artists' | 'albums' | 'tracks', q: string | undefined): string[] | null {
		if (!q?.trim()) return null;
		const match = ftsQuery(q);
		if (!match) return null;
		const fts = sql.raw(`${table}_fts`);
		const base = sql.raw(table);
		const rows = this.db.all<{ id: string }>(
			sql`SELECT t.id AS id FROM ${fts} f JOIN ${base} t ON t.rowid = f.rowid WHERE ${fts} MATCH ${match} LIMIT 2000`,
		);
		return rows.map((r) => r.id);
	}

	private albumArtistsMap(albumIds: string[]): Map<string, { id: string; name: string }[]> {
		const map = new Map<string, { id: string; name: string }[]>();
		if (!albumIds.length) return map;
		const rows = this.db
			.select({
				albumId: albumArtists.albumId,
				id: artists.id,
				name: artists.name,
				pos: albumArtists.position,
			})
			.from(albumArtists)
			.innerJoin(artists, eq(artists.id, albumArtists.artistId))
			.where(inArray(albumArtists.albumId, albumIds))
			.orderBy(asc(albumArtists.position))
			.all();
		for (const r of rows) {
			const list = map.get(r.albumId) ?? [];
			list.push({ id: r.id, name: r.name });
			map.set(r.albumId, list);
		}
		return map;
	}

	private toAlbumSummaries(rows: (typeof albums.$inferSelect)[]): AlbumSummary[] {
		const credits = this.albumArtistsMap(rows.map((r) => r.id));
		return rows.map((a) => ({
			id: a.id,
			title: a.title,
			artistCredit: a.artistCredit,
			artists: credits.get(a.id) ?? [],
			year: a.year,
			primaryType: a.primaryType,
			artUrl: artUrl(a.artId),
			trackCount: a.trackCount ?? 0,
			totalSeconds: a.totalSeconds ?? 0,
			ratingAvg: a.ratingAvg,
			addedAt: a.addedAt,
		}));
	}

	listAlbums(q: ListQuery): Page<AlbumSummary> {
		const { page, pageSize, offset } = this.paging(q);
		const where: SQL[] = [];
		const ids = this.ftsIds('albums', q.q);
		if (ids) where.push(inArray(albums.id, ids.length ? ids : ['-']));
		if (q.yearFrom) where.push(sql`${albums.year} >= ${q.yearFrom}`);
		if (q.yearTo) where.push(sql`${albums.year} <= ${q.yearTo}`);
		if (q.minRating) where.push(sql`${albums.ratingAvg} >= ${q.minRating}`);
		if (q.genre) {
			where.push(
				sql`${albums.id} IN (SELECT ag.album_id FROM album_genres ag JOIN music_genres g ON g.id = ag.genre_id WHERE g.norm_name = lower(${q.genre}))`,
			);
		}
		if (q.artistId) {
			where.push(
				sql`${albums.id} IN (SELECT album_id FROM album_artists WHERE artist_id = ${q.artistId})`,
			);
		}
		const dir = q.order === 'asc' ? asc : desc;
		const sort = (q.sort ?? 'added') as AlbumSort;
		const orderBy =
			sort === 'title'
				? [q.order === 'desc' ? desc(albums.sortTitle) : asc(albums.sortTitle)]
				: sort === 'artist'
					? [
							q.order === 'desc'
								? desc(albums.artistCredit)
								: asc(albums.artistCredit),
							asc(albums.year),
						]
					: sort === 'year'
						? [dir(albums.year), asc(albums.sortTitle)]
						: sort === 'rating'
							? [dir(albums.ratingAvg), asc(albums.sortTitle)]
							: [dir(albums.addedAt)];
		const cond = where.length ? and(...where) : undefined;
		const total =
			this.db.select({ n: sql<number>`count(*)` }).from(albums).where(cond).get()?.n ?? 0;
		const rows = this.db
			.select()
			.from(albums)
			.where(cond)
			.orderBy(...orderBy)
			.limit(pageSize)
			.offset(offset)
			.all();
		return { items: this.toAlbumSummaries(rows), total, page, pageSize };
	}

	listArtists(q: ListQuery): Page<ArtistSummary> {
		const { page, pageSize, offset } = this.paging(q);
		const where: SQL[] = [
			// Only artists credited on at least one album (featured-only artists
			// still get pages, but don't flood the A–Z grid).
			sql`${artists.id} IN (SELECT artist_id FROM album_artists)`,
		];
		const ids = this.ftsIds('artists', q.q);
		if (ids) where.push(inArray(artists.id, ids.length ? ids : ['-']));
		if (q.genre) {
			where.push(
				sql`${artists.id} IN (SELECT ag.artist_id FROM artist_genres ag JOIN music_genres g ON g.id = ag.genre_id WHERE g.norm_name = lower(${q.genre}))`,
			);
		}
		const albumCount = sql<number>`(SELECT count(*) FROM album_artists aa WHERE aa.artist_id = ${artists.id})`;
		const sort = (q.sort ?? 'name') as ArtistSort;
		const orderBy =
			sort === 'added'
				? [desc(artists.createdAt)]
				: sort === 'albums'
					? [desc(albumCount), asc(artists.sortName)]
					: [q.order === 'desc' ? desc(artists.sortName) : asc(artists.sortName)];
		const cond = and(...where);
		const total =
			this.db.select({ n: sql<number>`count(*)` }).from(artists).where(cond).get()?.n ?? 0;
		const rows = this.db
			.select({ id: artists.id, name: artists.name, imageId: artists.imageId, albumCount })
			.from(artists)
			.where(cond)
			.orderBy(...orderBy)
			.limit(pageSize)
			.offset(offset)
			.all();
		return {
			items: rows.map((r) => ({
				id: r.id,
				name: r.name,
				imageUrl: artUrl(r.imageId, 256),
				albumCount: r.albumCount,
			})),
			total,
			page,
			pageSize,
		};
	}

	private trackSummaries(
		rows: { t: typeof tracks.$inferSelect; albumTitle: string; artId: string | null }[],
		userId?: string,
	): TrackSummary[] {
		const ids = rows.map((r) => r.t.id);
		const credits = new Map<string, { id: string; name: string; role: string }[]>();
		const ratings = new Map<string, number>();
		if (ids.length) {
			for (const c of this.db
				.select({
					trackId: trackArtists.trackId,
					id: artists.id,
					name: artists.name,
					role: trackArtists.role,
				})
				.from(trackArtists)
				.innerJoin(artists, eq(artists.id, trackArtists.artistId))
				.where(inArray(trackArtists.trackId, ids))
				.orderBy(asc(trackArtists.position))
				.all()) {
				const list = credits.get(c.trackId) ?? [];
				list.push({ id: c.id, name: c.name, role: c.role });
				credits.set(c.trackId, list);
			}
			if (userId) {
				for (const r of this.db
					.select({ id: entityRatings.entityId, rating: entityRatings.rating })
					.from(entityRatings)
					.where(
						and(
							eq(entityRatings.userId, userId),
							eq(entityRatings.entityType, 'track'),
							inArray(entityRatings.entityId, ids),
						),
					)
					.all()) {
					ratings.set(r.id, r.rating);
				}
			}
		}
		return rows.map(({ t, albumTitle, artId }) => ({
			id: t.id,
			title: t.title,
			albumId: t.albumId,
			albumTitle,
			artistCredit: t.artistCredit,
			artists: credits.get(t.id) ?? [],
			discNo: t.discNo ?? 1,
			trackNo: t.trackNo,
			durationSeconds: t.durationSeconds,
			artUrl: artUrl(artId, 256),
			ratingAvg: t.ratingAvg,
			userRating: userId ? (ratings.get(t.id) ?? null) : undefined,
			playCount: t.playCount ?? 0,
		}));
	}

	private trackRows(cond: SQL | undefined, orderBy: SQL[], limit: number, offset = 0) {
		return this.db
			.select({ t: tracks, albumTitle: albums.title, artId: albums.artId })
			.from(tracks)
			.innerJoin(albums, eq(albums.id, tracks.albumId))
			.where(cond)
			.orderBy(...orderBy)
			.limit(limit)
			.offset(offset)
			.all();
	}

	listTracks(q: ListQuery, userId?: string): Page<TrackSummary> {
		const { page, pageSize, offset } = this.paging(q);
		const where: SQL[] = [];
		const ids = this.ftsIds('tracks', q.q);
		if (ids) where.push(inArray(tracks.id, ids.length ? ids : ['-']));
		if (q.artistId)
			where.push(
				sql`${tracks.id} IN (SELECT track_id FROM track_artists WHERE artist_id = ${q.artistId})`,
			);
		if (q.minRating) where.push(sql`${tracks.ratingAvg} >= ${q.minRating}`);
		const dir = q.order === 'asc' ? asc : desc;
		const sort = (q.sort ?? 'title') as TrackSort;
		const orderBy: SQL[] =
			sort === 'artist'
				? [
						asc(tracks.artistCredit),
						asc(albums.sortTitle),
						asc(tracks.discNo),
						asc(tracks.trackNo),
					]
				: sort === 'album'
					? [asc(albums.sortTitle), asc(tracks.discNo), asc(tracks.trackNo)]
					: sort === 'duration'
						? [dir(tracks.durationSeconds)]
						: sort === 'added'
							? [dir(tracks.addedAt)]
							: sort === 'plays'
								? [desc(tracks.playCount)]
								: sort === 'rating'
									? [dir(tracks.ratingAvg)]
									: [
											q.order === 'desc'
												? desc(tracks.normTitle)
												: asc(tracks.normTitle),
										];
		const cond = where.length ? and(...where) : undefined;
		const total =
			this.db
				.select({ n: sql<number>`count(*)` })
				.from(tracks)
				.innerJoin(albums, eq(albums.id, tracks.albumId))
				.where(cond)
				.get()?.n ?? 0;
		return {
			items: this.trackSummaries(this.trackRows(cond, orderBy, pageSize, offset), userId),
			total,
			page,
			pageSize,
		};
	}

	listGenres(): { name: string; albumCount: number }[] {
		return this.db
			.select({
				name: musicGenres.name,
				albumCount: sql<number>`count(${albumGenres.albumId})`,
			})
			.from(musicGenres)
			.innerJoin(albumGenres, eq(albumGenres.genreId, musicGenres.id))
			.groupBy(musicGenres.id)
			.orderBy(desc(sql`count(${albumGenres.albumId})`))
			.all();
	}

	private userRating(type: string, id: string, userId?: string): number | null | undefined {
		if (!userId) return undefined;
		return (
			this.db
				.select({ r: entityRatings.rating })
				.from(entityRatings)
				.where(
					and(
						eq(entityRatings.userId, userId),
						eq(entityRatings.entityType, type),
						eq(entityRatings.entityId, id),
					),
				)
				.get()?.r ?? null
		);
	}

	getAlbum(id: string, userId?: string): AlbumDetail {
		const a = this.db.select().from(albums).where(eq(albums.id, id)).get();
		if (!a) throw new NotFoundException(`Album ${id} not found`);
		const [summary] = this.toAlbumSummaries([a]);
		const releases = this.db
			.select()
			.from(albumReleases)
			.where(eq(albumReleases.albumId, id))
			.all();
		const genres = this.db
			.select({ name: musicGenres.name })
			.from(albumGenres)
			.innerJoin(musicGenres, eq(musicGenres.id, albumGenres.genreId))
			.where(eq(albumGenres.albumId, id))
			.all()
			.map((g) => g.name);
		const trackList = this.trackSummaries(
			this.trackRows(
				eq(tracks.albumId, id),
				[asc(tracks.discNo), asc(tracks.trackNo), asc(tracks.normTitle)],
				1000,
			),
			userId,
		);
		return {
			...summary!,
			mbidReleaseGroup: a.mbidReleaseGroup,
			secondaryTypes: JSON.parse(a.secondaryTypes ?? '[]'),
			isCompilation: !!a.isCompilation,
			originalYear: a.originalYear,
			genres,
			label: releases[0]?.label ?? null,
			releases: releases.map((r) => ({
				id: r.id,
				label: r.label,
				country: r.country,
				releaseDate: r.releaseDate,
				mediaFormat: r.mediaFormat,
			})),
			tracks: trackList,
			userRating: this.userRating('album', id, userId),
		};
	}

	getArtist(id: string, userId?: string): ArtistDetail {
		const a = this.db.select().from(artists).where(eq(artists.id, id)).get();
		if (!a) throw new NotFoundException(`Artist ${id} not found`);
		const own = this.db
			.select()
			.from(albums)
			.where(
				sql`${albums.id} IN (SELECT album_id FROM album_artists WHERE artist_id = ${id})`,
			)
			.orderBy(desc(albums.year))
			.all();
		const ownIds = new Set(own.map((x) => x.id));
		const appears = this.db
			.select()
			.from(albums)
			.where(
				sql`${albums.id} IN (SELECT t.album_id FROM tracks t JOIN track_artists ta ON ta.track_id = t.id WHERE ta.artist_id = ${id})`,
			)
			.orderBy(desc(albums.year))
			.all()
			.filter((x) => !ownIds.has(x.id));
		const popular = this.trackSummaries(
			this.trackRows(
				sql`${tracks.id} IN (SELECT track_id FROM track_artists WHERE artist_id = ${id} AND role IN ('primary','featured'))`,
				[
					desc(tracks.playCount),
					desc(sql`coalesce(${tracks.ratingAvg}, 0)`),
					asc(tracks.normTitle),
				],
				10,
			),
			userId,
		);
		const genres = this.db
			.select({ name: musicGenres.name })
			.from(artistGenres)
			.innerJoin(musicGenres, eq(musicGenres.id, artistGenres.genreId))
			.where(eq(artistGenres.artistId, id))
			.all()
			.map((g) => g.name);
		const trackCount =
			this.db
				.select({ n: sql<number>`count(*)` })
				.from(trackArtists)
				.where(eq(trackArtists.artistId, id))
				.get()?.n ?? 0;
		return {
			id: a.id,
			name: a.name,
			sortName: a.sortName,
			imageUrl: artUrl(a.imageId, 600),
			type: a.type,
			country: a.country,
			beginYear: a.beginYear,
			endYear: a.endYear,
			disambiguation: a.disambiguation,
			bio: a.bio,
			genres,
			mbid: a.mbid,
			albumCount: own.length,
			trackCount,
			albums: this.toAlbumSummaries(own),
			appearsOn: this.toAlbumSummaries(appears),
			popularTracks: popular,
			userRating: this.userRating('artist', id, userId),
		};
	}

	getTrack(id: string, userId?: string): TrackDetail {
		const rows = this.trackRows(eq(tracks.id, id), [asc(tracks.id)], 1);
		if (!rows.length) throw new NotFoundException(`Track ${id} not found`);
		const [summary] = this.trackSummaries(rows, userId);
		const t = rows[0]!.t;
		const files = this.db
			.select()
			.from(trackFiles)
			.where(and(eq(trackFiles.trackId, id), eq(trackFiles.available, true)))
			.all();
		const lyr = this.db.select().from(lyrics).where(eq(lyrics.trackId, id)).get();
		const appears = t.mbidRecording
			? this.db
					.select()
					.from(albums)
					.where(
						and(
							sql`${albums.id} IN (SELECT album_id FROM tracks WHERE mbid_recording = ${t.mbidRecording})`,
							sql`${albums.id} <> ${t.albumId}`,
						),
					)
					.all()
			: [];
		return {
			...summary!,
			mbidRecording: t.mbidRecording,
			isrc: t.isrc,
			files: files.map((f) => ({
				id: f.id,
				container: f.container,
				codec: f.codec,
				bitrate: f.bitrate,
				sampleRate: f.sampleRate,
				bitDepth: f.bitDepth,
				channels: f.channels,
				lossless: !!f.lossless,
				fileSize: f.fileSize,
				fileName: f.fileName,
			})),
			lyrics: lyricsDto(lyr),
			appearsOn: this.toAlbumSummaries(appears),
			credits: summary!.artists.map((a) => ({ artistId: a.id, name: a.name, role: a.role })),
		};
	}

	/** Grouped quick search for the header dropdown. */
	search(
		q: string,
		limit = 8,
	): { artists: ArtistSummary[]; albums: AlbumSummary[]; tracks: TrackSummary[] } {
		return {
			artists: this.listArtists({ q, pageSize: limit }).items,
			albums: this.listAlbums({ q, pageSize: limit, sort: 'title' }).items,
			tracks: this.listTracks({ q, pageSize: limit }).items,
		};
	}

	/** Dashboard rails. */
	recentlyAdded(limit = 20): AlbumSummary[] {
		return this.toAlbumSummaries(
			this.db.select().from(albums).orderBy(desc(albums.addedAt)).limit(limit).all(),
		);
	}

	mostPlayed(limit = 20, userId?: string): TrackSummary[] {
		return this.trackSummaries(
			this.trackRows(sql`${tracks.playCount} > 0`, [desc(tracks.playCount)], limit),
			userId,
		);
	}

	/** Best playable file for a track: lossless first, then highest bitrate. */
	bestFile(trackId: string) {
		return this.db
			.select()
			.from(trackFiles)
			.where(and(eq(trackFiles.trackId, trackId), eq(trackFiles.available, true)))
			.orderBy(
				desc(trackFiles.lossless),
				desc(sql`coalesce(${trackFiles.bitDepth},0)`),
				desc(sql`coalesce(${trackFiles.bitrate},0)`),
			)
			.get();
	}

	/** Album track ids in play order (for "play album"). */
	albumTrackIds(albumId: string): string[] {
		return this.db
			.select({ id: tracks.id })
			.from(tracks)
			.where(eq(tracks.albumId, albumId))
			.orderBy(asc(tracks.discNo), asc(tracks.trackNo))
			.all()
			.map((r) => r.id);
	}

	/** Albums the user played most recently (distinct, newest first). */
	continueListening(userId: string, limit = 20): AlbumSummary[] {
		const rows = this.db.all<{ id: string }>(sql`
			SELECT t.album_id AS id FROM play_history h JOIN tracks t ON t.id = h.entity_id
			WHERE h.user_id = ${userId} AND h.entity_type = 'track'
			GROUP BY t.album_id ORDER BY max(h.last_played_at) DESC LIMIT ${limit}`);
		return this.albumsInOrder(rows.map((r) => r.id));
	}

	/** The user's favourited albums, newest first. */
	favoriteAlbums(userId: string, limit = 20): AlbumSummary[] {
		const rows = this.db.all<{ id: string }>(sql`
			SELECT entity_id AS id FROM favorites
			WHERE user_id = ${userId} AND entity_type = 'album'
			ORDER BY created_at DESC LIMIT ${limit}`);
		return this.albumsInOrder(rows.map((r) => r.id));
	}

	private albumsInOrder(ids: string[]): AlbumSummary[] {
		if (!ids.length) return [];
		const byId = new Map(
			this.db
				.select()
				.from(albums)
				.where(inArray(albums.id, ids))
				.all()
				.map((a) => [a.id, a]),
		);
		return this.toAlbumSummaries(ids.map((id) => byId.get(id)).filter((a) => !!a));
	}

	/** Re-derive the denormalised rating average for an album or track. */
	refreshRatingAggregate(type: 'album' | 'track', id: string): void {
		const agg = this.db.get<{ avg: number | null; n: number }>(sql`
			SELECT avg(rating) AS avg, count(*) AS n FROM entity_ratings
			WHERE entity_type = ${type} AND entity_id = ${id}`);
		const values = { ratingAvg: agg?.n ? agg.avg : null, ratingCount: agg?.n ?? 0 };
		if (type === 'album') this.db.update(albums).set(values).where(eq(albums.id, id)).run();
		else this.db.update(tracks).set(values).where(eq(tracks.id, id)).run();
	}

	/** Title + art for the generic entity resolver (ratings, comments, favourites). */
	entitySummary(
		type: 'artist' | 'album' | 'track',
		id: string,
	): { title: string; imageUrl: string | null; url: string } | null {
		if (type === 'artist') {
			const a = this.db.select().from(artists).where(eq(artists.id, id)).get();
			return a
				? { title: a.name, imageUrl: artUrl(a.imageId, 256), url: `/artist/${a.id}` }
				: null;
		}
		if (type === 'album') {
			const a = this.db.select().from(albums).where(eq(albums.id, id)).get();
			return a
				? { title: a.title, imageUrl: artUrl(a.artId, 256), url: `/album/${a.id}` }
				: null;
		}
		const t = this.db.select().from(tracks).where(eq(tracks.id, id)).get();
		if (!t) return null;
		const al = this.db.select().from(albums).where(eq(albums.id, t.albumId)).get();
		return {
			title: t.title,
			imageUrl: artUrl(al?.artId ?? null, 256),
			url: `/track/${t.id}`,
		};
	}

	getLyrics(trackId: string) {
		return lyricsDto(this.db.select().from(lyrics).where(eq(lyrics.trackId, trackId)).get());
	}

	saveLyrics(
		trackId: string,
		body: { plain: string | null; syncedLrc: string | null },
		userId: string,
	): void {
		if (!this.db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, trackId)).get()) {
			throw new NotFoundException('Track not found');
		}
		const values = {
			plain: body.plain?.slice(0, 100_000) || null,
			syncedLrc: body.syncedLrc?.slice(0, 200_000) || null,
			source: 'user',
			editedBy: userId,
			updatedAt: new Date().toISOString(),
		};
		this.db
			.insert(lyrics)
			.values({ trackId, ...values })
			.onConflictDoUpdate({ target: lyrics.trackId, set: values })
			.run();
	}

	/** Full list-row summaries by id (favourites, playlists). Missing ids are absent. */
	summariesById(
		type: 'artist' | 'album' | 'track',
		ids: string[],
		userId?: string,
	): Map<string, ArtistSummary | AlbumSummary | TrackSummary> {
		const out = new Map<string, ArtistSummary | AlbumSummary | TrackSummary>();
		if (!ids.length) return out;
		if (type === 'album') {
			const rows = this.db.select().from(albums).where(inArray(albums.id, ids)).all();
			for (const a of this.toAlbumSummaries(rows)) out.set(a.id, a);
		} else if (type === 'track') {
			for (const t of this.trackSummaries(
				this.trackRows(inArray(tracks.id, ids), [], ids.length),
				userId,
			))
				out.set(t.id, t);
		} else {
			const albumCount = sql<number>`(SELECT count(*) FROM album_artists aa WHERE aa.artist_id = ${artists.id})`;
			for (const r of this.db
				.select({
					id: artists.id,
					name: artists.name,
					imageId: artists.imageId,
					albumCount,
				})
				.from(artists)
				.where(inArray(artists.id, ids))
				.all()) {
				out.set(r.id, {
					id: r.id,
					name: r.name,
					imageUrl: artUrl(r.imageId, 256),
					albumCount: r.albumCount,
				});
			}
		}
		return out;
	}
}

/** Lyrics row → DTO. An empty row is a cached fetch miss, reported as "no lyrics". */
function lyricsDto(
	row: { plain: string | null; syncedLrc: string | null; source: string | null } | undefined,
) {
	if (!row || (!row.plain && !row.syncedLrc)) return null;
	return { plain: row.plain, syncedLrc: row.syncedLrc, source: row.source };
}
