import { Global, Module } from '@nestjs/common';
import { GuidResolverService } from './guid-resolver.service.js';

@Global()
@Module({
	providers: [GuidResolverService],
	exports: [GuidResolverService],
})
export class CommonModule {}
