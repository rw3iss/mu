import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { escapeHtml, escapeMultiline, renderTemplate } from './template-renderer.js';
import { FEEDBACK_NOTIFICATION_TEMPLATE } from './templates/feedback-notification.template.js';
import { FEEDBACK_REPLY_TEMPLATE } from './templates/feedback-reply.template.js';

/** Strict input for the feedback-notification template. */
export interface FeedbackNotificationData {
	name: string;
	email: string;
	pageUrl: string;
	createdAt: string;
	body: string;
	/** Optional screenshot data URL, attached when present. */
	screenshot?: { dataUrl: string; name: string } | null;
	/** Absolute URL to the admin feedback manager. */
	adminUrl: string;
}

/** Input for the resolution/reply email sent to a feedback submitter. */
export interface FeedbackReplyData {
	/** Submitter's email address. */
	to: string;
	feedbackId: string;
	/** When the feedback was originally reported (ISO). */
	reportedAt: string;
	/** The original feedback text, quoted back to the submitter. */
	originalBody: string;
	/** The admin's optional written message. */
	replyMessage?: string | null;
	/** True when this also resolves the ticket (vs. a plain reply). */
	resolved: boolean;
	/** Display name of the admin responding (used in the reply intro). */
	adminName: string;
	/** Public web URL of the server (footer link); empty → no link. */
	siteUrl?: string;
}

interface EmailAttachment {
	name: string;
	contentBase64: string;
}

/**
 * Outbound email. Currently sends admin notifications for new feedback. Brevo
 * (https://www.brevo.com) transactional API via fetch — no extra dependency.
 * A no-op stub until `email.enabled`, an `adminEmail`, and a provider key are
 * configured in config.yml; never throws, so callers can fire-and-forget.
 */
@Injectable()
export class EmailService {
	private readonly logger = new Logger('EmailService');

	constructor(private readonly config: ConfigService) {}

	/** Configured to send the admin NOTIFICATION (needs an admin recipient). */
	get isConfigured(): boolean {
		return (
			this.config.get<boolean>('email.enabled', false) === true &&
			!!this.config.get<string>('email.adminEmail')
		);
	}

	private get provider(): string {
		return this.config.get<string>('email.provider', 'brevo');
	}

	/**
	 * Whether outbound SENDING is wired (email enabled + the selected provider's
	 * API key). Unlike `isConfigured` this does NOT require `email.adminEmail` —
	 * that's only the notification recipient; replies are sent to the submitter.
	 */
	get canSend(): boolean {
		if (this.config.get<boolean>('email.enabled', false) !== true) return false;
		if (this.provider === 'resend') return !!this.config.get<string>('email.resendApiKey');
		return !!this.config.get<string>('email.brevoApiKey');
	}

	/**
	 * Email a newly-registered user their verification link.
	 *
	 * STUBBED until SMTP/provider config lands: when sending isn't wired we log
	 * the link (so a self-hosted admin can still complete a verification by
	 * hand) and return without throwing — registration must never fail because
	 * email isn't configured yet. Once `email.enabled` + a provider key are set,
	 * this sends for real with no further changes.
	 */
	async sendVerificationEmail(data: {
		to: string;
		username: string;
		token: string;
	}): Promise<void> {
		const base = (this.config.get<string>('email.siteUrl') || '').replace(/\/+$/, '');
		const link = `${base}/verify-email?token=${encodeURIComponent(data.token)}`;

		if (!this.canSend) {
			this.logger.warn(
				`Email not configured — verification link for ${data.username} <${data.to}>: ${link}`,
			);
			return;
		}

		const html = `<div style="font-family:sans-serif;line-height:1.6;color:#e7e9ee;background:#0d1a2b;padding:24px;">
<h2 style="margin:0 0 12px;">Verify your Mu account</h2>
<p style="margin:0 0 16px;">Hi ${escapeHtml(data.username)}, confirm your email address to finish setting up your account.</p>
<p style="margin:0 0 20px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Verify email address</a></p>
<p style="margin:0;font-size:12px;color:#9aa3b5;">If the button doesn't work, paste this into your browser:<br>${escapeHtml(link)}</p>
</div>`;

		await this.send({
			to: data.to,
			subject: 'Verify your Mu account',
			html,
			attachments: [],
			replyTo: this.config.get<string>('email.replyTo') || undefined,
		});
		this.logger.log(`Sent verification email to ${data.to}`);
	}

