import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { SpriteService } from './sprite.service.js';
import { ThumbnailService } from './thumbnail.service.js';

@Controller('media')
export class ThumbnailController {
	constructor(
		private readonly thumbnailService: ThumbnailService,
		private readonly spriteService: SpriteService,
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
