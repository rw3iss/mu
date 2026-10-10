import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { trackFiles } from '../../database/schema/index.js';
import { FeatureFlagsService } from '../../features/feature-flags.service.js';
import { JobManagerService } from '../../jobs/job-manager.service.js';
import { jobTypeRegistry } from '../../jobs/job-type-registry.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { AudioTranscodeService } from '../playback/audio-transcode.service.js';
import { codecKey, isPlayable, parseCaps, planStream } from '../playback/playability.js';

export const MUSIC_JOB = {
	WAVEFORM: 'music-waveform',
	TRANSCODE: 'audio-transcode',
	CACHE_EVICT: 'music-cache-evict',
	METADATA: 'music-metadata',
	LYRICS: 'music-lyrics',
} as const;

jobTypeRegistry.registerMany([
	{ type: MUSIC_JOB.WAVEFORM, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.TRANSCODE, ioHeavy: true, encode: true, feature: 'music' },
	{ type: MUSIC_JOB.CACHE_EVICT, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.METADATA, ioHeavy: false, encode: false, feature: 'music' },
	{ type: MUSIC_JOB.LYRICS, ioHeavy: false, encode: false, feature: 'music' },
]);

/**
 * Background work for music: waveform peaks, ingest-time transcodes for
 * formats no browser plays, and LRU eviction of the transcode cache. Handlers
 * refuse work while the Music feature is off.
 */
@Injectable()
export class MusicJobsService implements OnModuleInit {
	private readonly logger = new Logger('MusicJobs');

	constructor(
		private readonly jobs: JobManagerService,
		private readonly database: DatabaseService,
		private readonly transcoder: AudioTranscodeService,
		private readonly musicSettings: MusicSettingsService,
		private readonly features: FeatureFlagsService,
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
				{ codec: codecKey(file.codec, file.container), bitrate: file.bitrate },
				'original',
				'original',
				parseCaps(''),
				s.bitrates,
			);
			if (plan.mode === 'original') return { skipped: 'playable' };
			const out = await this.transcoder.build(file.id, file.filePath, plan);
			return { out };
		});
		this.jobs.registerHandler(MUSIC_JOB.CACHE_EVICT, async () => {
			if (!this.features.isEnabled('music')) return { skipped: true };
			const maxBytes = this.musicSettings.get().transcodeCacheMaxGb * 1024 ** 3;
			// Never evict the ingest-time FLAC of a format no browser can play.
			const keep = (fileId: string, name: string) => {
				if (!name.startsWith('original.') && !name.startsWith('lossless.')) return false;
				const f = this.file(fileId);
				return !!f && !isPlayable(codecKey(f.codec, f.container), parseCaps(''));
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

	/** Follow-up work queued after a file is imported or changed. */
	afterImport(trackFileId: string): void {
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
			this.jobs.enqueue({
				type: MUSIC_JOB.TRANSCODE,
				label: `Transcode to FLAC: ${file.fileName}`,
				payload: { trackFileId },
				priority: 60,
			});
		}
	}
}