	async sendFeedbackNotification(data: FeedbackNotificationData): Promise<void> {
		if (!this.isConfigured) {
			this.logger.debug(
				'Email disabled or admin address unset — skipping feedback notification',
			);
			return;
		}
		const adminEmail = this.config.get<string>('email.adminEmail');
		const screenshotNote = data.screenshot
			? '<p style="margin:16px 0 0;font-size:13px;color:#9aa3b5;">A screenshot is attached.</p>'
			: '';
		const html = renderTemplate(FEEDBACK_NOTIFICATION_TEMPLATE, {
			name: data.name || 'Anonymous',
			email: data.email || '—',
			pageUrl: data.pageUrl || '—',
			createdAt: data.createdAt,
			body: escapeMultiline(data.body),
			screenshotNote,
			adminUrl: data.adminUrl,
		});

		const attachments: EmailAttachment[] = [];
		if (data.screenshot) {
			const base64 = data.screenshot.dataUrl.split(',')[1] ?? '';
			if (base64)
				attachments.push({
					name: data.screenshot.name || 'screenshot.png',
					contentBase64: base64,
				});
		}

		try {
			await this.send({
				to: adminEmail,
				subject: `New feedback from ${data.name || 'a user'}`,
				html,
				attachments,
				// Reply-To the submitter so the admin can answer them directly from
				// the notification (falls back to the configured reply-to).
				replyTo: data.email || this.config.get<string>('email.replyTo') || undefined,
			});
			this.logger.log(`Sent feedback notification to ${adminEmail}`);
		} catch (err: any) {
			// Never let an email failure break feedback submission.
			this.logger.warn(`Feedback notification email failed: ${err?.message ?? err}`);
		}
	}

	/**
	 * Email a feedback submitter a resolution and/or reply. Unlike the admin
	 * notification this DOES throw when it can't send (no email config / no API
	 * key / provider error) so the caller can surface the failure to the admin.
	 */
	async sendFeedbackReply(data: FeedbackReplyData): Promise<void> {
		if (!this.canSend) {
			throw new Error(
				'Emailing is disabled — could not send the reply. Configure email (provider + API key) in config.yml.',
			);
		}

		const reportedAt = this.formatDate(data.reportedAt);
		const heading = data.resolved
			? 'Your feedback has been resolved'
			: 'Response to your feedback';
		const intro = data.resolved
			? 'A note from the Mu administrator — your feedback ticket has been resolved.'
			: `${escapeHtml(data.adminName || 'A Mu administrator')} has responded to your feedback submission:`;

		const msg = (data.replyMessage ?? '').trim();
		const replyBlock = msg
			? `<div style="margin-top:16px;"><div style="margin:0 0 4px;font-size:12px;color:#9aa3b5;">Message</div><div style="padding:14px 16px;background:#11233a;border:1px solid #233a57;border-radius:6px;line-height:1.6;color:#e7e9ee;">${escapeMultiline(msg)}</div></div>`
			: '';
		const closing = data.resolved
			? '<p style="margin:20px 0 0;line-height:1.6;color:#e7e9ee;">Thanks a lot for helping to make Mu better! — Mu</p>'
			: '';

		const siteUrl = (data.siteUrl ?? '').trim();
		const footer = siteUrl
			? `&copy; Mu — <a href="${escapeHtml(siteUrl)}" style="color:#8ab4ff;text-decoration:none;">${escapeHtml(siteUrl)}</a>`
			: '&copy; Mu';

		const html = renderTemplate(FEEDBACK_REPLY_TEMPLATE, {
			heading,
			intro,
			ticketId: data.feedbackId.slice(0, 8),
			reportedAt,
			originalBody: escapeMultiline(data.originalBody),
			replyBlock,
			closing,
			footer,
		});

		await this.send({
			to: data.to,
			subject: data.resolved ? 'Your Mu feedback has been resolved' : 'Re: your Mu feedback',
			html,
			attachments: [],
			// So the submitter's reply goes to a real inbox (e.g. ryan@…).
			replyTo: this.config.get<string>('email.replyTo') || undefined,
		});
		this.logger.log(`Sent feedback ${data.resolved ? 'resolution' : 'reply'} to ${data.to}`);
	}

