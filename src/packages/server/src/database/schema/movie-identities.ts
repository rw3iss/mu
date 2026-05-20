import { real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';

/**
 * One-row-per-(source, externalId) mapping from external metadata
 * providers to local movies. Replaces the flat tmdbId/imdbId columns
 * on movies.ts as the canonical multi-source identity registry —
 * those columns remain as denormalised hot fields for fast filtering
 * but are now reflections of rows in this table.
 *
 * Adding a new source (Trakt, TVDB, Wikidata, Letterboxd, …) becomes
 * "insert rows", no migration required.
 */
export const movieIdentities = sqliteTable(
	'movie_identities',
	{
		id: text('id').primaryKey(),
		movieId: text('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
		/** Provider id — matches Provider.id (e.g. 'tmdb', 'imdb', 'trakt', 'tvdb', 'wikidata'). */
		source: text('source').notNull(),
		/** Stringified external identifier in that source's namespace. */
		externalId: text('external_id').notNull(),
		/**
		 * Match confidence from the matcher (0..1). 1.0 indicates a
		 * user-confirmed link; values from the auto-matcher reflect its
		 * composite title/year/duration score.
		 */
		confidence: real('confidence').default(1.0).notNull(),
		addedAt: text('added_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		sourceExternal: uniqueIndex('movie_identities_source_external').on(t.source, t.externalId),
	}),
);

export type MovieIdentity = typeof movieIdentities.$inferSelect;
export type NewMovieIdentity = typeof movieIdentities.$inferInsert;
