import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';
import { users } from './users.ts';

/**
 * User comments on a movie — general (timeSeconds null) or anchored to a
 * playback position. One level of replies via parentId.
 */
export const movieComments = sqliteTable(
	'movie_comments',
	{
		id: text('id').primaryKey(),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Parent comment for replies (one level deep). */
		parentId: text('parent_id'),
		/** Playback position the comment is anchored to; null = general. */
		timeSeconds: real('time_seconds'),
		text: text('text').notNull(),
		edited: integer('edited', { mode: 'boolean' }).default(false),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		movieIdx: index('movie_comments_movie_idx').on(t.movieId),
		parentIdx: index('movie_comments_parent_idx').on(t.parentId),
	}),
);

/** Emoji reactions on comments — one row per (comment, user, emoji). */
export const commentReactions = sqliteTable(
	'comment_reactions',
	{
		id: text('id').primaryKey(),
		commentId: text('comment_id')
			.notNull()
			.references(() => movieComments.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		createdAt: text('created_at').notNull(),
	},
	(t) => ({
		uniq: uniqueIndex('comment_reactions_uniq').on(t.commentId, t.userId, t.emoji),
		commentIdx: index('comment_reactions_comment_idx').on(t.commentId),
	}),
);

export type MovieComment = typeof movieComments.$inferSelect;
export type CommentReaction = typeof commentReactions.$inferSelect;
