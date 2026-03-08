import { Module } from '@nestjs/common';
import { TmdbProvider } from './providers/tmdb.provider.js';
import { OmdbProvider } from './providers/omdb.provider.js';
import { MetadataService } from './metadata.service.js';
import { ImageService } from './image.service.js';
import { MetadataController } from './metadata.controller.js';
import { ImageController } from './image.controller.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [MediaModule],
  controllers: [MetadataController, ImageController],
  providers: [TmdbProvider, OmdbProvider, MetadataService, ImageService],
  exports: [MetadataService, ImageService, TmdbProvider, OmdbProvider],
})
export class MetadataModule {}
