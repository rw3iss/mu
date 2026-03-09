import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { movieFiles } from './movie-files.ts';

export const transcodeCache = sqliteTable('transcode_cache', {
	id: text('id').primaryKey(),
	movieFileId: text('movie_file_id')
		.notNull()
		.references(() => movieFiles.id, { onDelete: 'cascade' }),
	quality: text('quality').notNull(),
	/** JSON-encoded encoding settings used for this transcode */
	encodingSettings: text('encoding_settings').notNull(),
	completedAt: text('completed_at').notNull(),
});

export type TranscodeCacheEntry = typeof transcodeCache.$inferSelect;
export type NewTranscodeCacheEntry = typeof transcodeCache.$inferInsert;
