export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export interface JobDescriptor {
	/** Unique job type identifier, e.g. 'scan', 'metadata', 'thumbnail', 'cleanup' */
	type: string;
	/** Human-readable label shown in UI / logs */
	label?: string;
	/** Arbitrary payload passed to the handler */
	payload?: Record<string, unknown>;
	/** Priority (lower = higher priority). Default 10 */
	priority?: number;
	/**
	 * Human-readable summary of what the job is doing, shown under the label
	 * in the Jobs UI — e.g. "HEVC/MKV → AV1/MP4 (GPU re-encode)". Set at enqueue
	 * and refined at runtime via `helpers.setDetails()`.
	 */
	details?: string;
	/**
	 * Defer starting until NO other job is running. For low-priority
	 * background maintenance (e.g. nightly dataset refresh) that should
	 * never compete with encodes/scans. The job stays queued until the
	 * system is idle; other queued jobs freely run past it.
	 */
	idleOnly?: boolean;
}

export interface JobRecord {
	id: string;
	type: string;
	label: string;
	status: JobStatus;
	payload: Record<string, unknown>;
	priority: number;
	progress?: number;
	result?: unknown;
	error?: string;
	details?: string;
	idleOnly?: boolean;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
}

export type JobHandler = (job: JobRecord, helpers: JobHelpers) => Promise<unknown>;

export interface JobHelpers {
	/** Report progress (0-100) */
	reportProgress(percent: number): void;
	/** Log a message */
	log(message: string): void;
	/** Update the job's human-readable details line (what it's doing now). */
	setDetails(details: string): void;
}

export interface ScheduledJobOptions {
	/** Unique name for the scheduled job */
	name: string;
	/** Interval in milliseconds */
	intervalMs: number;
	/** Run immediately on registration */
	runImmediately?: boolean;
	/** Job descriptor to enqueue on each tick */
	job: JobDescriptor;
}
