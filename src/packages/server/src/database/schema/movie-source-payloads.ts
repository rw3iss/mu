import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';

/**
 * Raw per-source payloads kept for offline re-merge. Anytime a
 * provider returns metadata for a movie, the full response is
 * persisted here BEFORE the MergeEngine extracts fields into the
 * normalised tables.
 *
 * Why keep the raw payload:
 *   - Re-running the merge engine after a rule change (e.g. bumping
 *     a source's precedence) doesn't require re-fetching from every
 *     external API.
 *   - Future fields we don't currently extract are still available
 *     for ad-hoc analysis without losing them.
 *   - A user can inspect "what did source X actually return for this
 *     movie" when debugging a wrong merge.
 *
 * Trade-off: storage grows ~per-source-per-movie. For 5k movies x 5
 * sources x ~30KB JSON ≈ 750MB. Acceptable; can be pruned by
 * `fetched_at` if it grows out of hand.
 */
export const movieSourcePayloads = sqliteTable(
	'movie_source_payloads',
	{
		id: text('id').primaryKey(),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id, { onDelete: 'cascade' }),
		/** Provider id (e.g. 'tmdb', 'omdb', 'trakt'). */
		source: text('source').notNull(),
		/** Raw response JSON-serialised. SQLite TEXT — no fixed schema. */
		payload: text('payload').notNull(),
		fetchedAt: text('fetched_at').notNull(),
	},
	(t) => ({
		byMovieSource: index('movie_source_payloads_movie_source').on(t.movieId, t.source),
	}),
);

export type MovieSourcePayload = typeof movieSourcePayloads.$inferSelect;
export type NewMovieSourcePayload = typeof movieSourcePayloads.$inferInsert;
