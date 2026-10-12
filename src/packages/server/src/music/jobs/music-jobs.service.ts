import { Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { albums, trackFiles } from '../../database/schema/index.js';
import { FeatureFlagsService } from '../../features/feature-flags.service.js';
import { JobManagerService } from '../../jobs/job-manager.service.js';
import { jobTypeRegistry } from '../../jobs/job-type-registry.js';
import { MusicMetadataService } from '../metadata/music-metadata.service.js';
import { MusicEventsService } from '../music-events.service.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { AudioTranscodeService } from '../playback/audio-transcode.service.js';
import {
	cacheName,
	codecKey,
	isPlayable,
	parseCaps,
	planStream,
	policyOf,
} from '../playback/playability.js';

export const MUSIC_JOB = {
	WAVEFORM: 'music-waveform',
	TRANSCODE: 'audio-transcode',
	CACHE_EVICT: 'music-cache-evict',
	METADATA: 'music-metadata',
	LYRICS: 'music-lyrics',
	ARTWORK: 'music-artwork',
} as const;

/** Low priority (higher number = later) so metadata never delays playback work. */
const PRIORITY = { metadata: 85, artwork: 85, lyrics: 90 } as const;

jobTypeRegistry.registerMany([
	{ type: MUSIC_JOB.WAVEFORM, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.TRANSCODE, ioHeavy: true, encode: true, feature: 'music' },
	{ type: MUSIC_JOB.CACHE_EVICT, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.METADATA, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.LYRICS, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.ARTWORK, ioHeavy: false, encode: false, feature: 'music' },
]);

/** Options for the metadata/artwork/lyrics enqueue helpers. */
export interface EnqueueOpts {
	force?: boolean;
	/** Wait until no other job runs (import-time follow-ups). */
	idleOnly?: boolean;
	/** Pre-built set of ids already queued (bulk enqueue: avoids O(n²) dedupe scans). */
	queued?: Set<string>;
}

/**
 * Background work for music: waveform peaks, ingest-time transcodes for
 * formats no browser plays, and LRU eviction of the transcode cache. Handlers
 * refuse work while the Music feature is off.
 */
@Injectable()
export class MusicJobsService implements OnModuleInit {
	constructor(
		private readonly jobs: JobManagerService,
		private readonly database: DatabaseService,
		private readonly transcoder: AudioTranscodeService,
		private readonly musicSettings: MusicSettingsService,
		private readonly features: FeatureFlagsService,
		private readonly metadata: MusicMetadataService,
		@Optional() private readonly musicEvents?: MusicEventsService,
	) {}

	onModuleInit() {
		this.jobs.registerHandler(MUSIC_JOB.WAVEFORM, async (job) => {
			this.requireMusic();
			const file = this.file(job.payload?.trackFileId as string);
			if (!file?.durationSeconds) return { skipped: true };
			await this.transcoder.buildWaveform(file.id, file.filePath, file.durationSeconds);
			this.database.db
				.update(trackFiles)
				.set({ waveformPath: this.transcoder.waveformPath(file.id) })
				.where(eq(trackFiles.id, file.id))
				.run();
			return { ok: true };
		});
		this.jobs.registerHandler(MUSIC_JOB.TRANSCODE, async (job) => {
			this.requireMusic();
			const file = this.file(job.payload?.trackFileId as string);
			if (!file) return { skipped: true };
			const s = this.musicSettings.get();
			// The universal browser set (no client caps) decides "unplayable".
			const plan = planStream(
				{
					codec: codecKey(file.codec, file.container),
					bitrate: file.bitrate,
					sampleRate: file.sampleRate,
					bitDepth: file.bitDepth,
				},
				'original',
				'original',
				parseCaps(''),
				s.bitrates,
				policyOf(s),
			);
			if (plan.mode === 'original') return { skipped: 'playable' };
			const out = await this.transcoder.build(file.id, file.filePath, plan);
			return { out };
		});
		this.jobs.registerHandler(MUSIC_JOB.METADATA, async (job, helpers) => {
			this.requireMusic();
			const albumId = job.payload?.albumId as string;
			if (!albumId) return { skipped: true };
			const res = await this.metadata.enrichAlbum(albumId, { force: !!job.payload?.force });
			helpers.setDetails(`Match: ${res.match.status}`);
			// Title / art / year / artist info may have changed.
			this.musicEvents?.changed({ albumIds: [albumId] });
			return res;
		});
		this.jobs.registerHandler(MUSIC_JOB.ARTWORK, async (job) => {
			this.requireMusic();
			const albumId = job.payload?.albumId as string;
			if (!albumId) return { skipped: true };
			const force = !!job.payload?.force;
			// Cover Art Archive needs an MBID: match first if never searched.
			const match =
				this.metadata.matchState(albumId).status === 'unsearched'
					? await this.metadata.matchAlbum(albumId)
					: null;
			const art = await this.metadata.fetchAlbumArt(albumId, { force });
			this.musicEvents?.changed({ albumIds: [albumId] });
			return { match, art };
		});
		this.jobs.registerHandler(MUSIC_JOB.LYRICS, async (job) => {
			this.requireMusic();
			const trackId = job.payload?.trackId as string;
			if (!trackId) return { skipped: true };
			return this.metadata.fetchLyrics(trackId, { force: !!job.payload?.force });
		});
		this.jobs.registerHandler(MUSIC_JOB.CACHE_EVICT, async () => {
			if (!this.features.isEnabled('music')) return { skipped: true };
			const maxBytes = this.musicSettings.get().transcodeCacheMaxGb * 1024 ** 3;
			// Never evict the ingest-time FLAC of a format no browser can play.
			const settings = this.musicSettings.get();
			const keep = (fileId: string, name: string) => {
				const f = this.file(fileId);
				if (!f) return false;
				const key = codecKey(f.codec, f.container);
				if (isPlayable(key, parseCaps(''))) return false;
				// Keep exactly the ingest-time copy the current policy serves.
				const plan = planStream(
					{
						codec: key,
						bitrate: f.bitrate,
						sampleRate: f.sampleRate,
						bitDepth: f.bitDepth,
					},
					'original',
					'original',
					parseCaps(''),
					settings.bitrates,
					policyOf(settings),
				);
				return name === cacheName(plan);
			};
			return { removed: await this.transcoder.evict(maxBytes, keep) };
		});
		this.jobs.schedule({
			name: 'music-cache-evict',
			intervalMs: 60 * 60 * 1000,
			job: {
				type: MUSIC_JOB.CACHE_EVICT,
				label: 'Music transcode cache eviction',
				priority: 90,
			},
		});
	}

	private requireMusic() {
		if (!this.features.isEnabled('music')) throw new Error('Music feature is disabled');
	}

	private file(id: string | undefined) {
		if (!id) return undefined;
		return this.database.db.select().from(trackFiles).where(eq(trackFiles.id, id)).get();
	}

	/** Ids (payload[key]) of pending/running jobs of a type — for bulk dedupe. */
	queuedIds(type: string, key: 'albumId' | 'trackId' | 'trackFileId'): Set<string> {
		const ids = new Set<string>();
		for (const status of ['pending', 'running']) {
			for (const j of this.jobs.listJobs({ type, status })) {
				const v = j.payload?.[key];
				if (typeof v === 'string') ids.add(v);
			}
		}
		return ids;
	}

	private enqueueUnique(
		type: string,
		key: 'albumId' | 'trackId' | 'trackFileId',
		id: string,
		label: string,
		priority: number,
		opts: EnqueueOpts,
	): boolean {
		const queued = opts.queued
			? opts.queued.has(id)
			: this.jobs.findJobsByPayload(key, id, type, ['pending', 'running']).length > 0;
		if (queued) return false;
		opts.queued?.add(id);
		this.jobs.enqueue({
			type,
			label,
			payload: { [key]: id, ...(opts.force ? { force: true } : {}) },
			priority,
			idleOnly: opts.idleOnly,
		});
		return true;
	}

	enqueueMetadata(albumId: string, title: string, opts: EnqueueOpts = {}): boolean {
		return this.enqueueUnique(
			MUSIC_JOB.METADATA,
			'albumId',
			albumId,
			`Music metadata: ${title}`,
			PRIORITY.metadata,
			opts,
		);
	}

	enqueueArtwork(albumId: string, title: string, opts: EnqueueOpts = {}): boolean {
		return this.enqueueUnique(
			MUSIC_JOB.ARTWORK,
			'albumId',
			albumId,
			`Album art: ${title}`,
			PRIORITY.artwork,
			opts,
		);
	}

	enqueueLyrics(trackId: string, title: string, opts: EnqueueOpts = {}): boolean {
		return this.enqueueUnique(
			MUSIC_JOB.LYRICS,
			'trackId',
			trackId,
			`Lyrics: ${title}`,
			PRIORITY.lyrics,
			opts,
		);
	}

	enqueueTranscode(trackFileId: string, fileName: string, opts: EnqueueOpts = {}): boolean {
		return this.enqueueUnique(
			MUSIC_JOB.TRANSCODE,
			'trackFileId',
			trackFileId,
			`Transcode unplayable audio: ${fileName}`,
			60,
			opts,
		);
	}

	/**
	 * Follow-up work queued after a file is imported or changed. `ingest`
	 * (new files only) adds metadata for a new album and lyrics for a new
	 * track, both idle-only so they trickle in after the scan.
	 */
	afterImport(
		trackFileId: string,
		ingest?: { trackId: string; albumId: string; newAlbum: boolean; title?: string },
	): void {
		const s = this.musicSettings.get();
		const file = this.file(trackFileId);
		if (!file) return;
		if (s.waveforms) {
			this.jobs.enqueue({
				type: MUSIC_JOB.WAVEFORM,
				label: `Waveform: ${file.fileName}`,
				payload: { trackFileId },
				priority: 70,
			});
		}
		if (
			s.transcodeUnplayableAtIngest &&
			!isPlayable(codecKey(file.codec, file.container), parseCaps(''))
		) {
			this.enqueueTranscode(trackFileId, file.fileName);
		}
		if (!ingest) return;
		if (ingest.newAlbum) {
			const album = this.database.db
				.select({ title: albums.title })
				.from(albums)
				.where(eq(albums.id, ingest.albumId))
				.get();
			this.enqueueMetadata(ingest.albumId, album?.title ?? ingest.albumId, {
				idleOnly: true,
			});
		}
		if (s.fetchLyrics) {
			this.enqueueLyrics(ingest.trackId, ingest.title ?? file.fileName, { idleOnly: true });
		}
	}
}
