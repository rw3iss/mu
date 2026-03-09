import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { mediaSources } from './media-sources.ts';

export const scanLog = sqliteTable('scan_log', {
	id: text('id').primaryKey(),
	sourceId: text('source_id')
		.notNull()
		.references(() => mediaSources.id, { onDelete: 'cascade' }),
	startedAt: text('started_at').notNull(),
	completedAt: text('completed_at'),
	status: text('status').notNull().default('running'),
	filesFound: integer('files_found').default(0),
	filesAdded: integer('files_added').default(0),
	filesUpdated: integer('files_updated').default(0),
	filesRemoved: integer('files_removed').default(0),
	errors: text('errors'),
});

export type ScanLogEntry = typeof scanLog.$inferSelect;
export type NewScanLogEntry = typeof scanLog.$inferInsert;
