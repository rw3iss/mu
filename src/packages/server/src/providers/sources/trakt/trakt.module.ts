import { Module } from '@nestjs/common';
import { CacheModule } from '../../../cache/cache.module.js';
import { ProvidersModule } from '../../providers.module.js';
import { TraktRecommender } from './trakt.recommender.js';
import { TraktSearchProvider } from './trakt-search.provider.js';

/**
 * Trakt source. Self-registers with the global `ProviderRegistry`
 * on module init via `TraktRecommender.onModuleInit`. The platform
 * picks it up automatically; no other module needs to know it
 * exists.
 *
 * Also exports `TraktSearchProvider` for federated search use.
 */
@Module({
	imports: [CacheModule, ProvidersModule],
	providers: [TraktRecommender, TraktSearchProvider],
	exports: [TraktRecommender, TraktSearchProvider],
})
export class TraktModule {}
