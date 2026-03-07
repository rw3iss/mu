import { Module } from '@nestjs/common';
import { ThumbnailService } from './thumbnail.service.js';
import { ThumbnailController } from './thumbnail.controller.js';

@Module({
  controllers: [ThumbnailController],
  providers: [ThumbnailService],
  exports: [ThumbnailService],
})
export class MediaModule {}
