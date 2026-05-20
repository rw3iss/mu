import { Module } from '@nestjs/common';
import { CacheModule } from '../../../cache/cache.module.js';
import { WikidataProvider } from './wikidata.provider.js';

/**
 * Wikidata source — registers itself with the global ProviderRegistry
 * on module init via the constructor's OnModuleInit hook. No key
 * required; users can optionally configure a custom User-Agent string
 * via Settings → Sources.
 */
@Module({
	imports: [CacheModule],
	providers: [WikidataProvider],
	exports: [WikidataProvider],
})
export class WikidataModule {}
