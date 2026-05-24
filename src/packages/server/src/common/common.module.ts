import { Global, Module } from '@nestjs/common';
import { GuidResolverService } from './guid-resolver.service.js';
import { AuthCacheService } from './permissions/auth-cache.service.js';
import { PermissionsService } from './permissions/permissions.service.js';
import { SessionRegistryService } from './session-registry.service.js';
import { ShareTokenVerifier } from './share-token.verifier.js';

@Global()
@Module({
	providers: [
		GuidResolverService,
		SessionRegistryService,
		ShareTokenVerifier,
		PermissionsService,
		AuthCacheService,
	],
	exports: [
		GuidResolverService,
		SessionRegistryService,
		ShareTokenVerifier,
		PermissionsService,
		AuthCacheService,
	],
})
export class CommonModule {}
