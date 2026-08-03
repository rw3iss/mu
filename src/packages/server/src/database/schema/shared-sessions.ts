import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { movies } from './movies.ts';
import { users } from './users.ts';

/** A "watch party" — a shared movie + synced playhead across members. */
export const sharedSessions = sqliteTable('shared_sessions', {
	id: text('id').primaryKey(),
	movieId: text('movie_id')
		.notNull()
		.references(() => movies.id, { onDelete: 'cascade' }),
	adminUserId: text('admin_user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name'),
	/** JSON-encoded SharedSessionSettings. */
	settings: text('settings').notNull(),
	/** 'active' | 'ended'. */
	status: text('status').notNull().default('active'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	endedAt: text('ended_at'),
});

export type SharedSession = typeof sharedSessions.$inferSelect;
export type NewSharedSession = typeof sharedSessions.$inferInsert;
