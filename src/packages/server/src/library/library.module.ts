import { Module } from '@nestjs/common';
import { MetadataModule } from '../metadata/metadata.module.js';
import { MediaModule } from '../media/media.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { LibraryService } from './library.service.js';
import { ScannerService } from './scanner.service.js';
import { WatcherService } from './watcher.service.js';
import { LibraryJobsService } from './library-jobs.service.js';
import { LibraryController } from './library.controller.js';

@Module({
  imports: [MetadataModule, MediaModule, StreamModule],
  controllers: [LibraryController],
  providers: [LibraryService, ScannerService, WatcherService, LibraryJobsService],
  exports: [LibraryService, ScannerService, WatcherService, LibraryJobsService],
})
export class LibraryModule {}
