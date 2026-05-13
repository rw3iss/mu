import { Module } from '@nestjs/common';
import { TraktRecommender } from './trakt.recommender.js';

/**
 * Trakt source. Self-registers with the global `ProviderRegistry`
 * on module init via `TraktRecommender.onModuleInit`. The platform
 * picks it up automatically; no other module needs to know it
 * exists.
 *
 * Exported so the recommendations module's external-recs listener
 * can snapshot `/related` results into `movie_external_recs` on
 * library events.
 */
@Module({
	providers: [TraktRecommender],
	exports: [TraktRecommender],
})
export class TraktModule {}
