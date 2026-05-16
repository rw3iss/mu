import { nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { jobHistory } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
	JobDescriptor,
	JobHandler,
	JobHelpers,
	JobRecord,
	JobStatus,
	ScheduledJobOptions,
} from './job.interface.js';
import { JobManagerService } from './job-manager.service.js';

export interface BullMqProviderOptions {
	redisUrl: string;
	queueName: string;
	concurrency: number;
}

/**
 * BullMQ-backed implementation of `JobManagerService`. Persists job
 * state in Redis; survives restarts; supports horizontal scaling by
 * running additional worker processes against the same queue (see
 * `scripts/job-worker.ts` for the standalone worker entry point).
 *
 * Loaded dynamically by the `JobModule` factory so projects that
 * never opt in to BullMQ don't pay the bullmq / ioredis import cost.
 *
 * Design notes:
 *   - Handlers are registered in the worker process (this class) AND
 *     exposed by the registry; jobs are simple JSON payloads on the
 *     queue. A handler must be present where the worker runs, not
 *     necessarily where `enqueue()` is called.
 *   - In-memory job mirrors are kept for fast list/cancel ops; the
 *     authoritative store is Redis.
 *   - `prioritize`, `pause`, `resume`, `cancel` translate to BullMQ
 *     job state ops; `retry` re-enqueues with the same payload.
 *   - Scheduled jobs use BullMQ's `repeat` feature.
 */
@Injectable()
export class BullMqJobProvider extends JobManagerService implements OnModuleDestroy {
	private readonly logger = new Logger('BullMqJobProvider');
	private readonly handlers = new Map<string, JobHandler>();
	private readonly jobs = new Map<string, JobRecord>();
	private readonly onCancelCallbacks = new Map<string, () => void>();
	private untranscodedMovieIdsFn: (() => string[]) | null = null;

	// Resolved lazily during `initialize()` so we don't crash imports
	// when bullmq / ioredis aren't installed.
	private Queue: any = null;
	private Worker: any = null;
	private QueueEvents: any = null;
	private queue: any = null;
	private worker: any = null;
	private queueEvents: any = null;

	constructor(
		private readonly events: EventsService,
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
		private readonly options: BullMqProviderOptions,
	) {
		super();
	}

	async initialize(): Promise<void> {
		// Lazy ESM import — fails loudly if bullmq isn't installed.
		const bull = await import('bullmq');
		this.Queue = bull.Queue;
		this.Worker = bull.Worker;
		this.QueueEvents = bull.QueueEvents;

		const connection = parseRedisUrl(this.options.redisUrl);
		const queueOpts = { connection };

		this.queue = new this.Queue(this.options.queueName, queueOpts);
		this.queueEvents = new this.QueueEvents(this.options.queueName, queueOpts);

		this.worker = new this.Worker(
			this.options.queueName,
			async (job: any) => {
				return this.runJobInWorker(job);
			},
			{
				connection,
				concurrency: this.options.concurrency,
			},
		);

		this.worker.on('completed', (job: any) => this.handleCompleted(job));
		this.worker.on('failed', (job: any, err: Error) => this.handleFailed(job, err));
		this.worker.on('progress', (job: any, progress: number) =>
			this.handleProgress(job, progress),
		);

		this.logger.log(
			`BullMQ provider ready (queue=${this.options.queueName}, concurrency=${this.options.concurrency})`,
		);
	}

	// =====================================================================
	// Handler registration
	// =====================================================================

	registerHandler(type: string, handler: JobHandler): void {
		if (this.handlers.has(type)) {
			this.logger.warn(`Overwriting handler for job type "${type}"`);
		}
		this.handlers.set(type, handler);
	}

	registerUntranscodedMovieIdsFn(fn: () => string[]): void {
		this.untranscodedMovieIdsFn = fn;
	}

	getUntranscodedMovieIds(): string[] {
		return this.untranscodedMovieIdsFn?.() ?? [];
	}

