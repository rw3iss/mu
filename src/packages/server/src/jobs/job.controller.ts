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
		// Active job-based processing
		const allJobs = this.jobManager.listJobs({ type: 'pre-transcode', status: 'pending' });
		const runningJobs = this.jobManager.listJobs({ type: 'pre-transcode', status: 'running' });
		const movieIds = new Set<string>();
		for (const job of [...allJobs, ...runningJobs]) {
			const mid = job.payload?.movieId as string | undefined;
			if (mid) movieIds.add(mid);
		}
		// Also include movies that need transcoding but aren't being processed yet
		for (const mid of this.jobManager.getUntranscodedMovieIds()) {
			movieIds.add(mid);
		}
		return { movieIds: [...movieIds] };
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
