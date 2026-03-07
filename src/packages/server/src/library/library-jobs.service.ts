import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { ScannerService } from './scanner.service.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventsService } from '../events/events.service.js';
import { WsEvent } from '@mu/shared';
import type { JobRecord, JobHelpers } from '../jobs/job.interface.js';

/** Well-known job types */
export const JOB_TYPE = {
  SCAN: 'scan',
  METADATA: 'metadata',
  THUMBNAIL: 'thumbnail',
  CLEANUP: 'cleanup',
} as const;

@Injectable()
export class LibraryJobsService implements OnModuleInit {
  private readonly logger = new Logger('LibraryJobs');

  constructor(
    private readonly jobManager: JobManagerService,
    private readonly scanner: ScannerService,
    private readonly metadata: MetadataService,
    private readonly thumbnail: ThumbnailService,
    private readonly settings: SettingsService,
    private readonly events: EventsService,
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
        const fetchExtended = job.payload.fetchExtended as boolean | undefined;
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

    // Cleanup handler — prune old completed/failed jobs
    this.jobManager.registerHandler(
      JOB_TYPE.CLEANUP,
      async (_job: JobRecord, helpers: JobHelpers) => {
        const removed = this.jobManager.pruneOldJobs(24 * 60 * 60 * 1000);
        helpers.log(`Pruned ${removed} old jobs`);
        return { removed };
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
    });

    this.logger.log('Listening for new movies to schedule metadata + thumbnail jobs');
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

  private shouldFetchExtendedMetadata(): boolean {
    const lib = this.settings.get<Record<string, unknown>>('library', {});
    return (lib as any)?.fetchExtendedMetadata !== false; // default true
  }
}
