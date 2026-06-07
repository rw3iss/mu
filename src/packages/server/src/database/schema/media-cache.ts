import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * NVMe "hot" cache index. One row per movie file staged onto the fast cache
 * drive. The on-disk copy lives at `cachePath`; this table tracks staging
 * state and the access/watch signals the eviction policy uses (LRU by
 * `lastAccessAt`, age by `stagedAt`, plus the fully-watched fast-path).
 */
export const mediaCache = sqliteTable('media_cache', {
	/** The movie_files.id this entry caches (one staged copy per file). */
	movieFileId: text('movie_file_id').primaryKey(),
	movieId: text('movie_id').notNull(),
	/** Original source path on the slow media drive. */
	sourcePath: text('source_path').notNull(),
	/** Staged copy path on the fast cache drive. */
	cachePath: text('cache_path').notNull(),
	sizeBytes: integer('size_bytes').default(0),
	/** ISO timestamp staging finished (the `.complete` marker was written). */
	stagedAt: text('staged_at'),
	/** ISO timestamp of the last play/seek that read this entry. */
	lastAccessAt: text('last_access_at').notNull(),
	/** Staging copy finished and verified — only then is it served. */
	complete: integer('complete', { mode: 'boolean' }).default(false),
	/** A viewer reached the end (within completedTailSeconds). Evicts sooner. */
	watchedFully: integer('watched_fully', { mode: 'boolean' }).default(false),
	watchedAt: text('watched_at'),
});

export type MediaCacheEntry = typeof mediaCache.$inferSelect;
export type NewMediaCacheEntry = typeof mediaCache.$inferInsert;