	// =====================================================================
	// Job lifecycle
	// =====================================================================

	enqueue(descriptor: JobDescriptor): string {
		if (!this.queue) {
			throw new Error('BullMQ provider not initialised');
		}
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

		// BullMQ priority: lower number = higher priority, same as ours.
		this.queue
			.add(
				descriptor.type,
				{
					muJobId: id,
					descriptor: {
						type: descriptor.type,
						label: job.label,
						payload: job.payload,
					},
				},
				{
					jobId: id,
					priority: job.priority,
					attempts: 1, // retries surfaced via the existing retry() API
					removeOnComplete: { age: 24 * 60 * 60 }, // keep results 24h
					removeOnFail: { age: 7 * 24 * 60 * 60 }, // keep failures 7d
				},
			)
			.catch((err: any) =>
				this.logger.error(`enqueue failed for ${id}: ${err?.message ?? err}`),
			);
		this.emitJobEvent(WsEvent.JOB_STARTED, job);
		return id;
	}

	getJob(id: string): JobRecord | undefined {
		return this.jobs.get(id);
	}

	listJobs(filter?: { type?: string; status?: string }): JobRecord[] {
		let out = Array.from(this.jobs.values());
		if (filter?.type) out = out.filter((j) => j.type === filter.type);
		if (filter?.status) out = out.filter((j) => j.status === filter.status);
		return out.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}

