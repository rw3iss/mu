import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { StreamModule } from '../stream/stream.module.js';
import { MediaModule } from '../media/media.module.js';

@Module({
	imports: [StreamModule, MediaModule],
	controllers: [AdminController],
})
export class AdminModule {}
