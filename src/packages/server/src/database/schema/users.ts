import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	email: text('email').unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role').notNull().default('viewer'),
	avatarUrl: text('avatar_url'),
	preferences: text('preferences'),
	// Optional friendly name shown across the UI in place of the login username.
	displayName: text('display_name'),
	// Social profile: a short blurb (<=500 chars) and whether non-admins may
	// view this user's profile/info (the per-user "show profile info" flag).
	// Profiles are public by default.
	description: text('description'),
	profilePublic: integer('profile_public', { mode: 'boolean' }).default(true),
	/** Updated on each successful login; feeds the profile "Active …" label. */
	lastLoginAt: text('last_login_at'),
	/** Updated on explicit logout; when newer than last activity, the profile
	 *  shows "Logged out" instead of "Active …". */
	lastLogoutAt: text('last_logout_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
