import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service.js';
import { FeaturesController } from './features.controller.js';
import { RequireFeatureGuard } from './require-feature.guard.js';

/**
 * Feature flags (movies / music). Global so any module can inject
 * `FeatureFlagsService`; also registers the `@RequireFeature` guard app-wide.
 */
@Global()
@Module({
	controllers: [FeaturesController],
	providers: [FeatureFlagsService, { provide: APP_GUARD, useClass: RequireFeatureGuard }],
	exports: [FeatureFlagsService],
})
export class FeaturesModule {}
