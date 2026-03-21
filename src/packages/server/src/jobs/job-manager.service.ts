import { nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncTask, SimpleIntervalJob, ToadScheduler } from 'toad-scheduler';
import { DatabaseService } from '../database/database.service.js';
import { jobHistory } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
	JobDescriptor,
	JobHandler,
	JobHelpers,
	JobRecord,
	ScheduledJobOptions,
} from './job.interface.js';

@Injectable()
export class JobManagerService implements OnModuleDestroy {
	private readonly logger = new Logger('JobManager');

	/** Handler registry: type → handler function */
	private readonly handlers = new Map<string, JobHandler>();

	/** All known jobs (in-memory) */
	private readonly jobs = new Map<string, JobRecord>();

	/** Pending queue sorted by priority */
	private readonly queue: string[] = [];

	/** Currently running job ids */
	private readonly running = new Set<string>();

	/** Cleanup callbacks for running jobs (e.g. kill FFmpeg) */
	private readonly onCancelCallbacks = new Map<string, () => void>();

	/** Max concurrent jobs */
	private maxConcurrency = 4;

	/** Callback to get untranscoded movie IDs (registered by LibraryJobsService) */
	private untranscodedMovieIdsFn: (() => string[]) | null = null;

	/** Scheduled recurring jobs */
	private readonly scheduler = new ToadScheduler();
	private readonly scheduledJobs = new Map<string, SimpleIntervalJob>();

	constructor(
		private readonly events: EventsService,
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
	) {}

	// ===========================================================
	// Handler Registration (used by other services)
	// ===========================================================

	/**
	 * Register a handler for a job type. Only one handler per type.
	 */
	/**
	 * Register a callback that returns untranscoded movie IDs.
	 */
	registerUntranscodedMovieIdsFn(fn: () => string[]): void {
		this.untranscodedMovieIdsFn = fn;
	}

	/**
	 * Get movie IDs that need transcoding (via registered callback).
	 */
	getUntranscodedMovieIds(): string[] {
		return this.untranscodedMovieIdsFn?.() ?? [];
	}

	registerHandler(type: string, handler: JobHandler): void {
		if (this.handlers.has(type)) {
			this.logger.warn(`Overwriting handler for job type "${type}"`);
		}
		this.handlers.set(type, handler);
		this.logger.log(`Handler registered for job type: ${type}`);
	}

	// ===========================================================
	// One-off Jobs
	// ===========================================================

	/**
	 * Enqueue a one-off job. Returns the job id.
	 */
	enqueue(descriptor: JobDescriptor): string {
		const id = crypto.randomUUID();
		const now = nowISO();

		const job: JobRecord = {
			id,
			type: descriptor.type,
			label: descriptor.label ?? descriptor.type,
			status: 'pending',
			payload: descriptor.payload ?? {},
			priority: descriptor.priority ?? 10,
			createdAt: now,
		};

		this.jobs.set(id, job);

		// Insert into queue maintaining priority order (lower number = first)
		const insertIdx = this.queue.findIndex((qId) => {
			const qJob = this.jobs.get(qId);
			return qJob && qJob.priority > job.priority;
		});
		if (insertIdx === -1) {
			this.queue.push(id);
		} else {
			this.queue.splice(insertIdx, 0, id);
		}

		this.logger.debug(`Job enqueued: [${job.type}] ${job.label} (${id})`);
		this.processQueue();
		return id;
	}

	/**
	 * Get a job by id.
	 */
	getJob(id: string): JobRecord | undefined {
		return this.jobs.get(id);
	}

	/**
	 * List all jobs, optionally filtered by type and/or status.
	 */
	listJobs(filter?: { type?: string; status?: string }): JobRecord[] {
		let result = Array.from(this.jobs.values());
		if (filter?.type) {
			result = result.filter((j) => j.type === filter.type);
		}
		if (filter?.status) {
			result = result.filter((j) => j.status === filter.status);
		}
		// Most recent first
		return result.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}

	/**
	 * Register a cleanup callback for a running job (e.g. to kill an FFmpeg process).
	 */
	setOnCancel(jobId: string, callback: () => void): void {
		this.onCancelCallbacks.set(jobId, callback);
	}

	/**
	 * Cancel a pending or running job.
	 * For running jobs, calls the onCancel callback if registered.
	 */
	cancel(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job) return false;

