import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CacheModule } from '../cache/cache.module.js';
import { EventsModule } from '../events/events.module.js';
import { PluginController } from './plugin.controller.js';
import { PluginApiController } from './plugin-api.controller.js';
import { PluginManagerService } from './plugin-manager.service.js';
import { PluginContextFactory } from './plugin-context.factory.js';
import { PluginApiRegistryService } from './plugin-api-registry.service.js';
import { ConfigService } from '../config/config.service.js';

@Module({
	imports: [DatabaseModule, CacheModule, EventsModule],
	controllers: [PluginController, PluginApiController],
	providers: [
		PluginManagerService,
		PluginContextFactory,
		ConfigService,
		PluginApiRegistryService,
	],
	exports: [PluginManagerService, PluginApiRegistryService],
})
export class PluginModule implements OnModuleInit {
	private readonly logger = new Logger('PluginModule');

	constructor(private readonly pluginManager: PluginManagerService) {}

	async onModuleInit() {
		this.logger.log('Initializing plugin system...');

		try {
			await this.pluginManager.loadEnabledPlugins();
			const loaded = this.pluginManager.getLoadedPlugins();
			this.logger.log(`Plugin system ready — ${loaded.length} plugin(s) loaded`);
		} catch (err) {
			this.logger.error(
				`Failed to initialize plugin system: ${err instanceof Error ? err.message : err}`,
			);
		}
	}
}
