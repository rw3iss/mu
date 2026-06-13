import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';

/**
 * Generic notifications — both per-user and system-wide.
 *  - userId set  → personal (comment reply/reaction, etc.)
 *  - userId null → system-wide (announcements); shown to every user, stored once.
 * `type` is a NotificationType string; `data` is an open JSON blob the client's
 * per-type formatter turns into a message + link.
 */
export const notifications = sqliteTable(
	'notifications',
	{
		id: text('id').primaryKey(),
		/** Recipient. Null = system-wide (all users). */
		userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		/** JSON-encoded payload (actor ids, comment/movie ids, snippet, etc.). */
		data: text('data').notNull().default('{}'),
		read: integer('read', { mode: 'boolean' }).notNull().default(false),
		createdAt: text('created_at').notNull(),
	},
	(t) => ({
		userIdx: index('notifications_user_idx').on(t.userId),
		createdIdx: index('notifications_created_idx').on(t.createdAt),
	}),
);

export type Notification = typeof notifications.$inferSelect;
