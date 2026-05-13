import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProviderEventsService } from './provider-events.service.js';
import { ProviderCredentialsService } from './provider-credentials.service.js';
import { ProviderRegistry } from './provider-registry.service.js';
import { ProvidersController } from './providers.controller.js';
import { RateLimitService } from './rate-limit.service.js';

/**
 * The provider platform. Marked @Global so any other module can
 * inject ProviderRegistry / RateLimitService / etc. without
 * importing this module explicitly — the recommendations + future
 * embeddings + LLM modules all need it.
 *
 * No providers (in the Mu sense — TmdbRecommender, TraktRecommender,
 * etc.) are registered here. Each capability-specific module
 * declares its own providers and calls `ProviderRegistry.register()`
 * during its own bootstrap.
 */
@Global()
@Module({
	imports: [DatabaseModule],
	controllers: [ProvidersController],
	providers: [
		ProviderRegistry,
		ProviderCredentialsService,
		RateLimitService,
		ProviderEventsService,
	],
	exports: [
		ProviderRegistry,
		ProviderCredentialsService,
		RateLimitService,
		ProviderEventsService,
	],
})
export class ProvidersModule {}
