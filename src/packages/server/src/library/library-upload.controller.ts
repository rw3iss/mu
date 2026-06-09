import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { LibraryUploadService, MAX_UPLOAD_BYTES } from './library-upload.service.js';

/**
 * Direct movie upload endpoints (contributor + admin via `edit:movie`).
 * The client uploads one file per POST (a folder = N posts, each carrying the
 * file's relative path), then calls `finalize` to trigger a rescan.
 */
@Controller('library/upload')
export class LibraryUploadController {
	constructor(private readonly uploads: LibraryUploadService) {}

	@RequireAction('edit:movie')
	@Get('targets')
	targets() {
		return { targets: this.uploads.listTargets() };
	}

	@RequireAction('edit:movie')
	@Post('preflight')
	preflight(@Body() body: { sourceId: string; names: string[] }) {
		return this.uploads.preflight(body.sourceId, body.names ?? []);
	}

	@RequireAction('edit:movie')
	@Post()
	async upload(@CurrentUser('id') userId: string, @Req() req: FastifyRequest) {
		const parts = (
			req as unknown as {
				parts: (opts?: object) => AsyncIterable<any>;
			}
		).parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

		const fields: Record<string, string> = {};
		let result: { bytes: number } | null = null;

		for await (const part of parts) {
			if (part.type === 'field') {
				fields[part.fieldname] = String(part.value);
				continue;
			}
			// File part. Fields (sourceId, relativePath) must precede it.
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
			});
		}

		if (!result) throw new BadRequestException('No file provided');
		return { ok: true, bytes: result.bytes, relativePath: fields.relativePath };
	}

	@RequireAction('edit:movie')
	@Post('finalize')
	finalize(
		@CurrentUser('id') userId: string,
		@Body() body: { sourceId: string; uploadId: string; rootName: string },
	) {
		this.uploads.finalize({
			sourceId: body.sourceId,
			uploadId: body.uploadId,
			rootName: body.rootName,
			userId,
		});
		return { ok: true };
	}
}
