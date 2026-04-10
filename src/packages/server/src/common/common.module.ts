import { Global, Module } from '@nestjs/common';
import { GuidResolverService } from './guid-resolver.service.js';
import { SessionRegistryService } from './session-registry.service.js';
import { ShareTokenVerifier } from './share-token.verifier.js';

@Global()
@Module({
	providers: [GuidResolverService, SessionRegistryService, ShareTokenVerifier],
	exports: [GuidResolverService, SessionRegistryService, ShareTokenVerifier],
})
export class CommonModule {}
