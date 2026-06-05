import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * User-submitted feedback. Open to any authenticated user; managed by admins.
 * An optional screenshot is stored inline as a base64 data URL (small, low
 * volume — avoids a filesystem/static-serving layer).
 */
export const feedback = sqliteTable(
	'feedback',
	{
		id: text('id').primaryKey(),
		/** Submitter-provided display name (prefilled from the account, editable). */
		name: text('name'),
		/** Account that submitted it, when logged in. Not a hard FK so feedback
		 * survives user deletion. */
		userId: text('user_id'),
		/** Optional contact email the submitter typed. */
		email: text('email'),
		/** The feedback body. */
		description: text('description').notNull(),
		/** Optional screenshot as a `data:<mime>;base64,...` URL. */
		screenshotData: text('screenshot_data'),
		/** Original screenshot filename. */
		screenshotName: text('screenshot_name'),
		/** URL the feedback was submitted from. */
		pageUrl: text('page_url'),
		/** Submitter user-agent string. */
		userAgent: text('user_agent'),
		/** Triage state: 'new' | 'read' | 'resolved'. */
		status: text('status').notNull().default('new'),
		createdAt: text('created_at').notNull(),
	},
	(table) => ({
		createdIdx: index('feedback_created_idx').on(table.createdAt),
		statusIdx: index('feedback_status_idx').on(table.status),
	}),
);

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
