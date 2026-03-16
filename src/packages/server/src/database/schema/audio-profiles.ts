import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';

export const audioProfiles = sqliteTable('audio_profiles', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type').notNull(), // 'eq' | 'compressor' | 'full'
	config: text('config').notNull().default('{}'), // JSON blob
	isDefault: integer('is_default', { mode: 'boolean' }).default(false),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type AudioProfile = typeof audioProfiles.$inferSelect;
export type NewAudioProfile = typeof audioProfiles.$inferInsert;
