import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const themes = sqliteTable('themes', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	mode: text('mode').notNull(),
	config: text('config').notNull(),
	isDefault: integer('is_default').default(0),
	createdBy: text('created_by'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type Theme = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;
