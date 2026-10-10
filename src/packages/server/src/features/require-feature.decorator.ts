import type { FeatureName } from '@mu/shared';
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

/**
 * Gate a controller (or method) on a product feature. When the feature is
 * disabled, `RequireFeatureGuard` answers 404 — the routes behave as if they
 * don't exist, and no data is touched.
 *
 *   @RequireFeature('music')
 *   @Controller('music')
 */
export const RequireFeature = (feature: FeatureName) => SetMetadata(REQUIRE_FEATURE_KEY, feature);
