import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { RequireFeature } from '../../features/require-feature.decorator.js';
import {
	MAX_MUSIC_UPLOAD_BYTES,
	type MusicUploadResult,
	MusicUploadService,
} from './music-upload.service.js';

/**
 * Music upload endpoints (`edit:media` = contributor + admin). Same protocol
 * as the movie upload: one multipart POST per file (fields before the file),
 * then `finalize` to import what was written.
 */
@RequireFeature('music')
@Controller('music/upload')
export class MusicUploadController {
	constructor(private readonly uploads: MusicUploadService) {}

	@RequireAction('edit:media')
	@Get('targets')
	targets() {
		return { targets: this.uploads.listTargets() };
	}

	@RequireAction('edit:media')
	@Post('preflight')
	preflight(@Body() body: { sourceId: string; names: string[] }) {
		return this.uploads.preflight(body?.sourceId, body?.names ?? []);
	}

	@RequireAction('edit:media')
	@Post()
	async upload(@CurrentUser('id') userId: string, @Req() req: FastifyRequest) {
		const parts = (req as unknown as { parts: (opts?: object) => AsyncIterable<any> }).parts({
			limits: { fileSize: MAX_MUSIC_UPLOAD_BYTES, files: 1 },
		});

		const fields: Record<string, string> = {};
		let result: MusicUploadResult | null = null;
		for await (const part of parts) {
			if (part.type === 'field') {
				fields[part.fieldname] = String(part.value);
				continue;
			}
			if (!fields.sourceId || !fields.relativePath) {
				for await (const _ of part.file as AsyncIterable<Buffer>) void _;
				throw new BadRequestException(
					'sourceId and relativePath must be sent before the file',
				);
			}
			result = await this.uploads.writeUpload({
				sourceId: fields.sourceId,
				relativePath: fields.relativePath,
				userId,
				stream: part.file,
				uploadId: fields.uploadId,
				fileTotal: fields.fileTotal ? Number(fields.fileTotal) : undefined,
			});
		}
		if (!result) throw new BadRequestException('No file provided');
		return { ok: true, ...result };
	}

	@RequireAction('edit:media')
	@Post('finalize')
	finalize(
		@CurrentUser('id') userId: string,
		@Body() body: { sourceId: string; uploadId: string; rootName: string },
	) {
		if (!body?.uploadId) throw new BadRequestException('uploadId is required');
		return {
			ok: true,
			...this.uploads.finalize({
				sourceId: body.sourceId,
				uploadId: body.uploadId,
				rootName: body.rootName ?? '',
				userId,
			}),
		};
	}
}
