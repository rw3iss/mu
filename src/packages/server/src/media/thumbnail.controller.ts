import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { Controller, Get, Logger, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { parseThumbnailSize, SpriteService } from './sprite.service.js';
import { ThumbnailService } from './thumbnail.service.js';

const SPRITE_JOB_TYPE = 'sprite-sheet';

@Controller('media')
export class ThumbnailController {
	private readonly logger = new Logger('ThumbnailController');

	constructor(
		private readonly thumbnailService: ThumbnailService,
		private readonly spriteService: SpriteService,
		private readonly jobManager: JobManagerService,
	) {}

	@Get('thumbnails/:filename')
	@Public()
	getThumbnail(
		@Param('filename') filename: string,
		@Query('v') version: string | undefined,
		@Res() reply: any,
	) {
		const filePath = this.thumbnailService.getThumbnailPath(filename);

		if (!existsSync(filePath)) {
			throw new NotFoundException('Thumbnail not found');
		}

		const cacheControl = version
			? 'public, max-age=31536000, immutable'
			: 'public, max-age=300';

		const stream = createReadStream(filePath);
		reply.header('Cache-Control', cacheControl).type('image/jpeg').send(stream);
	}

	@Get('sprites/:movieId/meta.json')
	@Public()
	getSpriteMeta(
		@Param('movieId') movieId: string,
		@Query('size') sizeParam: string | undefined,
		@Res() reply: any,
	) {
		const requestedSize = parseThumbnailSize(sizeParam, 'large');
		const servingSize = this.spriteService.resolveServingSize(movieId, requestedSize);
		if (!servingSize) {
			// No size at or above the requested one is stored. If a
			// smaller size exists we still 404 here (the resolver
			// won't return a smaller bitmap to avoid blurry
			// upscaling); we queue a regen at the requested size so
			// the next visit gets sharp thumbnails.
			this.enqueueSpriteJob(movieId, requestedSize);
			throw new NotFoundException('Sprite metadata not found');
		}
		// Loaded meta is augmented with which size was actually served
		// + what was requested so the client can show its own loading /
		// fallback state and re-request later.
		const meta = this.spriteService.getMeta(movieId, servingSize);
		if (!meta) {
			throw new NotFoundException('Sprite metadata not found');
		}
		const response = {
			...meta,
			size: servingSize,
			actualSize: servingSize,
			requestedSize,
		};
		reply
			.header('Cache-Control', 'public, max-age=3600')
			.header('Content-Type', 'application/json')
			.send(response);
	}

	@Get('sprites/:movieId/:index.jpg')
	@Public()
	getSpriteSheet(
		@Param('movieId') movieId: string,
		@Param('index') index: string,
		@Query('size') sizeParam: string | undefined,
		@Res() reply: any,
	) {
		const requestedSize = parseThumbnailSize(sizeParam, 'large');
		const servingSize = this.spriteService.resolveServingSize(movieId, requestedSize);
		if (!servingSize) {
			throw new NotFoundException('Sprite sheet not found');
		}
		// For legacy unsized sheets, getSheetPath(..., undefined) hits
		// the unsized directory. When servingSize === 'small' and the
		// sized dir doesn't exist, fall back to the legacy path.
		const sheetIndex = parseInt(index, 10);
		let sheetPath = this.spriteService.getSheetPath(movieId, sheetIndex, servingSize);
		if (!existsSync(sheetPath) && servingSize === 'small') {
			sheetPath = this.spriteService.getSheetPath(movieId, sheetIndex);
		}
		if (!existsSync(sheetPath)) {
			throw new NotFoundException('Sprite sheet not found');
		}
		const stream = createReadStream(sheetPath);
		reply
			.header('Cache-Control', 'public, max-age=31536000, immutable')
			.type('image/jpeg')
			.send(stream);
	}

	/** Idempotent enqueue of a sprite-sheet job for this (movie, size).
	 *  Skips if another job with the same payload is already pending
	 *  or running. */
	private enqueueSpriteJob(movieId: string, size: 'small' | 'medium' | 'large') {
		const existing = this.jobManager.findJobsByPayload(
			'movieId',
			movieId,
			SPRITE_JOB_TYPE,
			['pending', 'running'],
		);
		const sameSize = existing.find((j) => j.payload?.size === size);
		if (sameSize) return;
		try {
			this.jobManager.enqueue({
				type: SPRITE_JOB_TYPE,
				label: `Generate ${size} sprites: ${movieId.slice(0, 8)}`,
				payload: { movieId, size },
				priority: 50,
			});
			this.logger.log(`Lazy-enqueued ${size} sprite job for ${movieId}`);
		} catch (err) {
			this.logger.warn(
				`Failed to enqueue lazy sprite job for ${movieId}: ${(err as Error).message}`,
			);
		}
	}
}
