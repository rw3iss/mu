import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Cached subset of IMDB's free `title.ratings.tsv.gz` bulk dataset
 * (https://datasets.imdbws.com/title.ratings.tsv.gz). Updated by the
 * scheduled `imdb-datasets:ratings-sync` job.
 *
 * Tconst is the IMDB identifier (e.g. `tt0133093`). Joining against
 * `movies.imdbId` is the primary use case — read-through cache in
 * front of the OMDB API for rating + vote-count lookups, eliminating
 * the daily quota and removing the per-call latency.
 *
 * Designed to scale to ~1.5M rows (current IMDB title count). Even
 * fully populated, expect ~25 MB on disk with the tconst index.
 */
export const imdbRatings = sqliteTable(
	'imdb_ratings',
	{
		tconst: text('tconst').primaryKey(),
		averageRating: real('average_rating').notNull(),
		numVotes: integer('num_votes').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		// Secondary by-rating index lets the discover-filters quality
		// floor + minVotes filter run as a single range scan when we
		// ever want "all movies above N votes" lookups outside the
		// movie-id join path.
		ratingIdx: index('imdb_ratings_rating_idx').on(t.averageRating, t.numVotes),
	}),
);

export type ImdbRating = typeof imdbRatings.$inferSelect;
export type NewImdbRating = typeof imdbRatings.$inferInsert;
