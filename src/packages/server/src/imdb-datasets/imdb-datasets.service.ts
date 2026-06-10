import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { BasicsSyncService } from './basics-sync.service.js';
import type { DatasetSync } from './dataset-sync.interface.js';
import { RatingsSyncService } from './ratings-sync.service.js';

/** Run roughly daily (24h). The IMDB datasets refresh once per day,
 *  so anything tighter than that wastes bandwidth without adding
 *  freshness. */
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const JOB_NAME = 'imdb-datasets:ratings-sync';
/** Hour-of-day (server local time) for the first sync of each day.
 *  3 AM is the "no one is browsing" window — keeps the 5–10 min
 *  write-heavy phase off the user-facing critical path so SQLite
 *  WAL contention doesn't slow library reads. Overridable via
 *  `imdb.datasets.syncHour` setting. */
const DEFAULT_SYNC_HOUR = 3;

export interface SyncStatus {
	id: string;
	displayName: string;
	approxSizeMb: number;
	rowCount: number;
	lastSyncAt: string | null;
	lastSyncDurationMs: number | null;
	lastError: string | null;
	running: boolean;
}

/**
 * Owns the lifecycle of every IMDB bulk-dataset sync. Today there's
 * only one (ratings) but the registry is plural so the next dataset
 * — title.basics, title.principals, etc. — slots in without
 * restructuring scheduling, status, or HTTP surfaces.
 *
 * Settings:
 *   imdb.datasets.enabled         (bool, default false)
 *     The master switch. When false, no scheduled sync runs.
 *   imdb.datasets.lastSyncAt.<id> (ISO date string)
 *     Written after each successful sync per dataset.
 *   imdb.datasets.lastError.<id>  (string)
 *     Written on failure; cleared on success.
 */
