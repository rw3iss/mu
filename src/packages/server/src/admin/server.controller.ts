import { spawn } from 'node:child_process';
import path from 'node:path';
import { nowISO } from '@mu/shared';
import { Controller, Delete, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
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
	@RequireAction('admin:server')
	async getServerInfo() {
		return this.serverService.getServerInfo();
	}

	@Get('stats')
	@Roles('admin')
	@RequireAction('admin:server')
	async getStats() {
		return this.serverService.getStats();
	}

	@Post('restart')
	@Roles('admin')
	@RequireAction('admin:server')
	async restart() {
		this.logger.warn('Server restart requested via API');

		// Clear hwAccelBroken flag so the restarted server retries hardware encoding
		if (this.settings.get<boolean>('hwAccelBroken', false)) {
			this.settings.delete('hwAccelBroken');
			this.logger.log(
				'Cleared hwAccelBroken flag — will retry hardware encoding after restart',
			);
		}

		// On Windows with NSSM, prefer `nssm restart mu-server` so the
		// service supervisor stays in charge of the lifecycle. Spawning
		// restart.sh here would launch a second `nohup node` process that
		// NSSM doesn't track — the previous tracked instance and the new
		// nohup'd one then run side-by-side, both watching the media
		// source, racing each other on inserts. nssm restart cleanly
		// kills the tracked PID and starts a fresh one.
		const scriptDir = path.resolve(import.meta.dirname, '..', '..', '..', '..');
		const restartScript = path.join(scriptDir, 'restart.sh');
		const isWindows = process.platform === 'win32';
		const useNssm = isWindows && this.serverService.isNssmManaged();

		setTimeout(() => {
			try {
				if (useNssm) {
					// Detached so this process can exit cleanly while NSSM
					// brings up the new instance.
					const child = spawn('nssm', ['restart', 'mu-server'], {
						detached: true,
						stdio: 'ignore',
						windowsHide: true,
					});
					child.unref();
				} else {
					const child = spawn('bash', [restartScript], {
						detached: true,
						stdio: 'ignore',
						cwd: scriptDir,
					});
					child.unref();
				}
			} catch (err: any) {
				this.logger.error(`Failed to spawn restart command: ${err.message}`);
			}

			// Give the supervisor a moment to start the new instance,
			// then exit this process so NSSM's "stop" sees us go cleanly
			// (and doesn't escalate to taskkill).
			setTimeout(() => process.exit(0), 500);
		}, 1000);

		return { message: 'Server restarting...', restartedAt: nowISO() };
	}

	@Get('logs')
	@Roles('admin')
	@RequireAction('admin:server')
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
	@RequireAction('admin:server')
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
	@RequireAction('admin:server')
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

		return {
			jobs: results.map((j) => ({
				...j,
				payload: j.payload ? JSON.parse(j.payload) : null,
			})),
		};
	}

	@Delete('jobs/history')
	@Roles('admin')
	@RequireAction('admin:server')
	clearJobHistory() {
		const result = this.database.db.delete(jobHistory).run();
		this.logger.warn(`Cleared job history: ${result.changes} rows deleted`);
		return { success: true, deleted: result.changes };
	}

	@Post('encoder/reset')
	@Roles('admin')
	@RequireAction('admin:server')
	resetEncoder() {
		this.serverService.resetHwAccelBroken();
		return { success: true };
	}

	@Post('encoder/recycle')
	@Roles('admin')
	@RequireAction('admin:server')
	async recycleEncoder() {
		this.logger.warn('Hardware encoder recycle requested via API');
		return this.serverService.recycleHwAccel();
	}

	@Post('jobs/:id/pause')
	@Roles('admin')
	@RequireAction('admin:server')
	pauseJob(@Param('id') id: string) {
		const result = this.jobManager.pause(id);
		return { success: result };
	}

	@Post('jobs/:id/resume')
	@Roles('admin')
	@RequireAction('admin:server')
	resumeJob(@Param('id') id: string) {
		const result = this.jobManager.resume(id);
		return { success: result };
	}

	@Post('jobs/:id/cancel')
	@Roles('admin')
	@RequireAction('admin:server')
	cancelJob(@Param('id') id: string) {
		const result = this.jobManager.cancel(id);
		return { success: result };
	}

	@Post('jobs/:id/prioritize')
	@Roles('admin')
	@RequireAction('admin:server')
	prioritizeJob(@Param('id') id: string) {
		const result = this.jobManager.prioritize(id);
		return { success: result };
	}

	@Post('jobs/:id/retry')
	@Roles('admin')
	@RequireAction('admin:server')
	retryJob(@Param('id') id: string) {
		const result = this.jobManager.retry(id);
		if (result.ok) {
			return { success: true, newJobId: result.newId };
		}
		return { success: false, newJobId: null, reason: result.reason };
	}
}
