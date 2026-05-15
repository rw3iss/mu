import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Persisted candidate matches for movies/groups where the metadata
 * matcher couldn't decide on its own. Surfaced in the UI as a "pick
 * which one this is" dropdown — once the user selects, we apply the
 * match and clear all candidates for that entity.
 *
 * `entityType` ('movie' | 'group') + `entityId` is the natural key —
 * one entity can have multiple candidates (one row per provider /
 * candidate pair). `rank` orders them by confidence desc so the UI can
 * just SELECT … ORDER BY rank.
 */
export const metadataMatchCandidates = sqliteTable(
	'metadata_match_candidates',
	{
		id: text('id').primaryKey(),
		entityType: text('entity_type', { enum: ['movie', 'group'] }).notNull(),
		entityId: text('entity_id').notNull(),

		provider: text('provider').notNull(), // 'tmdb' | 'tmdb-tv' | 'tmdb-collection' | 'omdb' | …
		externalId: text('external_id').notNull(), // stringified TMDB id, IMDB id, etc.

		// Display fields — denormalized so the UI dropdown doesn't have
		// to re-fetch each candidate from the provider.
		title: text('title').notNull(),
		year: integer('year'),
		runtimeMinutes: integer('runtime_minutes'),
		posterUrl: text('poster_url'),
		overview: text('overview'),

		confidence: real('confidence').notNull(),
		rank: integer('rank').notNull(),

		// Whether the matcher would have applied this auto if not ambiguous.
		isBest: integer('is_best', { mode: 'boolean' }).notNull().default(false),

		createdAt: text('created_at').notNull(),
	},
	(t) => ({
		entityIdx: index('mmc_entity_idx').on(t.entityType, t.entityId),
		rankIdx: index('mmc_rank_idx').on(t.entityType, t.entityId, t.rank),
	}),
);

export type MetadataMatchCandidate = typeof metadataMatchCandidates.$inferSelect;
export type NewMetadataMatchCandidate = typeof metadataMatchCandidates.$inferInsert;
