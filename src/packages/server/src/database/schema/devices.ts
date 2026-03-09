import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';

export const devices = sqliteTable('devices', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name'),
	deviceType: text('device_type'),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	lastActiveAt: text('last_active_at').notNull(),
	createdAt: text('created_at').notNull(),
});

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
