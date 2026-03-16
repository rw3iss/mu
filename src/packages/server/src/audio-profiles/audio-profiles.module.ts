import { Module } from '@nestjs/common';
import { AudioProfilesController } from './audio-profiles.controller.js';
import { AudioProfilesService } from './audio-profiles.service.js';

@Module({
	controllers: [AudioProfilesController],
	providers: [AudioProfilesService],
	exports: [AudioProfilesService],
})
export class AudioProfilesModule {}
