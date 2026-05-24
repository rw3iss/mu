import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { UserSettingsController } from './user-settings.controller.js';

@Global()
@Module({
	controllers: [SettingsController, UserSettingsController],
	providers: [SettingsService],
	exports: [SettingsService],
})
export class SettingsModule {}
