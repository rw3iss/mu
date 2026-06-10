import { Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JobManagerService } from './job-manager.service.js';

@Controller('jobs')
export class JobController {
	constructor(private readonly jobManager: JobManagerService) {}

	@Get()
	@Roles('admin')
	@RequireAction('view:library')
	listJobs(@Query('type') type?: string, @Query('status') status?: string) {
		return this.jobManager.listJobs({ type, status });
	}

	@Get('scheduled')
	@Roles('admin')
	@RequireAction('view:library')
	listScheduled() {
		return { jobs: this.jobManager.listScheduledJobs() };
	}

	@Post('cancel-by-movie/:movieId')
	@Roles('admin')
	@RequireAction('admin:server')
	cancelByMovie(@Param('movieId') movieId: string, @Query('type') type?: string) {
		const results = this.jobManager.cancelByPayload(
			'movieId',
			movieId,
			type ?? 'pre-transcode',
		);
		return { cancelled: results.length };
	}

	/**
	 * Get movie IDs that are currently processing or scheduled for processing.
	 * Covers transcode (pre-transcode) AND MP4 conversion (convert-mp4) jobs,
	 * both pending (queued) and running — so cards/detail show "Processing…"
	 * for the whole lifecycle of a new movie's media work.
	 */
	@RequireAction('view:library')
	@Get('processing-movies')
	getProcessingMovies() {
		const movieIds = new Set<string>();
		for (const type of ['pre-transcode', 'convert-mp4']) {
			for (const status of ['pending', 'running']) {
				for (const job of this.jobManager.listJobs({ type, status })) {
					const mid = job.payload?.movieId as string | undefined;
					if (mid) movieIds.add(mid);
				}
			}
		}
		return { movieIds: [...movieIds] };
	}

	/**
	 * Per-movie transcode status. Used by `useTranscodeStatus` on the
	 * client as a polling fallback when the WebSocket connection
	 * drops mid-job. Returns the highest-progress running job for the
	 * movie, plus a `running` flag so the client can self-correct
	 * its `processingMovieIds` set when WS lifecycle events were missed.
	 *
	 * Cheap: scans the in-memory job table; no DB read.
	 */
	@RequireAction('view:library')
	@Get('movies/:movieId/transcode-status')
	getTranscodeStatus(@Param('movieId') movieId: string) {
		// Transcode + MP4-conversion jobs both count as "processing" media work.
		const jobs = this.jobManager
			.findJobsByPayload('movieId', movieId, undefined, ['pending', 'running'])
			.filter((j) => j.type === 'pre-transcode' || j.type === 'convert-mp4');
		const running = jobs.filter((j) => j.status === 'running');
		const isRunning = running.length > 0;
		const progress = isRunning
			? Math.round(
					Math.max(
						...running.map((j) => (typeof j.progress === 'number' ? j.progress : 0)),
					),
				)
			: undefined;
		// Active job (any type — pre-transcode or convert-mp4) for this movie, so
		// the UI can deep-link to its job-details page. Prefer a running job.
		const anyActive = this.jobManager.findJobsByPayload('movieId', movieId, undefined, [
			'pending',
			'running',
		]);
		const jobId = (anyActive.find((j) => j.status === 'running') ?? anyActive[0])?.id ?? null;
		return {
			movieId,
			running: isRunning,
			progress,
			pending: jobs.some((j) => j.status === 'pending'),
			jobId,
		};
	}

	@Get(':id')
	@Roles('admin')
	@RequireAction('view:library')
	getJob(@Param('id') id: string) {
		const job = this.jobManager.getJob(id);
		if (!job) throw new NotFoundException(`Job ${id} not found`);
		return job;
	}

	@Post(':id/cancel')
	@Roles('admin')
	@RequireAction('admin:server')
	cancelJob(@Param('id') id: string) {
		const cancelled = this.jobManager.cancel(id);
		return { success: cancelled };
	}

	@Post('prune')
	@Roles('admin')
	@RequireAction('admin:server')
	pruneJobs(@Query('maxAgeHours') maxAgeHours?: string) {
		const ageMs = maxAgeHours ? parseInt(maxAgeHours, 10) * 3600000 : undefined;
		const removed = this.jobManager.pruneOldJobs(ageMs);
		return { removed };
	}
}
