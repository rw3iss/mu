import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Cached "similar / recommended" results for a movie, sourced from
 * external providers (TMDB, Trakt, …). The data is captured during
 * the regular metadata fetch (TMDB returns `similar` + `recommendations`
 * in `append_to_response` — no extra HTTP call needed) and lasts
 * through restarts.
 *
 * `target_movie_id` is filled in lazily — null when the candidate
 * isn't in our local library yet. The orchestrator joins these to
 * the `movies` table on demand to filter local-only results.
 */
export const movieExternalRecs = sqliteTable(
	'movie_external_recs',
	{
		movieId: text('movie_id').notNull(),
		source: text('source').notNull(),
		rank: integer('rank').notNull(),
		targetMovieId: text('target_movie_id'),
		targetTmdb: integer('target_tmdb'),
		targetImdb: text('target_imdb'),
		targetTitle: text('target_title').notNull(),
		targetYear: integer('target_year'),
		raw: text('raw'),
		fetchedAt: text('fetched_at').notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.movieId, table.source, table.rank] }),
		targetMovieIdx: index('movie_external_recs_target_idx').on(table.targetMovieId),
		targetTmdbIdx: index('movie_external_recs_target_tmdb_idx').on(table.targetTmdb),
	}),
);

export type MovieExternalRec = typeof movieExternalRecs.$inferSelect;
export type NewMovieExternalRec = typeof movieExternalRecs.$inferInsert;

export type ExternalRecSource = 'tmdb_similar' | 'tmdb_rec' | 'trakt_related';
