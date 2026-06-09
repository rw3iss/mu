import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	Patch,
	Post,
	Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { FeedbackService } from './feedback.service.js';

/** Cap an inbound attachment (kept under the global multipart limit). Larger
 *  than before so short screen-capture clips / animated gifs go through. */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

@Controller('feedback')
export class FeedbackController {
	constructor(
		private readonly feedback: FeedbackService,
		private readonly uploads: UploadsService,
	) {}

	/**
	 * Submit feedback. Open to any authenticated user. Multipart form: `name`,
	 * `email`, `description`, `pageUrl` fields + optional `screenshot` image file.
	 */
	@RequireAction('view:own-data')
	@Post()
	async submit(@CurrentUser('id') userId: string, @Req() req: FastifyRequest) {
		const fields: Record<string, string> = {};
		let pending: { buffer: Buffer; mimetype: string; name: string } | null = null;
		let tooLarge = false;
		let unsupported = false;

		const parts = (req as any).parts();
		for await (const part of parts) {
			if (part.type !== 'file') {
				fields[part.fieldname] = part.value;
				continue;
			}

			const isMedia = this.uploads.isSupportedMedia(part.mimetype);
			const wanted = part.fieldname === 'screenshot' && isMedia && !pending && !tooLarge;

			if (!wanted) {
				if (part.fieldname === 'screenshot' && !isMedia) unsupported = true;
				// Always fully drain a part we're not keeping so the parts iterator
				// can advance — failing to drain is what hung large/gif uploads.
				part.file.resume();
				continue;
			}

			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of part.file as AsyncIterable<Buffer>) {
				size += chunk.length;
				if (size > MAX_ATTACHMENT_BYTES) {
					tooLarge = true;
					break;
				}
				chunks.push(chunk);
			}
			// Drain whatever's left (no-op if already fully consumed) — this is the
			// fix for the hang on oversized / partially-read parts.
			part.file.resume();
			if (tooLarge || part.file.truncated) {
				tooLarge = true;
			} else {
				pending = {
					buffer: Buffer.concat(chunks),
					mimetype: String(part.mimetype || 'application/octet-stream'),
					name: String(part.filename || 'attachment'),
				};
			}
		}

		const description = (fields.description ?? '').trim();
		if (!description) throw new BadRequestException('A description is required');
		if (tooLarge) throw new BadRequestException('Attachment too large (max 50MB)');
		if (unsupported) {
			throw new BadRequestException('Unsupported attachment type — use an image or video.');
		}

		let attachmentUrl: string | null = null;
		let attachmentType: string | null = null;
		let attachmentName: string | null = null;
		if (pending) {
			attachmentUrl = await this.uploads.saveFile(
				pending.buffer,
				pending.mimetype,
				'feedback',
				pending.name,
			);
			attachmentType = pending.mimetype;
			attachmentName = pending.name;
		}

		const created = this.feedback.create({
			userId: userId ?? null,
			name: fields.name ?? null,
			email: fields.email ?? null,
			description,
			pageUrl: fields.pageUrl ?? null,
			userAgent: (req.headers['user-agent'] as string) ?? null,
			attachmentUrl,
			attachmentType,
			screenshotName: attachmentName,
		});
		return { ok: true, id: created.id };
	}

	@RequireAction('admin:server')
	@Get()
	list() {
		return { feedback: this.feedback.list() };
	}

	@RequireAction('admin:server')
	@Get(':id')
	detail(@Param('id') id: string) {
		const fb = this.feedback.get(id);
		if (!fb) throw new NotFoundException('Feedback not found');
		return { feedback: fb };
	}

	@RequireAction('admin:server')
	@Patch(':id')
	patch(@Param('id') id: string, @Body() body: { status?: string }) {
		if (body?.status) this.feedback.setStatus(id, body.status);
		return { ok: true };
	}

	/**
	 * Resolve and/or reply to a feedback ticket, emailing the submitter.
	 * `resolve:true` + no/empty message → resolution email. `resolve:false` →
	 * a plain reply (message required, must be deliverable).
	 */
	@RequireAction('admin:server')
	@Post(':id/respond')
	async respond(
		@Param('id') id: string,
		@Body() body: { resolve?: boolean; message?: string },
		@CurrentUser('id') adminUserId: string,
	) {
		const result = await this.feedback.respond(id, {
			resolve: !!body?.resolve,
			message: body?.message ?? null,
			adminUserId,
		});
		return { ok: true, ...result };
	}

	@RequireAction('admin:server')
	@Delete(':id')
	remove(@Param('id') id: string) {
		return { ok: this.feedback.remove(id) };
	}

	@RequireAction('admin:server')
	@Delete()
	clear() {
		return { cleared: this.feedback.clear() };
	}
}
