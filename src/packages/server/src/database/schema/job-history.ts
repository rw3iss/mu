import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const jobHistory = sqliteTable('job_history', {
	id: text('id').primaryKey(),
	type: text('type').notNull(),
	label: text('label').notNull(),
	status: text('status').notNull(),
	payload: text('payload'),
	priority: integer('priority').default(10),
	progress: real('progress').default(0),
	result: text('result'),
	error: text('error'),
	createdAt: text('created_at').notNull(),
	startedAt: text('started_at'),
	completedAt: text('completed_at'),
	durationMs: integer('duration_ms'),
	movieId: text('movie_id'),
	movieTitle: text('movie_title'),
	filePath: text('file_path'),
	quality: text('quality'),
});

export type JobHistoryEntry = typeof jobHistory.$inferSelect;
export type NewJobHistoryEntry = typeof jobHistory.$inferInsert;
