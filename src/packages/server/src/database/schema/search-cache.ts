import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Persistent cache for federated search results. One row per
 * (type, normalized_query, source). TTL enforced in service layer
 * (rows older than 7 days are treated as miss).
 */
export const searchCache = sqliteTable(
	'search_cache',
	{
		id: text('id').primaryKey(),
		type: text('type', { enum: ['movie', 'person'] }).notNull(),
		normalizedQuery: text('normalized_query').notNull(),
		source: text('source', { enum: ['tmdb', 'omdb', 'trakt'] }).notNull(),
		payload: text('payload').notNull(),
		fetchedAt: text('fetched_at').notNull(),
	},
	(t) => ({
		typeQueryIdx: index('search_cache_type_query').on(t.type, t.normalizedQuery),
	}),
);

export type SearchCacheRow = typeof searchCache.$inferSelect;
export type NewSearchCacheRow = typeof searchCache.$inferInsert;