	private formatDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
	}

	private async send(opts: SendOpts): Promise<void> {
		const dispatch = (): Promise<void> => {
			if (this.provider === 'resend') return this.sendViaResend(opts);
			if (this.provider === 'brevo') return this.sendViaBrevo(opts);
			this.logger.warn(
				`Email provider '${this.provider}' is not implemented — not sent (stub)`,
			);
			return Promise.resolve();
		};
		// Retry transient failures (the host's outbound network can blip — a
		// `fetch failed` to the provider shouldn't drop the message).
		let lastErr: unknown;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				await dispatch();
				return;
			} catch (err) {
				lastErr = err;
				this.logger.warn(
					`Email send attempt ${attempt}/3 failed: ${(err as Error).message}`,
				);
				if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
			}
		}
		throw lastErr;
	}

	private async sendViaBrevo(opts: SendOpts): Promise<void> {
		const apiKey = this.config.get<string>('email.brevoApiKey');
		if (!apiKey) {
			this.logger.warn('email.brevoApiKey not set — email not sent (stub)');
			return;
		}
		const payload: Record<string, unknown> = {
			sender: {
				email: this.config.get<string>('email.fromAddress', 'noreply@mu.local'),
				name: this.config.get<string>('email.fromName', 'Mu'),
			},
			to: [{ email: opts.to }],
			subject: opts.subject,
			htmlContent: opts.html,
		};
		if (opts.replyTo) payload.replyTo = { email: opts.replyTo };
		if (opts.attachments.length > 0) {
			payload.attachment = opts.attachments.map((a) => ({
				name: a.name,
				content: a.contentBase64,
			}));
		}
		const res = await fetch('https://api.brevo.com/v3/smtp/email', {
			method: 'POST',
			headers: {
				'api-key': apiKey,
				'content-type': 'application/json',
				accept: 'application/json',
			},
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`Brevo responded ${res.status}: ${text.slice(0, 200)}`);
		}
	}

	private async sendViaResend(opts: SendOpts): Promise<void> {
		const apiKey = this.config.get<string>('email.resendApiKey');
		if (!apiKey) {
			this.logger.warn('email.resendApiKey not set — email not sent (stub)');
			return;
		}
		const fromName = this.config.get<string>('email.fromName', 'Mu');
		const fromAddress = this.config.get<string>('email.fromAddress', 'noreply@mu.local');
		const payload: Record<string, unknown> = {
			from: `${fromName} <${fromAddress}>`,
			to: [opts.to],
			subject: opts.subject,
			html: opts.html,
		};
		if (opts.replyTo) payload.reply_to = opts.replyTo;
		if (opts.attachments.length > 0) {
			payload.attachments = opts.attachments.map((a) => ({
				filename: a.name,
				content: a.contentBase64,
			}));
		}
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`Resend responded ${res.status}: ${text.slice(0, 200)}`);
		}
	}
}

/** Shared options for a single outbound email. */
interface SendOpts {
	to: string;
	subject: string;
	html: string;
	attachments: EmailAttachment[];
	replyTo?: string;
}
