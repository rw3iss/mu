import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';
import { movies } from './movies.ts';

export const userWatchHistory = sqliteTable('user_watch_history', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  movieId: text('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
  watchedAt: text('watched_at').notNull(),
  durationWatchedSeconds: integer('duration_watched_seconds').default(0),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  positionSeconds: integer('position_seconds').default(0),
});

export type UserWatchHistory = typeof userWatchHistory.$inferSelect;
export type NewUserWatchHistory = typeof userWatchHistory.$inferInsert;
