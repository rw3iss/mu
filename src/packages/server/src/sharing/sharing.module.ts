import { Module } from '@nestjs/common';
import { MoviesModule } from '../movies/movies.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { SharingAuthGuard } from './sharing-auth.guard.js';
import { SharingController } from './sharing.controller.js';
import { SharingService } from './sharing.service.js';

@Module({
	imports: [MoviesModule, StreamModule],
	controllers: [SharingController],
	providers: [SharingService, SharingAuthGuard],
	exports: [SharingService],
})
export class SharingModule {}
