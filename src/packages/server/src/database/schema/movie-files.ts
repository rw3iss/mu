import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mediaSources } from './media-sources.ts';
import { movies } from './movies.ts';

export const movieFiles = sqliteTable('movie_files', {
	id: text('id').primaryKey(),
	movieId: text('movie_id')
		.notNull()
		.references(() => movies.id, { onDelete: 'cascade' }),
	sourceId: text('source_id')
		.notNull()
		.references(() => mediaSources.id),
	filePath: text('file_path').notNull().unique(),
	fileName: text('file_name'),
	fileSize: integer('file_size'),
	fileHash: text('file_hash'),
	resolution: text('resolution'),
	codecVideo: text('codec_video'),
	codecAudio: text('codec_audio'),
	bitrate: integer('bitrate'),
	durationSeconds: integer('duration_seconds'),
	subtitleTracks: text('subtitle_tracks'),
	audioTracks: text('audio_tracks'),
	fileMetadata: text('file_metadata'),
	videoWidth: integer('video_width'),
	videoHeight: integer('video_height'),
	videoBitDepth: integer('video_bit_depth'),
	videoFrameRate: text('video_frame_rate'),
	videoProfile: text('video_profile'),
	videoColorSpace: text('video_color_space'),
	hdr: integer('hdr', { mode: 'boolean' }).default(false),
	containerFormat: text('container_format'),
	available: integer('available', { mode: 'boolean' }).default(true),
	addedAt: text('added_at').notNull(),
	fileModifiedAt: text('file_modified_at'),
});

export type MovieFile = typeof movieFiles.$inferSelect;
export type NewMovieFile = typeof movieFiles.$inferInsert;
