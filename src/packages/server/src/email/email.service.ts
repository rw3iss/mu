import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { escapeMultiline, renderTemplate } from './template-renderer.js';
import { FEEDBACK_NOTIFICATION_TEMPLATE } from './templates/feedback-notification.template.js';

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

	get isConfigured(): boolean {
		return (
			this.config.get<boolean>('email.enabled', false) === true &&
			!!this.config.get<string>('email.adminEmail')
		);
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
			});
			this.logger.log(`Sent feedback notification to ${adminEmail}`);
		} catch (err: any) {
			// Never let an email failure break feedback submission.
			this.logger.warn(`Feedback notification email failed: ${err?.message ?? err}`);
		}
	}

	private async send(opts: {
		to: string;
		subject: string;
		html: string;
		attachments: EmailAttachment[];
	}): Promise<void> {
		const provider = this.config.get<string>('email.provider', 'brevo');
		if (provider === 'brevo') return this.sendViaBrevo(opts);
		// SMTP transport isn't wired (no SMTP dependency bundled). Treated as a
		// stub: log and move on so configuration mistakes degrade gracefully.
		this.logger.warn(
			`Email provider '${provider}' is not implemented — notification not sent (stub)`,
		);
	}

	private async sendViaBrevo(opts: {
		to: string;
		subject: string;
		html: string;
		attachments: EmailAttachment[];
	}): Promise<void> {
		const apiKey = this.config.get<string>('email.brevoApiKey');
		if (!apiKey) {
			this.logger.warn('email.brevoApiKey not set — feedback notification not sent (stub)');
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
}
