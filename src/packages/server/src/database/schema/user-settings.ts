import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Per-user setting overrides. Reads fall back to the app-wide `settings`
 * table when no row exists here for (userId, key). Writes happen lazily
 * — a row only exists once a user customizes the key.
 *
 * Allowlist of permitted keys lives in
 * `@mu/shared/permissions/user-settings-keys.ts`.
 */
export const userSettings = sqliteTable(
	'user_settings',
	{
		userId: text('user_id').notNull(),
		key: text('key').notNull(),
		value: text('value').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.userId, t.key] }),
	}),
);

export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
