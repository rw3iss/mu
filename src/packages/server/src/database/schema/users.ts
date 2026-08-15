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
	/** Admin-disabled accounts cannot log in and have their sessions terminated. */
	disabled: integer('disabled', { mode: 'boolean' }).default(false),
	/**
	 * Self-registration gates. Both default TRUE so every pre-existing account —
	 * and anything an admin creates directly — can sign in untouched; only the
	 * public registration path sets them false (per the admin's config).
	 */
	approved: integer('approved', { mode: 'boolean' }).default(true),
	emailVerified: integer('email_verified', { mode: 'boolean' }).default(true),
	/** One-shot token emailed to the user; cleared once they verify. */
	verificationToken: text('verification_token'),
	verificationSentAt: text('verification_sent_at'),
	/** Updated on each successful login; feeds the profile "Active …" label. */
	lastLoginAt: text('last_login_at'),
	/** The login time BEFORE the current one — captured at login by copying the
	 *  prior `lastLoginAt`. Lets the dashboard count "new since your last
	 *  session" against the previous visit rather than the current one. */
	previousLoginAt: text('previous_login_at'),
	/** Updated on explicit logout; when newer than last activity, the profile
	 *  shows "Logged out" instead of "Active …". */
	lastLogoutAt: text('last_logout_at'),
	/** Bumped (throttled) on any authenticated request so presence ("Active …")
	 *  reflects general app use, not just login / playback. */
	lastSeenAt: text('last_seen_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
