import type { JobDescriptor, JobHandler, JobRecord, ScheduledJobOptions } from './job.interface.js';

/**
 * Abstract job-runner contract. Concrete implementations:
 *
 *   - `InMemoryJobProvider` — default, single-process, priority queue
 *     + toad-scheduler. No external dependencies.
 *
 *   - `BullMqJobProvider` — Redis-backed, persistent across restarts,
 *     supports multi-worker horizontal scaling and delayed retries.
 *     Selected via `jobs.backend: bullmq` in config.yml.
 *
 * Callers inject `JobManagerService` and never need to know which
 * backend is active — the `JobModule` factory picks one based on
 * config at bootstrap. The public surface is identical; backend-
 * specific behaviour (eg. distributed locks, retry-after-delay) lives
 * inside the provider implementations.
 *
 * To add a third backend later (e.g. AWS SQS, Cloudflare Queues),
 * extend this class and add a `case` branch in the module factory.
 */
export abstract class JobManagerService {
	// ===========================================================
	// Handler registration
	// ===========================================================

	abstract registerHandler(type: string, handler: JobHandler): void;

	/**
	 * Library-job-only callback so JobController can list movie IDs
	 * that still need transcoding. Optional — BullMQ backend can
	 * provide a no-op implementation.
	 */
	abstract registerUntranscodedMovieIdsFn(fn: () => string[]): void;
	abstract getUntranscodedMovieIds(): string[];

	// ===========================================================
	// One-off jobs
	// ===========================================================

	abstract enqueue(descriptor: JobDescriptor): string;
	abstract getJob(id: string): JobRecord | undefined;
	abstract listJobs(filter?: { type?: string; status?: string }): JobRecord[];
	abstract prioritize(id: string): boolean;
	abstract setOnCancel(jobId: string, callback: () => void): void;
	abstract cancel(id: string): boolean;
	abstract pause(id: string): boolean;
	abstract resume(id: string): boolean;
	abstract retry(id: string): { ok: true; newId: string } | { ok: false; reason: string };
	abstract findJobsByPayload(
		key: string,
		value: unknown,
		type?: string,
		statuses?: string[],
	): JobRecord[];
	abstract cancelByPayload(key: string, value: unknown, type?: string): JobRecord[];
	abstract pruneOldJobs(maxAgeMs?: number): number;

	// ===========================================================
	// Scheduled (recurring) jobs
	// ===========================================================

	abstract schedule(options: ScheduledJobOptions): void;
	abstract unschedule(name: string): void;
	abstract listScheduledJobs(): string[];
}
