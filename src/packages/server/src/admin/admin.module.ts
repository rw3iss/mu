import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { AdminController } from './admin.controller.js';

@Module({
	imports: [StreamModule, MediaModule],
	controllers: [AdminController],
})
export class AdminModule {}
