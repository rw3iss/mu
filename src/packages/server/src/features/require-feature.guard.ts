import type { FeatureName } from '@mu/shared';
import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service.js';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator.js';

/** Global guard for `@RequireFeature(name)` — 404 when the feature is off. */
@Injectable()
export class RequireFeatureGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly features: FeatureFlagsService,
	) {}

	canActivate(context: ExecutionContext): boolean {
		const feature = this.reflector.getAllAndOverride<FeatureName | undefined>(
			REQUIRE_FEATURE_KEY,
			[context.getHandler(), context.getClass()],
		);
		if (!feature) return true;
		if (!this.features.isEnabled(feature)) {
			throw new NotFoundException();
		}
		return true;
	}
}
