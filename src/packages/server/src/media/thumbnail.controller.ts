import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { Controller, Get, Logger, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { SpriteService } from './sprite.service.js';
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
	getSpriteMeta(@Param('movieId') movieId: string, @Res() reply: any) {
		const metaPath = this.spriteService.getMetaPath(movieId);
		if (!existsSync(metaPath)) {
			// Lazy generation: if the player asked for sprites for a
			// movie that doesn't have them yet, queue a job. We skip
			// the enqueue if a job for this movie is already pending
			// or running so refreshes don't multiply queue size.
			const existing = this.jobManager.findJobsByPayload(
				'movieId',
				movieId,
				SPRITE_JOB_TYPE,
				['pending', 'running'],
			);
			if (existing.length === 0) {
				try {
					this.jobManager.enqueue({
						type: SPRITE_JOB_TYPE,
						label: `Generate sprites: ${movieId.slice(0, 8)}`,
						payload: { movieId },
						priority: 50,
					});
					this.logger.log(`Lazy-enqueued sprite job for ${movieId}`);
				} catch (err) {
					this.logger.warn(
						`Failed to enqueue lazy sprite job for ${movieId}: ${(err as Error).message}`,
					);
				}
			}
			throw new NotFoundException('Sprite metadata not found');
		}
		const data = readFileSync(metaPath, 'utf-8');
		reply
			.header('Cache-Control', 'public, max-age=3600')
			.header('Content-Type', 'application/json')
			.send(data);
	}

	@Get('sprites/:movieId/:index.jpg')
	@Public()
	getSpriteSheet(
		@Param('movieId') movieId: string,
		@Param('index') index: string,
		@Res() reply: any,
	) {
		const sheetPath = this.spriteService.getSheetPath(movieId, parseInt(index, 10));
		if (!existsSync(sheetPath)) {
			throw new NotFoundException('Sprite sheet not found');
		}
		const stream = createReadStream(sheetPath);
		reply
			.header('Cache-Control', 'public, max-age=31536000, immutable')
			.type('image/jpeg')
			.send(stream);
	}
}
