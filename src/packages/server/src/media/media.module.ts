import { Module } from '@nestjs/common';
import { ThumbnailController } from './thumbnail.controller.js';
import { ThumbnailService } from './thumbnail.service.js';

@Module({
	controllers: [ThumbnailController],
	providers: [ThumbnailService],
	exports: [ThumbnailService],
})
export class MediaModule {}
