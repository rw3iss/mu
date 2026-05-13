import { primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Cached LLM-extracted feature payload for a movie. Lives off the
 * scoring path — purely an enrichment cache. Calls cost real $ so
 * we always check this table before re-billing.
 *
 * The `features` JSON shape follows `MovieFeatures` in the
 * provider interface (tone, pace, themes, audience, comparables).
 */
export const movieLlmFeatures = sqliteTable(
	'movie_llm_features',
	{
		movieId: text('movie_id').notNull(),
		model: text('model').notNull(),
		features: text('features').notNull(),
		costUsd: real('cost_usd'),
		generatedAt: text('generated_at').notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.movieId, table.model] }),
	}),
);

export type MovieLlmFeatures = typeof movieLlmFeatures.$inferSelect;
export type NewMovieLlmFeatures = typeof movieLlmFeatures.$inferInsert;
