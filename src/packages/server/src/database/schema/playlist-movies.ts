import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { playlists } from './playlists.ts';
import { movies } from './movies.ts';

export const playlistMovies = sqliteTable('playlist_movies', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  movieId: text('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  addedAt: text('added_at').notNull(),
}, (table) => ({
  playlistMovieIdx: uniqueIndex('playlist_movies_playlist_movie_idx').on(table.playlistId, table.movieId),
}));

export type PlaylistMovie = typeof playlistMovies.$inferSelect;
export type NewPlaylistMovie = typeof playlistMovies.$inferInsert;
