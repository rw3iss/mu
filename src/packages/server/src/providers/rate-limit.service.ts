import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { providerUsage } from '../database/schema/index.js';
import { BudgetExhausted, RateLimitExceeded } from './exceptions.js';
import type { RateLimitSpec } from './provider.interface.js';
import { ProviderRegistry } from './provider-registry.service.js';

interface InMemBucket {
	count: number;
	startedAt: number;
}

interface UsageSnapshot {
	second: number;
	minute: number;
	day: number;
	month: number;
	monthCost: number;
}

/**
 * Token-bucket rate limiter + USD budget enforcer.
 *
 * Sub-day windows (`second`, `minute`) live in memory — cheap, no DB
 * round-trip in the hot path. Day / month windows are persisted to
 * `provider_usage` so they survive restarts: callers (job runner,
 * direct API code) call `acquire()` before every outbound request,
 * `record()` after.
 *
 * Buckets advance via wall-clock truncation:
 *   - second: ISO-second key
 *   - minute: ISO-minute key
 *   - day:    YYYY-MM-DD key
 *   - month:  YYYY-MM key
 *
 * Budgets are enforced on `monthlyBudgetUsd` — a hard ceiling on
 * projected spend, never approximated.
 */
@Injectable()
export class RateLimitService {
	private readonly logger = new Logger('RateLimitService');

	/** providerId → { second: Bucket, minute: Bucket } */
	private readonly memBuckets = new Map<string, { second: InMemBucket; minute: InMemBucket }>();

	constructor(
		private readonly database: DatabaseService,
		private readonly registry: ProviderRegistry,
	) {}

	/**
	 * Throws `RateLimitExceeded` (with `retryAfterMs`) or
	 * `BudgetExhausted` if the projected next call would violate the
	 * provider's `RateLimitSpec`. On success returns silently — the
	 * caller is then responsible for calling `record()`.
	 *
	 * The split between acquire/record (vs a combined "execute under
	 * limiter" wrapper) keeps the limiter simple and lets callers
	 * record actual cost after the API returns the real billing info.
	 */
	async acquire(providerId: string, cost = 1): Promise<void> {
		const spec = this.specFor(providerId);
		if (!spec) return; // unknown provider → no-op (registry-driven)

		const snap = this.snapshot(providerId);
		const now = Date.now();

		if (spec.perSecond && snap.second + 1 > spec.perSecond) {
			const wait = this.msToBucketEnd('second', now);
			throw new RateLimitExceeded(providerId, 'second', wait);
		}
		if (spec.perMinute && snap.minute + 1 > spec.perMinute) {
			const wait = this.msToBucketEnd('minute', now);
			throw new RateLimitExceeded(providerId, 'minute', wait);
		}
		if (spec.perDay && snap.day + 1 > spec.perDay) {
			const wait = this.msToBucketEnd('day', now);
			throw new RateLimitExceeded(providerId, 'day', wait);
		}
		if (spec.perMonth && snap.month + 1 > spec.perMonth) {
			const wait = this.msToBucketEnd('month', now);
			throw new RateLimitExceeded(providerId, 'month', wait);
		}

		if (spec.monthlyBudgetUsd != null) {
			const costPerCall = spec.costPerCall ?? 0;
			const projected = snap.monthCost + costPerCall * cost;
			if (projected > spec.monthlyBudgetUsd) {
				throw new BudgetExhausted(providerId, snap.monthCost, spec.monthlyBudgetUsd);
			}
		}
	}

	/** Increment usage counters for `providerId`. Persists day/month rows. */
	record(providerId: string, cost = 1, actualCostUsd?: number): void {
		const spec = this.specFor(providerId);
		const now = Date.now();

		// In-memory buckets
		const mem = this.memBuckets.get(providerId) ?? {
			second: { count: 0, startedAt: now },
			minute: { count: 0, startedAt: now },
		};
		this.rotateMemBucket(mem.second, now, 1000);
		this.rotateMemBucket(mem.minute, now, 60 * 1000);
		mem.second.count += cost;
		mem.minute.count += cost;
		this.memBuckets.set(providerId, mem);

		// Persisted day + month
		const dayKey = this.bucketKey('day', now);
		const monthKey = this.bucketKey('month', now);
		const costUsd = actualCostUsd ?? (spec?.costPerCall ?? 0) * cost;

		this.bumpRow(providerId, 'day', dayKey, cost, costUsd);
		this.bumpRow(providerId, 'month', monthKey, cost, costUsd);
	}

