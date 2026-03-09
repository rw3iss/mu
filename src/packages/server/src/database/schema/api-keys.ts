import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';

export const apiKeys = sqliteTable('api_keys', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	keyHash: text('key_hash').notNull(),
	lastUsedAt: text('last_used_at'),
	createdAt: text('created_at').notNull(),
	expiresAt: text('expires_at'),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
