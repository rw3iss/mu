import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Append-only audit log of every meaningful interaction with a
 * provider — call (success/error), rate-limit/budget hits, health
 * checks. Drives the sparklines on the Connections page and the
 * `Providers` tab on the admin dashboard.
 *
 * Retention: 90 days raw, then rolled up nightly into a daily summary
 * table (provider_events_daily — added in Phase 0 follow-up if
 * volume warrants it).
 */
export const providerEvents = sqliteTable(
	'provider_events',
	{
		id: text('id').primaryKey(),
		providerId: text('provider_id').notNull(),
		eventType: text('event_type').notNull(),
		statusCode: integer('status_code'),
		durationMs: integer('duration_ms'),
		costUsd: real('cost_usd'),
		payload: text('payload'),
		occurredAt: text('occurred_at').notNull(),
	},
	(table) => ({
		providerIdx: index('provider_events_provider_idx').on(table.providerId, table.occurredAt),
	}),
);

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type NewProviderEvent = typeof providerEvents.$inferInsert;

export type ProviderEventType =
	| 'call'
	| 'error'
	| 'rate_limit'
	| 'budget_exhausted'
	| 'health_check';
