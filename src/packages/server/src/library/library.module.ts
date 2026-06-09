import { forwardRef, Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { MoviesModule } from '../movies/movies.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { ConvertSweepService } from './convert-sweep.service.js';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';
import { LibraryJobsService } from './library-jobs.service.js';
import { LibraryUploadController } from './library-upload.controller.js';
import { LibraryUploadService } from './library-upload.service.js';
import { ScannerService } from './scanner.service.js';
import { WatcherService } from './watcher.service.js';

@Module({
	imports: [MetadataModule, MediaModule, StreamModule, forwardRef(() => MoviesModule)],
	controllers: [LibraryController, LibraryUploadController],
	providers: [
		LibraryService,
		ScannerService,
		WatcherService,
		LibraryJobsService,
		LibraryUploadService,
		ConvertSweepService,
	],
	exports: [LibraryService, ScannerService, WatcherService, LibraryJobsService],
})
export class LibraryModule {}
