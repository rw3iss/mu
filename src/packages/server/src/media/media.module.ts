import { Module } from '@nestjs/common';
import { SpriteService } from './sprite.service.js';
import { ThumbnailController } from './thumbnail.controller.js';
import { ThumbnailService } from './thumbnail.service.js';

@Module({
	controllers: [ThumbnailController],
	providers: [ThumbnailService, SpriteService],
	exports: [ThumbnailService, SpriteService],
})
export class MediaModule {}
