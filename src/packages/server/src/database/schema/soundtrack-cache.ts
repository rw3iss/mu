import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Persistent cache for movie soundtrack lookups (MusicBrainz). One row
 * per movie. TTL enforced in the service layer: `found` rows live ~30d,
 * misses ~3d (so a soundtrack that gets added to MusicBrainz later is
 * picked up on a re-check). `payload` holds the full SoundtrackDto JSON.
 */
export const soundtrackCache = sqliteTable('soundtrack_cache', {
	movieId: text('movie_id').primaryKey(),
	found: integer('found', { mode: 'boolean' }).notNull().default(false),
	payload: text('payload').notNull(),
	fetchedAt: text('fetched_at').notNull(),
});

export type SoundtrackCacheRow = typeof soundtrackCache.$inferSelect;
export type NewSoundtrackCacheRow = typeof soundtrackCache.$inferInsert;
