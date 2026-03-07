import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name'),
  version: text('version'),
  enabled: integer('enabled', { mode: 'boolean' }).default(false),
  settings: text('settings'),
  installedAt: text('installed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Plugin = typeof plugins.$inferSelect;
export type NewPlugin = typeof plugins.$inferInsert;
