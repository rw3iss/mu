export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobDescriptor {
	/** Unique job type identifier, e.g. 'scan', 'metadata', 'thumbnail', 'cleanup' */
	type: string;
	/** Human-readable label shown in UI / logs */
	label?: string;
	/** Arbitrary payload passed to the handler */
	payload?: Record<string, unknown>;
	/** Priority (lower = higher priority). Default 10 */
	priority?: number;
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
