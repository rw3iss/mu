import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { movieFiles } from './movie-files.ts';
import { movies } from './movies.ts';
import { users } from './users.ts';

export const streamSessions = sqliteTable('stream_sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	movieId: text('movie_id')
		.notNull()
		.references(() => movies.id, { onDelete: 'cascade' }),
	movieFileId: text('movie_file_id').references(() => movieFiles.id),
	quality: text('quality'),
	transcoding: integer('transcoding', { mode: 'boolean' }).default(false),
	startedAt: text('started_at').notNull(),
	lastActiveAt: text('last_active_at').notNull(),
	/** Updated only when playback position actually advances (real watching),
	 *  NOT by pause-time heartbeats — so "watching now" reflects active viewing
	 *  rather than an open-but-idle player. */
	lastProgressAt: text('last_progress_at'),
	positionSeconds: integer('position_seconds').default(0),
	bandwidthBytes: integer('bandwidth_bytes').default(0),
	/** Originating IP captured at session start. Honors X-Forwarded-For
	 * when the request came through a proxy so the admin panel shows
	 * the real client, not the reverse-proxy. */
	ipAddress: text('ip_address'),
});

export type StreamSession = typeof streamSessions.$inferSelect;
export type NewStreamSession = typeof streamSessions.$inferInsert;
