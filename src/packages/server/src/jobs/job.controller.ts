import { Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JobManagerService } from './job-manager.service.js';

@Controller('jobs')
export class JobController {
	constructor(private readonly jobManager: JobManagerService) {}

	@Get()
	@Roles('admin')
	listJobs(@Query('type') type?: string, @Query('status') status?: string) {
		return this.jobManager.listJobs({ type, status });
	}

	@Get('scheduled')
	@Roles('admin')
	listScheduled() {
		return { jobs: this.jobManager.listScheduledJobs() };
	}

	@Post('cancel-by-movie/:movieId')
	@Roles('admin')
	cancelByMovie(@Param('movieId') movieId: string, @Query('type') type?: string) {
		const results = this.jobManager.cancelByPayload(
			'movieId',
			movieId,
			type ?? 'pre-transcode',
		);
		return { cancelled: results.length };
	}

	/**
	 * Get movie IDs that are currently processing or need transcoding.
	 * Includes active jobs AND movies that haven't finished transcoding.
	 */
	@Get('processing-movies')
	getProcessingMovies() {
		// Only return movies with ACTIVELY RUNNING transcode jobs
		// (not pending/queued — those shouldn't show as "processing" in the UI)
		const runningJobs = this.jobManager.listJobs({
			type: 'pre-transcode',
			status: 'running',
		});
		const movieIds = new Set<string>();
		for (const job of runningJobs) {
			const mid = job.payload?.movieId as string | undefined;
			if (mid) movieIds.add(mid);
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
	@Get('movies/:movieId/transcode-status')
	getTranscodeStatus(@Param('movieId') movieId: string) {
		const jobs = this.jobManager.findJobsByPayload(
			'movieId',
			movieId,
			'pre-transcode',
			['pending', 'running'],
		);
		const running = jobs.filter((j) => j.status === 'running');
		const isRunning = running.length > 0;
		const progress = isRunning
			? Math.round(
					Math.max(
						...running.map((j) => (typeof j.progress === 'number' ? j.progress : 0)),
					),
				)
			: undefined;
		return {
			movieId,
			running: isRunning,
			progress,
			pending: jobs.some((j) => j.status === 'pending'),
		};
	}

	@Get(':id')
	@Roles('admin')
	getJob(@Param('id') id: string) {
		const job = this.jobManager.getJob(id);
		if (!job) throw new NotFoundException(`Job ${id} not found`);
		return job;
	}

	@Post(':id/cancel')
	@Roles('admin')
	cancelJob(@Param('id') id: string) {
		const cancelled = this.jobManager.cancel(id);
		return { success: cancelled };
	}

	@Post('prune')
	@Roles('admin')
	pruneJobs(@Query('maxAgeHours') maxAgeHours?: string) {
		const ageMs = maxAgeHours ? parseInt(maxAgeHours, 10) * 3600000 : undefined;
		const removed = this.jobManager.pruneOldJobs(ageMs);
		return { removed };
	}
}
