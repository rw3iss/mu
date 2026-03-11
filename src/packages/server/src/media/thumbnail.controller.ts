import { createReadStream, existsSync } from 'node:fs';
import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { ThumbnailService } from './thumbnail.service.js';

@Controller('media/thumbnails')
export class ThumbnailController {
	constructor(private readonly thumbnailService: ThumbnailService) {}

	@Get(':filename')
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

		// When a version param is present, the URL is unique per regeneration
		// so we can cache aggressively. Without it, use a short cache.
		const cacheControl = version
			? 'public, max-age=31536000, immutable'
			: 'public, max-age=300';

		const stream = createReadStream(filePath);
		reply.header('Cache-Control', cacheControl).type('image/jpeg').send(stream);
	}
}
