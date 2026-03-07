import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';
import { movies } from './movies.ts';

export const userWatchlist = sqliteTable('user_watchlist', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  movieId: text('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
  addedAt: text('added_at').notNull(),
  notes: text('notes'),
}, (table) => ({
  userMovieIdx: uniqueIndex('user_watchlist_user_movie_idx').on(table.userId, table.movieId),
}));

export type UserWatchlistEntry = typeof userWatchlist.$inferSelect;
export type NewUserWatchlistEntry = typeof userWatchlist.$inferInsert;