		if (job.status === 'pending') {
			const idx = this.queue.indexOf(id);
			if (idx !== -1) this.queue.splice(idx, 1);
		} else if (job.status === 'running') {
			const callback = this.onCancelCallbacks.get(id);
			if (callback) {
				try {
					callback();
				} catch (err: any) {
					this.logger.warn(`onCancel callback error for job ${id}: ${err.message}`);
				}
				this.onCancelCallbacks.delete(id);
			}
			this.running.delete(id);
		} else {
			return false;
		}

		job.status = 'failed';
		job.error = 'Cancelled';
		job.completedAt = nowISO();
		this.emitJobEvent(WsEvent.JOB_FAILED, job);
		this.processQueue();
		return true;
	}

	/**
	 * Pause a running job. Stops the process but keeps the job record.
	 */
	pause(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.status !== 'running') return false;

		const callback = this.onCancelCallbacks.get(id);
		if (callback) {
			try { callback(); } catch {}
			this.onCancelCallbacks.delete(id);
		}
		this.running.delete(id);
		job.status = 'paused';
		this.emitJobEvent(WsEvent.JOB_PROGRESS, job);
		this.logger.log(`Job paused: [${job.type}] ${job.label}`);
		this.processQueue();
		return true;
	}

	/**
	 * Resume a paused job.
	 */
	resume(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.status !== 'paused') return false;

		job.status = 'pending';
		// Re-enqueue at front of queue (high priority)
		this.queue.unshift(id);
		this.logger.log(`Job resumed: [${job.type}] ${job.label}`);
		this.processQueue();
		return true;
	}

	/**
	 * Find jobs whose payload matches a key/value pair.
	 */
	findJobsByPayload(
		key: string,
		value: unknown,
		type?: string,
		statuses?: string[],
	): JobRecord[] {
		const result: JobRecord[] = [];
		for (const job of this.jobs.values()) {
			if (job.payload?.[key] !== value) continue;
			if (type && job.type !== type) continue;
			if (statuses && !statuses.includes(job.status)) continue;
			result.push(job);
		}
		return result;
	}

	/**
	 * Cancel all pending/running jobs matching a payload key/value.
	 */
	cancelByPayload(key: string, value: unknown, type?: string): JobRecord[] {
		const jobs = this.findJobsByPayload(key, value, type, ['pending', 'running']);
		const cancelled: JobRecord[] = [];
		for (const job of jobs) {
			if (this.cancel(job.id)) {
				cancelled.push(job);
			}
		}
		return cancelled;
	}

	/**
	 * Remove completed/failed jobs older than the given age (ms).
	 * Called internally for housekeeping.
	 */
	pruneOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
		const cutoff = Date.now() - maxAgeMs;
		let removed = 0;
		for (const [id, job] of this.jobs) {
			if (
				(job.status === 'completed' || job.status === 'failed') &&
				new Date(job.createdAt).getTime() < cutoff
			) {
				this.jobs.delete(id);
				removed++;
			}
		}
		return removed;
	}

	// ===========================================================
	// Scheduled / Recurring Jobs
	// ===========================================================

	/**
	 * Register a recurring job that enqueues a descriptor at an interval.
	 */
	schedule(options: ScheduledJobOptions): void {
		if (this.scheduledJobs.has(options.name)) {
			this.unschedule(options.name);
		}

		const task = new AsyncTask(
			options.name,
			async () => {
				this.enqueue(options.job);
			},
			(err) => {
				this.logger.error(`Scheduled job "${options.name}" error: ${err.message}`);
			},
		);

		const job = new SimpleIntervalJob(
			{ milliseconds: options.intervalMs, runImmediately: options.runImmediately ?? false },
			task,
			{ id: options.name },
		);

		this.scheduler.addSimpleIntervalJob(job);
		this.scheduledJobs.set(options.name, job);
		this.logger.log(`Scheduled job "${options.name}" every ${options.intervalMs}ms`);
	}

	/**
	 * Remove a scheduled recurring job.
	 */
	unschedule(name: string): void {
		if (this.scheduledJobs.has(name)) {
			this.scheduler.removeById(name);
			this.scheduledJobs.delete(name);
			this.logger.log(`Unscheduled job "${name}"`);
		}
	}

	/**
	 * List names of all registered scheduled jobs.
	 */
	listScheduledJobs(): string[] {
		return Array.from(this.scheduledJobs.keys());
	}

	// ===========================================================
	// Internal Queue Processing
	// ===========================================================

	private processQueue(): void {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const maxConcurrency = enc?.maxConcurrentJobs ?? this.maxConcurrency;
		while (this.running.size < maxConcurrency && this.queue.length > 0) {
			const jobId = this.queue.shift();
			if (!jobId) break;

			const job = this.jobs.get(jobId);
			if (!job || job.status !== 'pending') continue;

			const handler = this.handlers.get(job.type);
			if (!handler) {
				this.logger.warn(`No handler for job type "${job.type}" — skipping ${jobId}`);
				job.status = 'failed';
				job.error = `No handler registered for type "${job.type}"`;
				job.completedAt = nowISO();
				this.emitJobEvent(WsEvent.JOB_FAILED, job);
				continue;
			}

			this.runJob(job, handler);
		}
	}

	private async runJob(job: JobRecord, handler: JobHandler): Promise<void> {
		job.status = 'running';
		job.startedAt = nowISO();
		this.running.add(job.id);
		this.emitJobEvent(WsEvent.JOB_STARTED, job);

		const helpers: JobHelpers = {
			reportProgress: (percent: number) => {
				job.progress = Math.min(100, Math.max(0, percent));
				this.emitJobEvent(WsEvent.JOB_PROGRESS, job);
			},
			log: (msg: string) => {
				this.logger.debug(`[${job.type}:${job.id.slice(0, 8)}] ${msg}`);
			},
		};

		const startTime = performance.now();

		try {
			const result = await handler(job, helpers);
			job.status = 'completed';
			job.progress = 100;
			job.result = result;
			job.completedAt = nowISO();
			this.emitJobEvent(WsEvent.JOB_COMPLETED, job);
			const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
			this.logger.log(`Job completed: [${job.type}] ${job.label} (${job.id}) in ${elapsed}s`);
		} catch (err: any) {
			job.status = 'failed';
			job.error = err?.message ?? 'Unknown error';
			job.completedAt = nowISO();
			this.emitJobEvent(WsEvent.JOB_FAILED, job);
			const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
			this.logger.error(
				`Job failed: [${job.type}] ${job.label} — ${job.error} (after ${elapsed}s)`,
			);
		} finally {
			this.running.delete(job.id);
			this.onCancelCallbacks.delete(job.id);
			this.writeJobHistory(job, startTime);
			this.processQueue();
		}
	}

	private writeJobHistory(job: JobRecord, startTime: number): void {
		try {
			const durationMs = Math.round(performance.now() - startTime);
			this.database.db.insert(jobHistory).values({
				id: job.id,
				type: job.type,
				label: job.label,
				status: job.status,
				payload: job.payload ? JSON.stringify(job.payload) : null,
				priority: job.priority,
				progress: job.progress ?? 0,
				result: job.result ? JSON.stringify(job.result) : null,
				error: job.error ?? null,
				createdAt: job.createdAt,
				startedAt: job.startedAt ?? null,
				completedAt: job.completedAt ?? null,
				durationMs,
				movieId: (job.payload?.movieId as string) ?? null,
				movieTitle: (job.payload?.movieTitle as string) ?? job.label,
				filePath: (job.payload?.filePath as string) ?? null,
				quality: (job.payload?.quality as string) ?? null,
			}).run();
		} catch (err: any) {
			this.logger.warn(`Failed to write job history: ${err.message}`);
		}
	}

	private emitJobEvent(event: WsEvent, job: JobRecord): void {
		this.events.emit(event, {
			id: job.id,
			type: job.type,
			label: job.label,
			status: job.status,
			progress: job.progress,
			error: job.error,
			payload: job.payload,
		});
	}

	// ===========================================================
	// Lifecycle
	// ===========================================================

	onModuleDestroy(): void {
		// Mark all running jobs as interrupted
		const runningCount = this.running.size;
		for (const jobId of [...this.running]) {
			const job = this.jobs.get(jobId);
			if (!job) continue;
			const callback = this.onCancelCallbacks.get(jobId);
			if (callback) {
				try {
					callback();
				} catch {}
				this.onCancelCallbacks.delete(jobId);
			}
			job.status = 'failed';
			job.error = 'Server shutdown';
			job.completedAt = nowISO();
		}
		this.running.clear();

		// Mark pending jobs
		const pendingCount = this.queue.length;
		for (const jobId of this.queue) {
			const job = this.jobs.get(jobId);
			if (job) {
				job.status = 'failed';
				job.error = 'Server shutdown';
				job.completedAt = nowISO();
			}
		}
		this.queue.length = 0;

		if (runningCount > 0 || pendingCount > 0) {
			this.logger.warn(
				`Graceful shutdown: interrupted ${runningCount} running and ${pendingCount} pending jobs`,
			);
		}

		this.scheduler.stop();
		this.scheduledJobs.clear();
		this.logger.log('Job manager stopped');
	}
}
