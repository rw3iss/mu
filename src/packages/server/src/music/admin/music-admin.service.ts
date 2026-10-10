import type { MusicAdminActionResult } from '@mu/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { albums, mediaSources, trackFiles } from '../../database/schema/index.js';
import { EntityLifecycleService } from '../../entities/entity-lifecycle.service.js';
import { LibraryJobsService } from '../../library/library-jobs.service.js';
import { MUSIC_JOB, MusicJobsService } from '../jobs/music-jobs.service.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { AudioTranscodeService } from '../playback/audio-transcode.service.js';
import { codecKey, isPlayable, parseCaps, planStream } from '../playback/playability.js';

/**
 * Admin quick actions for music. Each one only enqueues jobs (dedupe-aware)
 * and returns how many were queued; the work runs in the job queue.
 */
@Injectable()
export class MusicAdminService {
	constructor(
		private readonly database: DatabaseService,
		private readonly musicJobs: MusicJobsService,
		private readonly libraryJobs: LibraryJobsService,
		private readonly transcoder: AudioTranscodeService,
		private readonly musicSettings: MusicSettingsService,
		private readonly lifecycle: EntityLifecycleService,
	) {}

	private get db() {
		return this.database.db;
	}

	/** Scan every enabled audio source. */
	scanLibrary(): MusicAdminActionResult {
		const sources = this.db
			.select({ id: mediaSources.id, path: mediaSources.path })
			.from(mediaSources)
			.where(and(eq(mediaSources.kind, 'audio'), eq(mediaSources.enabled, true)))
			.all();
		for (const s of sources) this.libraryJobs.enqueueScan(s.id, `Scan music: ${s.path}`);
		return { started: true, count: sources.length };
	}

	/** Metadata pass for unmatched albums (`all`: every album, forced). */
	refreshMetadata(scope: 'unmatched' | 'all' = 'unmatched'): MusicAdminActionResult {
		const rows = this.db
			.select({ id: albums.id, title: albums.title })
			.from(albums)
			.where(scope === 'all' ? undefined : isNull(albums.mbidReleaseGroup))
			.all();
		const queued = this.musicJobs.queuedIds(MUSIC_JOB.METADATA, 'albumId');
		let count = 0;
		for (const a of rows) {
			if (this.musicJobs.enqueueMetadata(a.id, a.title, { force: scope === 'all', queued }))
				count++;
		}
		return { started: true, count };
	}

	/** Cover Art Archive for albums with no art. */
	fetchMissingArt(): MusicAdminActionResult {
		const rows = this.db
			.select({ id: albums.id, title: albums.title })
			.from(albums)
			.where(isNull(albums.artId))
			.all();
		const queued = this.musicJobs.queuedIds(MUSIC_JOB.ARTWORK, 'albumId');
		let count = 0;
		for (const a of rows) {
			if (this.musicJobs.enqueueArtwork(a.id, a.title, { queued })) count++;
		}
		return { started: true, count };
	}

	/** LRCLIB for tracks with no lyrics (ignores the miss cache; skips user rows). */
	fetchMissingLyrics(): MusicAdminActionResult {
		if (!this.musicSettings.get().fetchLyrics) {
			throw new BadRequestException('Lyrics fetching is turned off in Music settings');
		}
		const rows = this.db.all<{ id: string; title: string }>(sql`
			SELECT t.id, t.title FROM tracks t
			LEFT JOIN lyrics l ON l.track_id = t.id
			WHERE l.track_id IS NULL
			   OR (COALESCE(l.source, '') <> 'user'
			       AND COALESCE(l.plain, '') = '' AND COALESCE(l.synced_lrc, '') = '')`);
		const queued = this.musicJobs.queuedIds(MUSIC_JOB.LYRICS, 'trackId');
		let count = 0;
		for (const t of rows) {
			if (this.musicJobs.enqueueLyrics(t.id, t.title, { force: true, queued })) count++;
		}
		return { started: true, count };
	}

	/** FLAC transcodes for files no browser plays that have no cached transcode yet. */
	reencodeUnplayable(): MusicAdminActionResult {
		const universal = parseCaps('');
		const { bitrates } = this.musicSettings.get();
		const files = this.db
			.select({
				id: trackFiles.id,
				fileName: trackFiles.fileName,
				codec: trackFiles.codec,
				container: trackFiles.container,
				bitrate: trackFiles.bitrate,
			})
			.from(trackFiles)
			.where(or(eq(trackFiles.available, true), isNull(trackFiles.available)))
			.all();
		const queued = this.musicJobs.queuedIds(MUSIC_JOB.TRANSCODE, 'trackFileId');
		let count = 0;
		for (const f of files) {
			const key = codecKey(f.codec, f.container);
			if (isPlayable(key, universal)) continue;
			const plan = planStream(
				{ codec: key, bitrate: f.bitrate },
				'original',
				'original',
				universal,
				bitrates,
			);
			if (this.transcoder.cachedPath(f.id, plan)) continue;
			if (this.musicJobs.enqueueTranscode(f.id, f.fileName, { queued })) count++;
		}
		return { started: true, count };
	}

	/** Delete every cached music transcode (waveforms are kept). Returns files removed. */
	async clearTranscodeCache(): Promise<MusicAdminActionResult> {
		const removed = await this.transcoder.evict(0, () => false);
		return { started: true, count: removed };
	}

	/**
	 * Destructive: remove the whole music catalogue (artists, albums, tracks,
	 * files, lyrics, art rows) and every rating / comment / favourite / history /
	 * playlist row that points at it, then clear the transcode cache. Audio files
	 * on disk are NOT touched — a re-scan rebuilds the catalogue from tags.
	 */
	async deleteLibraryData(): Promise<MusicAdminActionResult> {
		const ids = (table: string) =>
			this.db.all<{ id: string }>(sql`SELECT id FROM ${sql.raw(table)}`).map((r) => r.id);
		const trackIds = ids('tracks');
		this.lifecycle.purgeMany('track', trackIds);
		this.lifecycle.purgeMany('album', ids('albums'));
		this.lifecycle.purgeMany('artist', ids('artists'));
		this.db.transaction((tx) => {
			for (const table of [
				'track_files',
				'track_artists',
				'lyrics',
				'tracks',
				'album_aliases',
				'album_match_candidates',
				'album_genres',
				'album_artists',
				'album_releases',
				'albums',
				'artist_genres',
				'artists',
				'music_genres',
				'music_identities',
				'artwork',
			]) {
				tx.run(sql`DELETE FROM ${sql.raw(table)}`);
			}
		});
		await this.transcoder.evict(0, () => false);
		return { started: true, count: trackIds.length };
	}
}
