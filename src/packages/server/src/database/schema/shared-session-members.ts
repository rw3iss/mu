import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sharedSessions } from './shared-sessions.ts';
import { users } from './users.ts';

/** Membership + role + invite state for a shared session. */
export const sharedSessionMembers = sqliteTable('shared_session_members', {
	id: text('id').primaryKey(),
	sessionId: text('session_id')
		.notNull()
		.references(() => sharedSessions.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** 'admin' | 'member'. */
	role: text('role').notNull().default('member'),
	/** 'invited' | 'joined' | 'left'. */
	state: text('state').notNull().default('invited'),
	invitedBy: text('invited_by'),
	joinedAt: text('joined_at'),
	leftAt: text('left_at'),
});

export type SharedSessionMember = typeof sharedSessionMembers.$inferSelect;
export type NewSharedSessionMember = typeof sharedSessionMembers.$inferInsert;
