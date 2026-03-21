import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
	/** Original source file path — for re-matching if movie_file ID changes */
	filePath: text('file_path'),
	/** Relative cache path from cache root (e.g. "persistent/{fileId}/{quality}") */
	cachePath: text('cache_path'),
	/** Total size of cached segments in bytes */
	sizeBytes: integer('size_bytes'),
	/** Number of segments in this cache */
	segmentCount: integer('segment_count'),
});

export type TranscodeCacheEntry = typeof transcodeCache.$inferSelect;
export type NewTranscodeCacheEntry = typeof transcodeCache.$inferInsert;
