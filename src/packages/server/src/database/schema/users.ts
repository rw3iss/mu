import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	email: text('email').unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role').notNull().default('user'),
	avatarUrl: text('avatar_url'),
	preferences: text('preferences'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
