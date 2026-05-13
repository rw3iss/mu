import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import type { JobRecord } from '../jobs/job.interface.js';
import { SettingsService } from '../settings/settings.service.js';

const JOB_TYPE = 'external-eviction';
const SCHEDULE_NAME = 'external-eviction-scheduled';
const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_DAYS = 60;

/**
 * Periodically prunes `source='external'` movies that haven't been
 * touched for the configured retention window. Bookmarks (`source='bookmark'`)
 * and library entries are untouched — eviction only targets the
 * cache layer we maintain for ranking unowned candidates.
 *
 * Retention is read from `matching.externalEvictionDays`:
 *   - number → days
 *   - `-1` or `'never'` → eviction disabled
 *
 * `cascade DELETE` on movie_files / movie_metadata / movie_embeddings /
 * movie_external_recs takes care of dependents automatically (FK
 * cascades already set on those tables).
 */
@Injectable()
export class ExternalEvictionService implements OnModuleInit {
	private readonly logger = new Logger('ExternalEvictionService');

	constructor(
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly jobs: JobManagerService,
	) {}

	onModuleInit(): void {
		this.jobs.registerHandler(JOB_TYPE, (job) => this.handle(job));
		this.jobs.schedule({
			name: SCHEDULE_NAME,
			intervalMs: ONE_HOUR_MS,
			runImmediately: false,
			job: {
				type: JOB_TYPE,
				label: 'Evict stale external movie cache entries',
				priority: 50,
			},
		});
	}

	/** Manual trigger (used by admin tooling / tests). */
	runNow(): void {
		this.jobs.enqueue({
			type: JOB_TYPE,
			label: 'External eviction (manual)',
			priority: 20,
		});
	}

	private async handle(_job: JobRecord): Promise<unknown> {
		const days = this.retentionDays();
		if (days < 0) {
			return { skipped: 'eviction disabled' };
		}
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
		// Cascade deletes movie_metadata / movie_files / movie_embeddings /
		// movie_external_recs that FK back to movies(id).
		const result = this.database.db
			.delete(movies)
			.where(and(eq(movies.source, 'external'), lte(movies.updatedAt, cutoff)))
			.run();
		const removed = result.changes ?? 0;
		if (removed > 0) {
			this.logger.log(
				`Evicted ${removed} stale external movie(s) (older than ${days} days, < ${cutoff})`,
			);
		}
		// Also tidy orphan movie_external_recs whose target_movie_id was
		// just deleted — the cascade only fires when the FK is set; rows
		// pointing at the dropped movie via target_tmdb without target_movie_id
		// are kept (they're still useful catalog data).
		void sql; // imported for type checker; nothing to call now
		return { removed, cutoff, retentionDays: days };
	}

	private retentionDays(): number {
		const raw = this.settings.get<number | string | null>(
			'matching.externalEvictionDays',
			DEFAULT_DAYS,
		);
		if (raw == null) return DEFAULT_DAYS;
		if (typeof raw === 'string') {
			if (raw === 'never') return -1;
			const n = parseInt(raw, 10);
			return Number.isFinite(n) ? n : DEFAULT_DAYS;
		}
		return Number.isFinite(raw as number) ? (raw as number) : DEFAULT_DAYS;
	}
}
