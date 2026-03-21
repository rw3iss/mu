import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { AdminController } from './admin.controller.js';
import { ServerController } from './server.controller.js';
import { ServerService } from './server.service.js';

@Module({
	imports: [StreamModule, MediaModule],
	controllers: [AdminController, ServerController],
	providers: [ServerService],
})
export class AdminModule {}
