import { primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * One-line "why is target similar to seed" explanation, cached per
 * (seed, target, model). Generated on demand when the user opens a
 * movie detail; cost is sub-cent per movie view with prompt caching
 * but still worth caching to avoid re-billing on repeat views.
 */
export const movieRecExplanations = sqliteTable(
	'movie_rec_explanations',
	{
		seedId: text('seed_id').notNull(),
		targetId: text('target_id').notNull(),
		model: text('model').notNull(),
		explanation: text('explanation').notNull(),
		costUsd: real('cost_usd'),
		generatedAt: text('generated_at').notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.seedId, table.targetId, table.model] }),
	}),
);

export type MovieRecExplanation = typeof movieRecExplanations.$inferSelect;
export type NewMovieRecExplanation = typeof movieRecExplanations.$inferInsert;
