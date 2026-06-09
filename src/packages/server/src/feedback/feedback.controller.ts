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
import { FeedbackService } from './feedback.service.js';

/** Cap an inbound screenshot (well under the 10MB multipart limit). */
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

@Controller('feedback')
export class FeedbackController {
	constructor(private readonly feedback: FeedbackService) {}

	/**
	 * Submit feedback. Open to any authenticated user. Multipart form: `name`,
	 * `email`, `description`, `pageUrl` fields + optional `screenshot` image file.
	 */
	@RequireAction('view:own-data')
	@Post()
	async submit(@CurrentUser('id') userId: string, @Req() req: FastifyRequest) {
		const fields: Record<string, string> = {};
		let screenshot: { dataUrl: string; name: string } | null = null;
		let tooLarge = false;

		const parts = (req as any).parts();
		for await (const part of parts) {
			if (part.type === 'file') {
				const isImage = String(part.mimetype || '').startsWith('image/');
				if (part.fieldname === 'screenshot' && isImage && !screenshot && !tooLarge) {
					const chunks: Buffer[] = [];
					let size = 0;
					for await (const chunk of part.file as AsyncIterable<Buffer>) {
						size += chunk.length;
						if (size > MAX_SCREENSHOT_BYTES) {
							tooLarge = true;
							break;
						}
						chunks.push(chunk);
					}
					if (part.file.truncated) tooLarge = true;
					if (!tooLarge) {
						const buf = Buffer.concat(chunks);
						screenshot = {
							dataUrl: `data:${part.mimetype};base64,${buf.toString('base64')}`,
							name: String(part.filename || 'screenshot'),
						};
					}
				} else {
					// Drain any unexpected / oversized file part so the iterator advances.
					part.file.resume();
				}
			} else {
				fields[part.fieldname] = part.value;
			}
		}

		const description = (fields.description ?? '').trim();
		if (!description) throw new BadRequestException('A description is required');
		if (tooLarge) throw new BadRequestException('Screenshot too large (max 8MB)');

		const created = this.feedback.create({
			userId: userId ?? null,
			name: fields.name ?? null,
			email: fields.email ?? null,
			description,
			pageUrl: fields.pageUrl ?? null,
			userAgent: (req.headers['user-agent'] as string) ?? null,
			screenshotData: screenshot?.dataUrl ?? null,
			screenshotName: screenshot?.name ?? null,
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
