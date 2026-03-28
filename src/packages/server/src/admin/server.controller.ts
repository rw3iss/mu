import { spawn } from 'node:child_process';
import path from 'node:path';
import { nowISO } from '@mu/shared';
import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { Roles } from '../common/decorators/roles.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { jobHistory } from '../database/schema/index.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ServerService } from './server.service.js';

@Controller('admin/server')
export class ServerController {
	private readonly logger = new Logger('ServerController');

	constructor(
		private readonly serverService: ServerService,
		private readonly jobManager: JobManagerService,
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
	) {}

	@Get('info')
	@Roles('admin')
	async getServerInfo() {
		return this.serverService.getServerInfo();
	}

	@Get('stats')
	@Roles('admin')
	async getStats() {
		return this.serverService.getStats();
	}

	@Post('restart')
	@Roles('admin')
	async restart() {
		this.logger.warn('Server restart requested via API');

		// Clear hwAccelBroken flag so the restarted server retries hardware encoding
		if (this.settings.get<boolean>('hwAccelBroken', false)) {
			this.settings.delete('hwAccelBroken');
			this.logger.log(
				'Cleared hwAccelBroken flag — will retry hardware encoding after restart',
			);
		}

		// Spawn restart script as detached process, then exit
		const scriptDir = path.resolve(import.meta.dirname, '..', '..', '..', '..');
		const restartScript = path.join(scriptDir, 'restart.sh');

		setTimeout(() => {
			try {
				const child = spawn('bash', [restartScript], {
					detached: true,
					stdio: 'ignore',
					cwd: scriptDir,
				});
				child.unref();
			} catch (err: any) {
				this.logger.error(`Failed to spawn restart script: ${err.message}`);
			}

			// Give the script a moment to start, then exit this process
			setTimeout(() => process.exit(0), 500);
		}, 1000);

		return { message: 'Server restarting...', restartedAt: nowISO() };
	}

	@Get('logs')
	@Roles('admin')
	getLogs(@Query('lines') lines?: string, @Query('file') file?: string) {
		const numLines = lines ? parseInt(lines, 10) : 200;
		const logFile = file === 'transcode-debug' ? 'transcode-debug' : 'server';
		return this.serverService.getServerLogs(numLines, logFile);
	}

	// ============================================
	// Jobs Management
	// ============================================

	@Get('jobs')
	@Roles('admin')
	listJobs(@Query('status') status?: string, @Query('type') type?: string) {
		// Current in-memory jobs, sorted: running first (earliest), then pending, then completed/failed
		const statusOrder: Record<string, number> = {
			running: 0,
			pending: 1,
			paused: 2,
			completed: 3,
			failed: 4,
		};
		const currentJobs = this.jobManager.listJobs({ type, status }).sort((a, b) => {
			const oa = statusOrder[a.status] ?? 5;
			const ob = statusOrder[b.status] ?? 5;
			if (oa !== ob) return oa - ob;
			// Within same status, earliest started/created first
			const ta = a.startedAt ?? a.createdAt;
			const tb = b.startedAt ?? b.createdAt;
			return new Date(ta).getTime() - new Date(tb).getTime();
		});

		return {
			jobs: currentJobs.map((j) => ({
				...j,
				movieTitle: (j.payload?.movieId as string) ? undefined : undefined,
				durationMs:
					j.startedAt && j.completedAt
						? new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()
						: j.startedAt
							? Date.now() - new Date(j.startedAt).getTime()
							: undefined,
			})),
		};
	}

	@Get('jobs/history')
	@Roles('admin')
	getJobHistory(
		@Query('status') status?: string,
		@Query('type') type?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
	) {
		const numLimit = limit ? parseInt(limit, 10) : 50;
		const numOffset = offset ? parseInt(offset, 10) : 0;

		const conditions: any[] = [];
		if (status) conditions.push(eq(jobHistory.status, status));
		if (type) conditions.push(eq(jobHistory.type, type));

		const where =
			conditions.length > 0
				? conditions.length === 1
					? conditions[0]
					: sql`${conditions[0]} AND ${conditions[1]}`
				: undefined;

		const results = this.database.db
			.select()
			.from(jobHistory)
			.where(where)
			.orderBy(desc(jobHistory.completedAt))
			.limit(numLimit)
			.offset(numOffset)
			.all();

		return { jobs: results };
	}

	@Post('jobs/:id/pause')
	@Roles('admin')
	pauseJob(@Param('id') id: string) {
		const result = this.jobManager.pause(id);
		return { success: result };
	}

	@Post('jobs/:id/resume')
	@Roles('admin')
	resumeJob(@Param('id') id: string) {
		const result = this.jobManager.resume(id);
		return { success: result };
	}

	@Post('jobs/:id/cancel')
	@Roles('admin')
	cancelJob(@Param('id') id: string) {
		const result = this.jobManager.cancel(id);
		return { success: result };
	}

	@Post('jobs/:id/prioritize')
	@Roles('admin')
	prioritizeJob(@Param('id') id: string) {
		const result = this.jobManager.prioritize(id);
		return { success: result };
	}
}
