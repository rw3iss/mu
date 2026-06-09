import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	email: text('email').unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role').notNull().default('viewer'),
	avatarUrl: text('avatar_url'),
	preferences: text('preferences'),
	// Social profile: a short blurb (<=500 chars) and whether non-admins may
	// view this user's profile/info (the per-user "show profile info" flag).
	description: text('description'),
	profilePublic: integer('profile_public', { mode: 'boolean' }).default(false),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
