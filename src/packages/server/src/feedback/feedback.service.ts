import crypto from 'node:crypto';
import { nowISO } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { type Feedback, feedback } from '../database/schema/index.js';
import { EmailService } from '../email/email.service.js';

export interface CreateFeedbackInput {
	name?: string | null;
	email?: string | null;
	description: string;
	/** Screenshot as a `data:<mime>;base64,...` URL, when supplied. */
	screenshotData?: string | null;
	screenshotName?: string | null;
	pageUrl?: string | null;
	userAgent?: string | null;
	userId?: string | null;
}

/** List row — omits the (potentially large) screenshot payload. */
export interface FeedbackSummary {
	id: string;
	name: string | null;
	email: string | null;
	description: string;
	pageUrl: string | null;
	status: string;
	hasScreenshot: boolean;
	screenshotName: string | null;
	createdAt: string;
}

@Injectable()
export class FeedbackService {
	constructor(
		private readonly database: DatabaseService,
		private readonly email: EmailService,
		private readonly config: ConfigService,
	) {}

	create(input: CreateFeedbackInput): Feedback {
		const row: Feedback = {
			id: crypto.randomUUID(),
			name: input.name?.trim() || null,
			userId: input.userId ?? null,
			email: input.email?.trim() || null,
			description: input.description.trim(),
			screenshotData: input.screenshotData ?? null,
			screenshotName: input.screenshotName ?? null,
			pageUrl: input.pageUrl ?? null,
			userAgent: input.userAgent ?? null,
			status: 'new',
			createdAt: nowISO(),
		};
		this.database.db.insert(feedback).values(row).run();
		// Fire-and-forget — never block / fail the submission on email.
		void this.notify(row);
		return row;
	}

	list(): FeedbackSummary[] {
		const rows = this.database.db
			.select({
				id: feedback.id,
				name: feedback.name,
				email: feedback.email,
				description: feedback.description,
				pageUrl: feedback.pageUrl,
				status: feedback.status,
				screenshotName: feedback.screenshotName,
				screenshotData: feedback.screenshotData,
				createdAt: feedback.createdAt,
			})
			.from(feedback)
			.orderBy(desc(feedback.createdAt))
			.all();
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			email: r.email,
			description: r.description,
			pageUrl: r.pageUrl,
			status: r.status,
			hasScreenshot: !!r.screenshotData,
			screenshotName: r.screenshotName,
			createdAt: r.createdAt,
		}));
	}

	get(id: string): Feedback | undefined {
		return this.database.db.select().from(feedback).where(eq(feedback.id, id)).get();
	}

	setStatus(id: string, status: string): boolean {
		const res = this.database.db
			.update(feedback)
			.set({ status })
			.where(eq(feedback.id, id))
			.run();
		return res.changes > 0;
	}

	remove(id: string): boolean {
		const res = this.database.db.delete(feedback).where(eq(feedback.id, id)).run();
		return res.changes > 0;
	}

	clear(): number {
		const res = this.database.db.delete(feedback).run();
		return res.changes ?? 0;
	}

	private async notify(row: Feedback): Promise<void> {
		const hostname = this.config.get<string>('tls.hostname');
		const port = this.config.get<number>('server.port', 4000);
		const adminUrl = hostname ? `https://${hostname}:${port}/feedback` : '/feedback';
		await this.email.sendFeedbackNotification({
			name: row.name ?? 'Anonymous',
			email: row.email ?? '',
			pageUrl: row.pageUrl ?? '',
			createdAt: new Date(row.createdAt).toLocaleString(),
			body: row.description,
			screenshot: row.screenshotData
				? { dataUrl: row.screenshotData, name: row.screenshotName ?? 'screenshot.png' }
				: null,
			adminUrl,
		});
	}
}