@Injectable()
export class ImdbDatasetsService implements OnModuleInit {
	private readonly logger = new Logger('ImdbDatasets');
	private readonly registry: DatasetSync[];
	private readonly running = new Set<string>();
	private readonly lastDuration = new Map<string, number>();
	/** Pending first-run anchor so reconciles don't stack timers. */
	private firstRunTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly settings: SettingsService,
		private readonly jobs: JobManagerService,
		private readonly ratings: RatingsSyncService,
		private readonly basics: BasicsSyncService,
	) {
		this.registry = [this.ratings, this.basics];
	}

	onModuleInit(): void {
		// Handler executes whenever the scheduled tick fires AND when
		// an admin clicks "Sync now" (which enqueues via the same job
		// type to keep the lifecycle uniform).
		this.jobs.registerHandler('imdb-datasets-sync', async () => {
			await this.syncAll();
		});
		this.reconcileSchedule();
	}

	/** Admin-triggered manual sync — enqueues a job rather than running
	 *  inline so progress + history flow through the standard job UI. */
	triggerManualSync(): string {
		return this.jobs.enqueue({
			type: 'imdb-datasets-sync',
			label: 'IMDB datasets — manual sync',
			payload: { source: 'manual' },
			priority: 100,
			idleOnly: true,
		});
	}

	/**
	 * Bring the JobManager's scheduled job in sync with the
	 * `imdb.datasets.enabled` setting. Idempotent — safe to call
	 * after a settings change.
	 */
	reconcileSchedule(): void {
		const enabled = this.isEnabled();
		if (this.firstRunTimer) {
			clearTimeout(this.firstRunTimer);
			this.firstRunTimer = null;
		}
		if (!enabled) {
			this.jobs.unschedule(JOB_NAME);
			return;
		}
		// Anchor the first run to the configured off-peak hour so users
		// don't see WAL contention during normal browsing. Once the
		// first run fires, the 24h SimpleIntervalJob keeps it daily at
		// the same wall-clock time without further babysitting.
		const targetHour = this.settings.get<number>('imdb.datasets.syncHour', DEFAULT_SYNC_HOUR);
		const delay = this.msUntilHour(targetHour);
		this.jobs.unschedule(JOB_NAME); // clear any previous schedule
		this.firstRunTimer = setTimeout(() => {
			this.firstRunTimer = null;
			this.jobs.schedule({
				name: JOB_NAME,
				intervalMs: DAILY_INTERVAL_MS,
				runImmediately: true, // first tick is NOW (we're at target hour)
				job: {
					type: 'imdb-datasets-sync',
					label: 'IMDB datasets — daily sync',
					payload: {},
					priority: 90,
					// Defers start until NO other job is running, so the nightly
					// refresh never competes with encodes/scans for the disk.
					idleOnly: true,
				},
			});
			this.logger.log('Daily IMDB datasets sync now active');
		}, delay);
		const mins = Math.round(delay / 60000);
		this.logger.log(
			`First IMDB datasets sync scheduled for hour ${targetHour} (in ~${mins} min)`,
		);
	}

	/** Milliseconds until the next instance of `hour` (0–23) in local time. */
	private msUntilHour(hour: number): number {
		const now = new Date();
		const target = new Date(now);
		target.setHours(hour, 0, 0, 0);
		if (target.getTime() <= now.getTime()) {
			target.setDate(target.getDate() + 1);
		}
		return target.getTime() - now.getTime();
	}

	/**
	 * Run every enabled dataset sync now. Used by the job-runner
	 * worker (when the scheduled tick fires) and by the admin
	 * "Sync now" button. Concurrent calls per dataset are short-
	 * circuited so a manual sync during the scheduled window won't
	 * double-download.
	 */
	async syncAll(): Promise<SyncStatus[]> {
		const results: SyncStatus[] = [];
		for (const ds of this.registry) {
			results.push(await this.syncOne(ds.id));
		}
		return results;
	}

	async syncOne(id: string): Promise<SyncStatus> {
		const ds = this.registry.find((d) => d.id === id);
		if (!ds) throw new Error(`Unknown dataset: ${id}`);
		if (this.running.has(id)) {
			return this.status(id);
		}
		this.running.add(id);
		try {
			const { durationMs } = await ds.sync();
			this.lastDuration.set(id, durationMs);
			this.settings.set(`imdb.datasets.lastSyncAt.${id}`, new Date().toISOString());
			this.settings.set(`imdb.datasets.lastError.${id}`, '');
		} catch (err: any) {
			const msg = err?.message ?? String(err);
			this.logger.error(`Sync ${id} failed: ${msg}`);
			this.settings.set(`imdb.datasets.lastError.${id}`, msg);
			throw err;
		} finally {
			this.running.delete(id);
		}
		return this.status(id);
	}

	status(id: string): SyncStatus {
		const ds = this.registry.find((d) => d.id === id);
		if (!ds) throw new Error(`Unknown dataset: ${id}`);
		const lastSyncAt = this.settings.get<string>(`imdb.datasets.lastSyncAt.${id}`, '') || null;
		const lastError = this.settings.get<string>(`imdb.datasets.lastError.${id}`, '') || null;
		return {
			id: ds.id,
			displayName: ds.displayName,
			approxSizeMb: ds.approxSizeMb,
			rowCount: ds.count(),
			lastSyncAt,
			lastSyncDurationMs: this.lastDuration.get(id) ?? null,
			lastError,
			running: this.running.has(id),
		};
	}

	listStatus(): SyncStatus[] {
		return this.registry.map((d) => this.status(d.id));
	}

	isEnabled(): boolean {
		// MU_IMDB_DATASETS=1 in the environment force-enables the whole
		// module (aux opt-in without touching settings); else the setting.
		if (process.env.MU_IMDB_DATASETS === '1' || process.env.MU_IMDB_DATASETS === 'true') {
			return true;
		}
		return this.settings.get<boolean>('imdb.datasets.enabled', false);
	}

	setEnabled(enabled: boolean): void {
		this.settings.set('imdb.datasets.enabled', enabled);
		this.reconcileSchedule();
	}
}