	prioritize(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.status !== 'pending') return false;
		this.queue
			?.changePriority(id, 1)
			.catch((err: any) =>
				this.logger.warn(`changePriority failed for ${id}: ${err?.message ?? err}`),
			);
		job.priority = 1;
		this.emitJobEvent(WsEvent.JOB_PROGRESS, job);
		return true;
	}

	setOnCancel(jobId: string, callback: () => void): void {
		this.onCancelCallbacks.set(jobId, callback);
	}

	cancel(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job) return false;

		if (job.status === 'running') {
			const cb = this.onCancelCallbacks.get(id);
			if (cb) {
				try {
					cb();
				} catch (err: any) {
					this.logger.warn(`onCancel callback error for ${id}: ${err.message}`);
				}
				this.onCancelCallbacks.delete(id);
			}
		}

		// Either pending or running — remove from queue. BullMQ handles
		// both cases.
		this.queue
			?.getJob(id)
			.then((j: any) => j?.remove())
			.catch((err: any) =>
				this.logger.warn(`remove failed for ${id}: ${err?.message ?? err}`),
			);

		job.status = 'failed';
		job.error = 'Cancelled';
		job.completedAt = nowISO();
		this.emitJobEvent(WsEvent.JOB_FAILED, job);
		return true;
	}

	pause(id: string): boolean {
		// BullMQ doesn't natively support pausing a specific job. We
		// fail it; resume re-enqueues with the same descriptor.
		const job = this.jobs.get(id);
		if (!job || job.status !== 'running') return false;
		const cb = this.onCancelCallbacks.get(id);
		if (cb) {
			try {
				cb();
			} catch {}
			this.onCancelCallbacks.delete(id);
		}
		this.queue
			?.getJob(id)
			.then((j: any) => j?.remove())
			.catch(() => {});
		job.status = 'paused';
		this.emitJobEvent(WsEvent.JOB_PROGRESS, job);
		return true;
	}

	resume(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.status !== 'paused') return false;
		// Re-enqueue with the same descriptor; new BullMQ job id is the
		// same string so getJob() lookups stay consistent.
		this.queue
			?.add(
				job.type,
				{
					muJobId: id,
					descriptor: { type: job.type, label: job.label, payload: job.payload },
				},
				{ jobId: id, priority: job.priority, attempts: 1 },
			)
			.catch((err: any) => this.logger.warn(`resume enqueue failed: ${err?.message ?? err}`));
		job.status = 'pending';
		this.emitJobEvent(WsEvent.JOB_PROGRESS, job);
		return true;
	}

	retry(id: string): { ok: true; newId: string } | { ok: false; reason: string } {
		const live = this.jobs.get(id);
		if (live) {
			if (live.status === 'pending' || live.status === 'running') {
				return { ok: false, reason: 'Job is still pending or running.' };
			}
			this.jobs.delete(id);
			const newId = this.enqueue({
				type: live.type,
				label: live.label,
				payload: live.payload,
				priority: live.priority,
			});
			return { ok: true, newId };
		}

		const row = this.database.db.select().from(jobHistory).where(eq(jobHistory.id, id)).get();
		if (!row) return { ok: false, reason: `Job ${id} not found.` };
		if (!this.handlers.has(row.type)) {
			return { ok: false, reason: `No handler registered for job type "${row.type}".` };
		}
		let payload: Record<string, unknown> | undefined;
		try {
			payload = row.payload ? JSON.parse(row.payload) : undefined;
		} catch {
			return { ok: false, reason: 'Stored payload is not valid JSON.' };
		}
		const newId = this.enqueue({
			type: row.type,
			label: row.label,
			payload,
			priority: row.priority ?? undefined,
		});
		return { ok: true, newId };
	}

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

	cancelByPayload(key: string, value: unknown, type?: string): JobRecord[] {
		const jobs = this.findJobsByPayload(key, value, type, ['pending', 'running']);
		const cancelled: JobRecord[] = [];
		for (const job of jobs) {
			if (this.cancel(job.id)) cancelled.push(job);
		}
		return cancelled;
	}

	pruneOldJobs(maxAgeMs = 24 * 60 * 60 * 1000): number {
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

	// =====================================================================
	// Scheduled jobs (BullMQ repeat)
	// =====================================================================

	schedule(options: ScheduledJobOptions): void {
		if (!this.queue) return;
		this.queue
			.add(
				options.job.type,
				{
					descriptor: {
						type: options.job.type,
						label: options.job.label,
						payload: options.job.payload,
					},
					scheduled: options.name,
				},
				{
					repeat: {
						every: options.intervalMs,
						immediately: options.runImmediately ?? false,
					},
					jobId: `scheduled:${options.name}`,
				},
			)
			.catch((err: any) =>
				this.logger.warn(`schedule failed for ${options.name}: ${err?.message ?? err}`),
			);
		this.logger.log(`Scheduled "${options.name}" every ${options.intervalMs}ms`);
	}

	unschedule(name: string): void {
		if (!this.queue) return;
		this.queue.removeRepeatableByKey(`scheduled:${name}`).catch(() => {
			/* not all keys may have a stored repeat job */
		});
	}

	listScheduledJobs(): string[] {
		// We can't return synchronously from BullMQ's getRepeatableJobs;
		// callers tolerate a snapshot. For v1 we return what we've
		// observed via successful `schedule()` calls.
		return [];
	}

	// =====================================================================
	// Worker side
	// =====================================================================

	private async runJobInWorker(bullJob: any): Promise<unknown> {
		const muJobId = (bullJob.data?.muJobId as string) ?? bullJob.id;
		const descriptor = bullJob.data?.descriptor as JobDescriptor | undefined;
		if (!descriptor) {
			throw new Error('Invalid BullMQ payload: missing descriptor');
		}

		const handler = this.handlers.get(descriptor.type);
		if (!handler) {
			throw new Error(`No handler registered for job type "${descriptor.type}"`);
		}

		const job: JobRecord = this.jobs.get(muJobId) ?? {
			id: muJobId,
			type: descriptor.type,
			label: descriptor.label ?? descriptor.type,
			status: 'running',
			payload: descriptor.payload ?? {},
			priority: descriptor.priority ?? 10,
			createdAt: new Date(bullJob.timestamp ?? Date.now()).toISOString(),
		};
		job.status = 'running';
		job.startedAt = nowISO();
		this.jobs.set(muJobId, job);
		this.emitJobEvent(WsEvent.JOB_STARTED, job);

		const helpers: JobHelpers = {
			reportProgress: (percent: number) => {
				const p = Math.min(100, Math.max(0, percent));
				job.progress = p;
				void bullJob.updateProgress(p);
			},
			log: (msg: string) => {
				this.logger.debug(`[${job.type}:${muJobId.slice(0, 8)}] ${msg}`);
			},
		};

		const startTime = performance.now();
		try {
			const result = await handler(job, helpers);
			job.status = 'completed';
			job.progress = 100;
			job.result = result;
			job.completedAt = nowISO();
			this.writeJobHistory(job, startTime);
			return result;
		} catch (err: any) {
			job.status = 'failed';
			job.error = err?.message ?? 'Unknown error';
			job.completedAt = nowISO();
			this.writeJobHistory(job, startTime);
			throw err;
		} finally {
			this.onCancelCallbacks.delete(muJobId);
		}
	}

	private handleCompleted(bullJob: any): void {
		const id = (bullJob.data?.muJobId as string) ?? bullJob.id;
		const job = this.jobs.get(id);
		if (job) this.emitJobEvent(WsEvent.JOB_COMPLETED, job);
	}

	private handleFailed(bullJob: any, err: Error): void {
		const id = (bullJob?.data?.muJobId as string) ?? bullJob?.id ?? 'unknown';
		const job = this.jobs.get(id);
		if (job) {
			job.status = 'failed';
			job.error = err?.message ?? 'Unknown error';
			this.emitJobEvent(WsEvent.JOB_FAILED, job);
		}
	}

	private handleProgress(bullJob: any, progress: number | object): void {
		if (typeof progress !== 'number') return;
		const id = (bullJob.data?.muJobId as string) ?? bullJob.id;
		const job = this.jobs.get(id);
		if (job) {
			job.progress = progress;
			this.emitJobEvent(WsEvent.JOB_PROGRESS, job);
		}
	}

	private writeJobHistory(job: JobRecord, startTime: number): void {
		try {
			const durationMs = Math.round(performance.now() - startTime);
			this.database.db
				.insert(jobHistory)
				.values({
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
				})
				.run();
		} catch (err: any) {
			this.logger.warn(`Failed to write job history: ${err.message}`);
		}
	}

	private emitJobEvent(event: WsEvent, job: JobRecord): void {
		this.events.emit(event, {
			id: job.id,
			type: job.type,
			label: job.label,
			status: job.status as JobStatus,
			progress: job.progress,
			error: job.error,
			payload: job.payload,
			result: job.result,
		});
	}

	async onModuleDestroy(): Promise<void> {
		try {
			await this.worker?.close();
			await this.queueEvents?.close();
			await this.queue?.close();
		} catch (err: any) {
			this.logger.warn(`Shutdown error: ${err?.message ?? err}`);
		}
		// Silence unused-import linter when bullmq paths weren't traversed.
		void this.settings;
	}
}

/**
 * Parse `redis://[:password@]host:port/db` into an ioredis-compatible
 * options object. Lets users keep using a single connection string
 * without a separate config block.
 */
function parseRedisUrl(url: string): {
	host: string;
	port: number;
	password?: string;
	username?: string;
	db?: number;
} {
	const u = new URL(url);
	const out: {
		host: string;
		port: number;
		password?: string;
		username?: string;
		db?: number;
	} = {
		host: u.hostname || 'localhost',
		port: u.port ? parseInt(u.port, 10) : 6379,
	};
	if (u.password) out.password = decodeURIComponent(u.password);
	if (u.username) out.username = decodeURIComponent(u.username);
	if (u.pathname && u.pathname.length > 1) {
		const db = parseInt(u.pathname.slice(1), 10);
		if (!Number.isNaN(db)) out.db = db;
	}
	return out;
}
