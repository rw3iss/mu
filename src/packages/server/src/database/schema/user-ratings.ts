import { real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';
import { users } from './users.ts';

export const userRatings = sqliteTable(
	'user_ratings',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id, { onDelete: 'cascade' }),
		rating: real('rating').notNull(),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(table) => ({
		userMovieIdx: uniqueIndex('user_ratings_user_movie_idx').on(table.userId, table.movieId),
	}),
);

export type UserRating = typeof userRatings.$inferSelect;
export type NewUserRating = typeof userRatings.$inferInsert;
