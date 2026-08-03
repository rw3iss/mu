import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sharedSessions } from './shared-sessions.ts';
import { users } from './users.ts';

/** Chat messages for a shared session — persist for the life of the session
 *  (removed when the admin ends it, via cascade on session delete). */
export const sharedSessionMessages = sqliteTable('shared_session_messages', {
	id: text('id').primaryKey(),
	sessionId: text('session_id')
		.notNull()
		.references(() => sharedSessions.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	text: text('text').notNull(),
	createdAt: text('created_at').notNull(),
});

export type SharedSessionMessage = typeof sharedSessionMessages.$inferSelect;
export type NewSharedSessionMessage = typeof sharedSessionMessages.$inferInsert;
