import { Module } from '@nestjs/common';
import { RemoteController } from './remote.controller.js';
import { RemoteService } from './remote.service.js';

@Module({
	controllers: [RemoteController],
	providers: [RemoteService],
	exports: [RemoteService],
})
export class RemoteModule {}
