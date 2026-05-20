import { Module } from '@nestjs/common';
import { JobModule } from '../jobs/job.module.js';
import { SpriteService } from './sprite.service.js';
import { ThumbnailController } from './thumbnail.controller.js';
import { ThumbnailService } from './thumbnail.service.js';

@Module({
	imports: [JobModule],
	controllers: [ThumbnailController],
	providers: [ThumbnailService, SpriteService],
	exports: [ThumbnailService, SpriteService],
})
export class MediaModule {}
