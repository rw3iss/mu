import { Injectable, Inject, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { StreamMode } from '@mu/shared';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { ScannerService } from './scanner.service.js';
import { LibraryService } from './library.service.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventsService } from '../events/events.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';
import { StreamService } from '../stream/stream.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, transcodeCache, movies } from '../database/schema/index.js';
import { nowISO, WsEvent } from '@mu/shared';
import crypto from 'node:crypto';
import type { JobRecord, JobHelpers } from '../jobs/job.interface.js';

/** Well-known job types */
export const JOB_TYPE = {
	SCAN: 'scan',
	SCAN_ALL: 'scan-all',
	METADATA: 'metadata',
	THUMBNAIL: 'thumbnail',
	CLEANUP: 'cleanup',
	PRE_TRANSCODE: 'pre-transcode',
} as const;

@Injectable()
export class LibraryJobsService implements OnModuleInit {
	private readonly logger = new Logger('LibraryJobs');

	/** Track when the auto-scan was last scheduled so we can compute next run */
	private autoScanScheduledAt: string | null = null;
	private autoScanIntervalMs: number = 0;

	constructor(
		private readonly jobManager: JobManagerService,
		private readonly scanner: ScannerService,
		@Inject(forwardRef(() => LibraryService))
		private readonly libraryService: LibraryService,
		private readonly metadata: MetadataService,
		private readonly thumbnail: ThumbnailService,
		private readonly settings: SettingsService,
		private readonly events: EventsService,
		private readonly transcoderService: TranscoderService,
		private readonly streamService: StreamService,
		private readonly database: DatabaseService,
	) {}

	onModuleInit() {
		this.registerHandlers();
		this.registerScheduledJobs();
		this.listenForNewMovies();
	}

	// ===========================================================
	// Handler Registration
	// ===========================================================

	private registerHandlers(): void {
		// Scan handler
		this.jobManager.registerHandler(
			JOB_TYPE.SCAN,
			async (job: JobRecord, helpers: JobHelpers) => {
				const sourceId = job.payload.sourceId as string;
				helpers.log(`Starting scan for source ${sourceId}`);
				const result = await this.scanner.scanSource(sourceId);
				helpers.reportProgress(100);
				return result;
			},
		);

		// Metadata handler
		this.jobManager.registerHandler(
			JOB_TYPE.METADATA,
			async (job: JobRecord, helpers: JobHelpers) => {
				const movieId = job.payload.movieId as string;
				const _fetchExtended = job.payload.fetchExtended as boolean | undefined;
				helpers.log(`Fetching metadata for movie ${movieId}`);

				const result = await this.metadata.fetchForMovie(movieId);

				// If the setting is enabled and TMDB found a match (imdbId), extended data
				// is already fetched inside MetadataService.fetchForMovie (OMDB step).
				// This flag is checked at enqueue time, not here — we always try.
				helpers.reportProgress(100);
				return result;
			},
		);

		// Thumbnail handler
		this.jobManager.registerHandler(
			JOB_TYPE.THUMBNAIL,
			async (job: JobRecord, helpers: JobHelpers) => {
				const movieId = job.payload.movieId as string;
				helpers.log(`Generating thumbnail for movie ${movieId}`);
				const url = await this.thumbnail.generateForMovie(movieId);
				helpers.reportProgress(100);
				return { thumbnailUrl: url };
			},
		);

		// Scan-all handler — scans every enabled source
		this.jobManager.registerHandler(
			JOB_TYPE.SCAN_ALL,
			async (_job: JobRecord, helpers: JobHelpers) => {
				const sources = this.libraryService.getSources().filter((s) => s.enabled);
				helpers.log(`Scanning ${sources.length} enabled sources`);

				let totalFilesFound = 0;
				let totalFilesAdded = 0;

				for (const source of sources) {
					try {
						const result = await this.scanner.scanSource(source.id);
						totalFilesFound += result.filesFound;
						totalFilesAdded += result.filesAdded;
					} catch (err: any) {
						helpers.log(`Scan failed for source ${source.id}: ${err.message}`);
					}
				}

				helpers.reportProgress(100);
				return { sourceCount: sources.length, totalFilesFound, totalFilesAdded };
			},
		);

		// Cleanup handler — prune old completed/failed jobs
		this.jobManager.registerHandler(
			JOB_TYPE.CLEANUP,
			async (_job: JobRecord, helpers: JobHelpers) => {
				const removed = this.jobManager.pruneOldJobs(24 * 60 * 60 * 1000);
				helpers.log(`Pruned ${removed} old jobs`);
				return { removed };
			},
		);

		// Pre-transcode handler — transcodes a file ahead of playback
		this.jobManager.registerHandler(
			JOB_TYPE.PRE_TRANSCODE,
			async (job: JobRecord, helpers: JobHelpers) => {
				const { movieFileId, filePath, mode, quality } = job.payload as {
					movieFileId: string;
					filePath: string;
					mode: string;
					quality: string;
				};
				helpers.log(`Pre-transcoding file ${movieFileId} (${mode}, ${quality})`);

				// Register cancel callback to kill the FFmpeg process
				const processKey = `pre-${movieFileId}-${quality}`;
				this.jobManager.setOnCancel(job.id, () => {
					this.transcoderService.stopTranscode(processKey);
				});

				await this.transcoderService.preTranscode(movieFileId, filePath, mode, quality);

				// Record the cached transcode with encoding settings used
				this.recordTranscodeCache(movieFileId, quality);

				helpers.reportProgress(100);
				return { movieFileId, quality };
			},
		);

		this.logger.log('Job handlers registered');
	}

	// ===========================================================
	// Scheduled Jobs
	// ===========================================================

	private registerScheduledJobs(): void {
		// Daily cleanup of old job records
		this.jobManager.schedule({
			name: 'daily-job-cleanup',
			intervalMs: 24 * 60 * 60 * 1000, // 24h
			job: { type: JOB_TYPE.CLEANUP, label: 'Daily job cleanup' },
		});

		// Auto-scan based on library settings
		this.refreshAutoScanSchedule();
	}

	/**
	 * Read the library settings and (re-)register the auto-scan scheduled job.
	 * Called on startup and whenever settings are saved.
	 */
	refreshAutoScanSchedule(): void {
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const autoScanEnabled = (lib as any)?.autoScanEnabled !== false; // default true
		const scanIntervalHours = Number((lib as any)?.scanIntervalHours) || 6;

		// Always remove old schedule first
		this.jobManager.unschedule('auto-library-scan');
		this.autoScanScheduledAt = null;
		this.autoScanIntervalMs = 0;

		if (!autoScanEnabled) {
			this.logger.log('Auto-scan disabled');
			return;
		}

		const intervalMs = scanIntervalHours * 60 * 60 * 1000;
		this.autoScanIntervalMs = intervalMs;
		this.autoScanScheduledAt = nowISO();

		this.jobManager.schedule({
			name: 'auto-library-scan',
			intervalMs,
			runImmediately: false,
			job: { type: JOB_TYPE.SCAN_ALL, label: 'Scheduled library scan' },
		});

		this.logger.log(`Auto-scan scheduled every ${scanIntervalHours}h`);
	}

	/**
	 * Get the current auto-scan status for the API.
	 */
	getScanStatus(): {
		autoScanEnabled: boolean;
		scanIntervalHours: number;
		nextScanAt: string | null;
		lastScanAt: string | null;
	} {
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const autoScanEnabled = (lib as any)?.autoScanEnabled !== false;
		const scanIntervalHours = Number((lib as any)?.scanIntervalHours) || 6;

		let nextScanAt: string | null = null;
		if (autoScanEnabled && this.autoScanScheduledAt && this.autoScanIntervalMs > 0) {
			// Compute next scan: find the next interval tick from when we scheduled
			const scheduledTime = new Date(this.autoScanScheduledAt).getTime();
			const now = Date.now();
			const elapsed = now - scheduledTime;
			const remaining = this.autoScanIntervalMs - (elapsed % this.autoScanIntervalMs);
			nextScanAt = new Date(now + remaining).toISOString();
		}

		// Find the most recent scan completion
		const scanJobs = this.jobManager.listJobs({ type: JOB_TYPE.SCAN });
		const allScanJobs = [...scanJobs, ...this.jobManager.listJobs({ type: JOB_TYPE.SCAN_ALL })];
		const lastCompleted = allScanJobs
			.filter((j) => j.status === 'completed' && j.completedAt)
			.sort(
				(a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime(),
			)[0];

		return {
			autoScanEnabled,
			scanIntervalHours,
			nextScanAt,
			lastScanAt: lastCompleted?.completedAt ?? null,
		};
	}

	// ===========================================================
	// React to new movies — enqueue metadata + thumbnail jobs
	// ===========================================================

	private listenForNewMovies(): void {
		this.events.on(WsEvent.LIBRARY_MOVIE_ADDED, (data: unknown) => {
			const { movieId, title } = data as { movieId: string; title: string };

			// Always enqueue metadata fetch
			this.jobManager.enqueue({
				type: JOB_TYPE.METADATA,
				label: `Fetch metadata: ${title}`,
				payload: { movieId, fetchExtended: this.shouldFetchExtendedMetadata() },
				priority: 20,
			});

			// Always enqueue thumbnail generation
			this.jobManager.enqueue({
				type: JOB_TYPE.THUMBNAIL,
				label: `Generate thumbnail: ${title}`,
				payload: { movieId },
				priority: 30,
			});

			// Enqueue pre-transcode if the file needs transcoding and caching is enabled
			this.enqueuePreTranscodeIfNeeded(movieId, title);
		});

		this.logger.log(
			'Listening for new movies to schedule metadata + thumbnail + pre-transcode jobs',
		);
	}

	enqueuePreTranscodeIfNeeded(movieId: string, title: string): void {
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const persistEnabled = (lib as any)?.persistTranscodes !== false; // default true
		if (!persistEnabled) return;

		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const defaultQuality = enc?.quality || '1080p';
		const encodeHighest = enc?.encodeHighestAvailable === true;

		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)))
			.all();

		for (const file of files) {
			const mode = this.streamService.determineStreamMode(file);
			if (mode !== StreamMode.TRANSCODE && mode !== StreamMode.DIRECT_STREAM) continue;

			// Determine which qualities to encode
			const qualities = new Set<string>([defaultQuality]);

			if (encodeHighest && file.resolution) {
				const nativeQuality = this.resolutionToQuality(file.resolution);
				if (
					nativeQuality &&
					this.qualityRank(nativeQuality) > this.qualityRank(defaultQuality)
				) {
					qualities.add(nativeQuality);
				}
			}

			for (const quality of qualities) {
				this.jobManager.enqueue({
					type: JOB_TYPE.PRE_TRANSCODE,
					label: `Pre-transcode: ${title} (${quality})`,
					payload: {
						movieId,
						movieFileId: file.id,
						filePath: file.filePath,
						mode,
						quality,
					},
					priority: 40,
				});
			}
		}
	}

	// ===========================================================
	// Public API for other services / controllers
	// ===========================================================

	/**
	 * Enqueue a scan job for a source.
	 */
	enqueueScan(sourceId: string, label?: string): string {
		return this.jobManager.enqueue({
			type: JOB_TYPE.SCAN,
			label: label ?? `Scan source ${sourceId.slice(0, 8)}`,
			payload: { sourceId },
			priority: 5,
		});
	}

	/**
	 * Enqueue a metadata job for a movie.
	 */
	enqueueMetadata(movieId: string, title?: string): string {
		return this.jobManager.enqueue({
			type: JOB_TYPE.METADATA,
			label: `Fetch metadata: ${title ?? movieId.slice(0, 8)}`,
			payload: { movieId, fetchExtended: this.shouldFetchExtendedMetadata() },
			priority: 20,
		});
	}

	/**
	 * Enqueue a thumbnail job for a movie.
	 */
	enqueueThumbnail(movieId: string, title?: string): string {
		return this.jobManager.enqueue({
			type: JOB_TYPE.THUMBNAIL,
			label: `Generate thumbnail: ${title ?? movieId.slice(0, 8)}`,
			payload: { movieId },
			priority: 30,
		});
	}

	/**
	 * Enqueue re-transcode jobs for all existing files whose cached transcode
	 * doesn't match the current encoding settings. Returns the number of jobs queued.
	 */
	enqueueReTranscodeJobs(): number {
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const persistEnabled = (lib as any)?.persistTranscodes !== false;
		if (!persistEnabled) return 0;

		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const defaultQuality = enc?.quality || '1080p';
		const encodeHighest = enc?.encodeHighestAvailable === true;
		const currentSettings = this.buildEncodingSettingsJson();

		// Get all available movie files
		const allFiles = this.database.db
			.select({
				file: movieFiles,
				movieTitle: movies.title,
			})
			.from(movieFiles)
			.leftJoin(movies, eq(movieFiles.movieId, movies.id))
			.where(eq(movieFiles.available, true))
			.all();

		// Skip files that already have a pending/running pre-transcode job
		const pendingTranscodeFileIds = new Set<string>();
		const pendingJobs = this.jobManager.listJobs({ type: JOB_TYPE.PRE_TRANSCODE });
		for (const job of pendingJobs) {
			if (job.status === 'pending' || job.status === 'running') {
				pendingTranscodeFileIds.add(job.payload?.movieFileId as string);
			}
		}

		let queued = 0;

		for (const { file, movieTitle } of allFiles) {
			const mode = this.streamService.determineStreamMode(file);
			if (mode !== StreamMode.TRANSCODE && mode !== StreamMode.DIRECT_STREAM) continue;

			// Determine which qualities this file should have
			const desiredQualities = new Set<string>([defaultQuality]);
			if (encodeHighest && file.resolution) {
				const nativeQuality = this.resolutionToQuality(file.resolution);
				if (
					nativeQuality &&
					this.qualityRank(nativeQuality) > this.qualityRank(defaultQuality)
				) {
					desiredQualities.add(nativeQuality);
				}
			}

			for (const quality of desiredQualities) {
				// Check if we already have a matching cached transcode
				const cached = this.database.db
					.select()
					.from(transcodeCache)
					.where(
						and(
							eq(transcodeCache.movieFileId, file.id),
							eq(transcodeCache.quality, quality),
						),
					)
					.all();

				const hasMatch = cached.some((c) => c.encodingSettings === currentSettings);
				if (hasMatch) continue;

				// Skip if a job is already pending for this file
				if (pendingTranscodeFileIds.has(file.id)) continue;

				// Clear old cache for this file+quality before re-encoding
				this.transcoderService.clearCache(file.id).catch(() => {});

				// Remove stale transcode_cache entries for this file+quality
				this.database.db
					.delete(transcodeCache)
					.where(
						and(
							eq(transcodeCache.movieFileId, file.id),
							eq(transcodeCache.quality, quality),
						),
					)
					.run();

				const title = movieTitle || file.id.slice(0, 8);
				this.jobManager.enqueue({
					type: JOB_TYPE.PRE_TRANSCODE,
					label: `Re-transcode: ${title} (${quality})`,
					payload: {
						movieId: file.movieId,
						movieFileId: file.id,
						filePath: file.filePath,
						mode,
						quality,
					},
					priority: 50,
				});
				queued++;
			}
		}

		this.logger.log(`Re-transcode: ${queued} jobs enqueued`);
		return queued;
	}

	// ===========================================================
	// Helpers
	// ===========================================================

	/** Record a completed transcode in the cache table. */
	private recordTranscodeCache(movieFileId: string, quality: string): void {
		const settingsJson = this.buildEncodingSettingsJson();

		// Remove any existing entry for this file+quality, then insert fresh
		this.database.db
			.delete(transcodeCache)
			.where(
				and(
					eq(transcodeCache.movieFileId, movieFileId),
					eq(transcodeCache.quality, quality),
				),
			)
			.run();

		this.database.db
			.insert(transcodeCache)
			.values({
				id: crypto.randomUUID(),
				movieFileId,
				quality,
				encodingSettings: settingsJson,
				completedAt: nowISO(),
			})
			.run();
	}

	/** Build a stable JSON string of current encoding settings for comparison. */
	private buildEncodingSettingsJson(): string {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		return JSON.stringify({
			hwAccel: enc?.hwAccel || 'none',
			preset: enc?.preset || 'veryfast',
			rateControl: enc?.rateControl || 'cbr',
			crf: enc?.crf ?? 23,
		});
	}

	/** Map a resolution string (e.g. '1080p', '2160p') to a quality profile key. */
	private resolutionToQuality(resolution: string): string | null {
		const height = parseInt(resolution, 10);
		if (Number.isNaN(height)) return null;
		if (height >= 2160) return '4k';
		if (height >= 1080) return '1080p';
		if (height >= 720) return '720p';
		if (height >= 480) return '480p';
		return null;
	}

	/** Numeric rank for quality comparison (higher = better). */
	private qualityRank(quality: string): number {
		const ranks: Record<string, number> = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4 };
		return ranks[quality] ?? 0;
	}

	private shouldFetchExtendedMetadata(): boolean {
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		return (lib as any)?.fetchExtendedMetadata !== false; // default true
	}
}
