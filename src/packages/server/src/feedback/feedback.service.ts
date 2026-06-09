import crypto from 'node:crypto';
import { nowISO, resolveDisplayName } from '@mu/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { type Feedback, feedback, users } from '../database/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/** Result of an admin respond action (resolve and/or reply). */
export interface RespondResult {
	status: string;
	emailed: boolean;
	/** Set when the email couldn't be sent on a resolve-and-reply (soft warning). */
	emailError?: string;
}

export interface CreateFeedbackInput {
	name?: string | null;
	email?: string | null;
	description: string;
	/** Legacy: screenshot as a `data:<mime>;base64,...` URL (old code paths). */
	screenshotData?: string | null;
	screenshotName?: string | null;
	/** New: on-disk attachment served at `/uploads/feedback/…`. */
	attachmentUrl?: string | null;
	attachmentType?: string | null;
	pageUrl?: string | null;
	userAgent?: string | null;
	userId?: string | null;
}

/** List row — omits any (potentially large) inline base64 payload, but carries
 *  the on-disk attachment URL so the admin UI can render it directly. */
export interface FeedbackSummary {
	id: string;
	name: string | null;
	email: string | null;
	description: string;
	pageUrl: string | null;
	status: string;
	hasScreenshot: boolean;
	screenshotName: string | null;
	attachmentUrl: string | null;
	attachmentType: string | null;
	createdAt: string;
}

@Injectable()
export class FeedbackService {
	constructor(
		private readonly database: DatabaseService,
		private readonly email: EmailService,
		private readonly config: ConfigService,
		private readonly uploads: UploadsService,
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
			attachmentUrl: input.attachmentUrl ?? null,
			attachmentType: input.attachmentType ?? null,
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
				attachmentUrl: feedback.attachmentUrl,
				attachmentType: feedback.attachmentType,
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
			hasScreenshot: !!r.screenshotData || !!r.attachmentUrl,
			screenshotName: r.screenshotName,
			attachmentUrl: r.attachmentUrl,
			attachmentType: r.attachmentType,
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

	/**
	 * Admin action: optionally resolve the ticket and email the submitter a
	 * reply/resolution. A plain reply (resolve=false) REQUIRES a message and a
	 * deliverable email — it hard-fails otherwise. A resolve-and-reply always
	 * resolves first; if the email can't be sent (no address / not configured)
	 * it returns a soft `emailError` rather than undoing the resolve.
	 */
	async respond(
		id: string,
		opts: { resolve: boolean; message?: string | null; adminUserId: string },
	): Promise<RespondResult> {
		const row = this.get(id);
		if (!row) throw new NotFoundException('Feedback not found');

		const message = (opts.message ?? '').trim();
		if (!opts.resolve && !message) {
			throw new BadRequestException('Enter a reply message.');
		}

		let status = row.status;
		if (opts.resolve) {
			this.setStatus(id, 'resolved');
			status = 'resolved';
		}

		const to = (row.email ?? '').trim();
		const adminName = this.adminDisplayName(opts.adminUserId);

		try {
			if (!to) {
				throw new Error('This submitter didn’t provide an email address.');
			}
			await this.email.sendFeedbackReply({
				to,
				feedbackId: row.id,
				reportedAt: row.createdAt,
				originalBody: row.description,
				replyMessage: message || null,
				resolved: opts.resolve,
				adminName,
			});
			return { status, emailed: true };
		} catch (err) {
			const emailError = (err as Error).message;
			// A plain reply that can't be delivered is a hard failure (nothing
			// else changed). A resolve-and-reply keeps the resolve, warns about
			// the email.
			if (!opts.resolve) throw new BadRequestException(emailError);
			return { status, emailed: false, emailError };
		}
	}

	private adminDisplayName(userId: string): string {
		const u = this.database.db
			.select({ username: users.username, displayName: users.displayName })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		return u ? resolveDisplayName(u) : 'A Mu administrator';
	}

	remove(id: string): boolean {
		const row = this.get(id);
		const res = this.database.db.delete(feedback).where(eq(feedback.id, id)).run();
		// Best-effort cleanup of the on-disk attachment so files don't orphan.
		if (res.changes > 0) void this.uploads.deleteByUrl(row?.attachmentUrl);
		return res.changes > 0;
	}

	clear(): number {
		const urls = this.database.db
			.select({ url: feedback.attachmentUrl })
			.from(feedback)
			.all()
			.map((r) => r.url)
			.filter((u): u is string => !!u);
		const res = this.database.db.delete(feedback).run();
		for (const url of urls) void this.uploads.deleteByUrl(url);
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
