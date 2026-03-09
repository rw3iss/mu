import { Module, Global } from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { SettingsController } from './settings.controller.js';

@Global()
@Module({
	controllers: [SettingsController],
	providers: [SettingsService],
	exports: [SettingsService],
})
export class SettingsModule {}
