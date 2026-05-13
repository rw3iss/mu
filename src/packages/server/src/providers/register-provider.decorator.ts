import { Injectable, SetMetadata } from '@nestjs/common';

export const PROVIDER_METADATA_KEY = 'mu:provider';

/**
 * Marks a NestJS-injectable class as a Provider so ProviderRegistry
 * can discover it at module bootstrap. Equivalent to
 * `@Injectable() + SetMetadata`, kept as a single decorator so
 * registration intent is unambiguous at the class declaration site.
 *
 *     @RegisterProvider()
 *     export class TmdbRecommender implements Recommender { ... }
 */
export function RegisterProvider(): ClassDecorator {
	return (target: any) => {
		Injectable()(target);
		SetMetadata(PROVIDER_METADATA_KEY, true)(target);
		return target;
	};
}
