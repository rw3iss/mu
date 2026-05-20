import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';

export const movieMetadata = sqliteTable('movie_metadata', {
	id: text('id').primaryKey(),
	movieId: text('movie_id')
		.notNull()
		.references(() => movies.id, { onDelete: 'cascade' })
		.unique(),
	genres: text('genres'),
	cast: text('cast_members'),
	directors: text('directors'),
	writers: text('writers'),
	keywords: text('keywords'),
	productionCompanies: text('production_companies'),
	budget: integer('budget'),
	revenue: integer('revenue'),
	imdbRating: real('imdb_rating'),
	imdbVotes: integer('imdb_votes'),
	tmdbRating: real('tmdb_rating'),
	tmdbVotes: integer('tmdb_votes'),
	rottenTomatoesScore: integer('rotten_tomatoes_score'),
	metacriticScore: integer('metacritic_score'),
	extendedData: text('extended_data'),
	source: text('source'),
	/**
	 * Per-field provenance map, JSON. Records which provider set each
	 * field on the row so the MergeEngine can decide whether an
	 * incoming source has authority to overwrite it. Shape:
	 *   { imdbRating: 'omdb', posterUrl: 'tmdb', cast: 'tmdb', … }
	 * The sentinel value 'user' beats any provider — used when an
	 * admin manually overrides a field through the UI.
	 */
	provenance: text('provenance'),
	fetchedAt: text('fetched_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type MovieMetadata = typeof movieMetadata.$inferSelect;
export type NewMovieMetadata = typeof movieMetadata.$inferInsert;
