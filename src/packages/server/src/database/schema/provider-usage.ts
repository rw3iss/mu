import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Persistent rate-limit / budget counters per provider. One row per
 * (provider, window, bucket_key) — for example:
 *   - ('tmdb', 'day',    '2026-05-12')  count=412
 *   - ('claude', 'month','2026-05')      count=78  cost_usd=0.34
 *
 * The sub-second / per-minute windows are kept in-memory in
 * RateLimitService for speed; only `day` and `month` are persisted
 * here so they survive restarts.
 */
export const providerUsage = sqliteTable(
	'provider_usage',
	{
		providerId: text('provider_id').notNull(),
		window: text('window').notNull(),
		bucketKey: text('bucket_key').notNull(),
		count: integer('count').notNull().default(0),
		costUsd: real('cost_usd').default(0),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.providerId, table.window, table.bucketKey] }),
	}),
);

export type ProviderUsageRow = typeof providerUsage.$inferSelect;
export type NewProviderUsageRow = typeof providerUsage.$inferInsert;
