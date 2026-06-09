import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../../settings/settings.module.js';
import { MemoryCacheService } from './memory-cache.service.js';

/** Global so play / sprite / conversion across modules can warm + forget files. */
@Global()
@Module({
	imports: [SettingsModule],
	providers: [MemoryCacheService],
	exports: [MemoryCacheService],
})
export class MemoryCacheModule {}
