import { createReadStream } from 'node:fs';
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { ImageService } from './image.service.js';

@Controller('images')
export class ImageController {
	constructor(private readonly imageService: ImageService) {}

	@Get(':movieId/:type')
	@Public()
	async getImage(
		@Param('movieId') movieId: string,
		@Param('type') type: string,
		@Res() reply: any,
	) {
		const imagePath = this.imageService.getImagePath(movieId, type);

		if (!imagePath) {
			throw new NotFoundException('Image not found');
		}

		const ext = imagePath.split('.').pop()?.toLowerCase();
		const mimeTypes: Record<string, string> = {
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			webp: 'image/webp',
		};

		const contentType = mimeTypes[ext ?? ''] ?? 'image/jpeg';
		const stream = createReadStream(imagePath);
		reply.type(contentType).send(stream);
	}
}
