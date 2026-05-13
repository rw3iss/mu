import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { EmbeddingsModule } from '../embeddings/embeddings.module.js';
import { EventsModule } from '../events/events.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { TraktModule } from '../providers/sources/trakt/trakt.module.js';
import { EmbeddingListenerService } from './embedding-listener.service.js';
import { ExplanationsService } from './explanations.service.js';
import { ExternalRecsListenerService } from './external-recs-listener.service.js';
import { ExternalRecsRepository } from './external-recs.repository.js';
import { LlmFeaturesListenerService } from './llm-features-listener.service.js';
import { TmdbRecommender } from './providers/tmdb-recommender.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { ContentVectorStrategy } from './strategies/content-vector.strategy.js';
import { EmbeddingSimilarityStrategy } from './strategies/embedding.strategy.js';
import { ExternalCacheStrategy } from './strategies/external-cache.strategy.js';
import { LlmRerankStrategy } from './strategies/llm-rerank.strategy.js';
import { TasteProfileService } from './taste-profile.service.js';

/**
 * Recommendations module. The `providers` array is the single place
 * new strategies and provider adapters are added — registering a new
 * source means adding a class here and (for Provider-platform-aware
 * sources) wiring its `onModuleInit` to call `ProviderRegistry.register`.
 *
 * `ProvidersModule` is `@Global()` so it's not imported explicitly
 * here — the registry / rate limiter / events are picked up via DI.
 */
@Module({
	imports: [
		DatabaseModule,
		CacheModule,
		EventsModule,
		MetadataModule,
		TraktModule,
		EmbeddingsModule,
		LlmModule,
	],
	controllers: [RecommendationsController],
	providers: [
		// Repositories + services
		ExternalRecsRepository,
		ExplanationsService,
		// Strategies
		ContentVectorStrategy,
		ExternalCacheStrategy,
		EmbeddingSimilarityStrategy,
		LlmRerankStrategy,
		// Personalisation
		TasteProfileService,
		// Provider adapters
		TmdbRecommender,
		// Event subscribers
		ExternalRecsListenerService,
		EmbeddingListenerService,
		LlmFeaturesListenerService,
		// Orchestrator
		RecommendationsService,
	],
	exports: [RecommendationsService, ExternalRecsRepository, ExplanationsService],
})
export class RecommendationsModule {}