	snapshot(providerId: string): UsageSnapshot {
		const now = Date.now();
		const mem = this.memBuckets.get(providerId);
		const second = mem ? this.liveCount(mem.second, now, 1000) : 0;
		const minute = mem ? this.liveCount(mem.minute, now, 60 * 1000) : 0;

		const dayKey = this.bucketKey('day', now);
		const monthKey = this.bucketKey('month', now);

		const dayRow = this.database.db
			.select({ count: providerUsage.count })
			.from(providerUsage)
			.where(
				and(
					eq(providerUsage.providerId, providerId),
					eq(providerUsage.window, 'day'),
					eq(providerUsage.bucketKey, dayKey),
				),
			)
			.get();
		const monthRow = this.database.db
			.select({ count: providerUsage.count, costUsd: providerUsage.costUsd })
			.from(providerUsage)
			.where(
				and(
					eq(providerUsage.providerId, providerId),
					eq(providerUsage.window, 'month'),
					eq(providerUsage.bucketKey, monthKey),
				),
			)
			.get();

		return {
			second,
			minute,
			day: dayRow?.count ?? 0,
			month: monthRow?.count ?? 0,
			monthCost: monthRow?.costUsd ?? 0,
		};
	}

	/** History of the last `days` daily counts, oldest → newest. */
	dailyHistory(providerId: string, days = 7): { date: string; count: number }[] {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const rows = this.database.db
			.select({
				bucketKey: providerUsage.bucketKey,
				count: providerUsage.count,
			})
			.from(providerUsage)
			.where(
				and(
					eq(providerUsage.providerId, providerId),
					eq(providerUsage.window, 'day'),
					gte(providerUsage.bucketKey, cutoff),
				),
			)
			.all();
		const byDate = new Map(rows.map((r) => [r.bucketKey, r.count]));
		const out: { date: string; count: number }[] = [];
		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
			out.push({ date: d, count: byDate.get(d) ?? 0 });
		}
		return out;
	}

	// =====================================================================
	// Private
	// =====================================================================

	private specFor(providerId: string): RateLimitSpec | null {
		return this.registry.get(providerId)?.rateLimit ?? null;
	}

	private rotateMemBucket(bucket: InMemBucket, now: number, windowMs: number): void {
		if (now - bucket.startedAt >= windowMs) {
			bucket.count = 0;
			bucket.startedAt = now;
		}
	}

	private liveCount(bucket: InMemBucket, now: number, windowMs: number): number {
		return now - bucket.startedAt >= windowMs ? 0 : bucket.count;
	}

	private bucketKey(window: 'day' | 'month', now: number): string {
		const d = new Date(now);
		if (window === 'day') return d.toISOString().slice(0, 10);
		return d.toISOString().slice(0, 7);
	}

	private msToBucketEnd(window: 'second' | 'minute' | 'day' | 'month', now: number): number {
		switch (window) {
			case 'second':
				return 1000 - (now % 1000);
			case 'minute':
				return 60_000 - (now % 60_000);
			case 'day': {
				const d = new Date(now);
				const next = new Date(d);
				next.setUTCDate(d.getUTCDate() + 1);
				next.setUTCHours(0, 0, 0, 0);
				return next.getTime() - now;
			}
			case 'month': {
				const d = new Date(now);
				const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
				return next.getTime() - now;
			}
		}
	}

	private bumpRow(
		providerId: string,
		window: 'day' | 'month',
		bucketKey: string,
		count: number,
		costUsd: number,
	): void {
		const existing = this.database.db
			.select({ count: providerUsage.count, costUsd: providerUsage.costUsd })
			.from(providerUsage)
			.where(
				and(
					eq(providerUsage.providerId, providerId),
					eq(providerUsage.window, window),
					eq(providerUsage.bucketKey, bucketKey),
				),
			)
			.get();

		if (existing) {
			this.database.db
				.update(providerUsage)
				.set({
					count: sql`${providerUsage.count} + ${count}`,
					costUsd: sql`${providerUsage.costUsd} + ${costUsd}`,
				})
				.where(
					and(
						eq(providerUsage.providerId, providerId),
						eq(providerUsage.window, window),
						eq(providerUsage.bucketKey, bucketKey),
					),
				)
				.run();
		} else {
			this.database.db
				.insert(providerUsage)
				.values({
					providerId,
					window,
					bucketKey,
					count,
					costUsd,
				})
				.run();
		}
		// nowISO unused but retained for parity with other writes.
		void nowISO;
	}
}
