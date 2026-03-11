import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const mediaSources = sqliteTable('media_sources', {
	id: text('id').primaryKey(),
	path: text('path').notNull().unique(),
	label: text('label'),
	scanIntervalHours: integer('scan_interval_hours').default(6),
	enabled: integer('enabled', { mode: 'boolean' }).default(true),
	lastScannedAt: text('last_scanned_at'),
	fileCount: integer('file_count').default(0),
	totalSizeBytes: integer('total_size_bytes').default(0),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type MediaSource = typeof mediaSources.$inferSelect;
export type NewMediaSource = typeof mediaSources.$inferInsert;
