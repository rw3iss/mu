import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';
import { playlists } from './playlists.ts';

export const playlistMovies = sqliteTable(
	'playlist_movies',
	{
		id: text('id').primaryKey(),
		playlistId: text('playlist_id')
			.notNull()
			.references(() => playlists.id, { onDelete: 'cascade' }),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		addedAt: text('added_at').notNull(),
	},
	(table) => ({
		playlistMovieIdx: uniqueIndex('playlist_movies_playlist_movie_idx').on(
			table.playlistId,
			table.movieId,
		),
	}),
);

export type PlaylistMovie = typeof playlistMovies.$inferSelect;
export type NewPlaylistMovie = typeof playlistMovies.$inferInsert;
