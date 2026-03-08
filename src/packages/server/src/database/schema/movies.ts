import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const movies = sqliteTable('movies', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  year: integer('year'),
  overview: text('overview'),
  tagline: text('tagline'),
  runtimeMinutes: integer('runtime_minutes'),
  releaseDate: text('release_date'),
  language: text('language'),
  country: text('country'),
  posterUrl: text('poster_url'),
  backdropUrl: text('backdrop_url'),
  trailerUrl: text('trailer_url'),
  thumbnailUrl: text('thumbnail_url'),
  thumbnailAspectRatio: real('thumbnail_aspect_ratio'),
  imdbId: text('imdb_id'),
  tmdbId: integer('tmdb_id'),
  contentRating: text('content_rating'),
  addedAt: text('added_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  imdbIdIdx: index('movies_imdb_id_idx').on(table.imdbId),
  tmdbIdIdx: index('movies_tmdb_id_idx').on(table.tmdbId),
}));

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;
