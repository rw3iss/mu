import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { HealthController } from './health.controller.js';

@Module({
	imports: [StreamModule, LibraryModule],
	controllers: [HealthController],
})
export class HealthModule {}
