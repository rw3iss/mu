import { Module } from '@nestjs/common';
import { MusicBrainzClient } from './musicbrainz.client.js';

/**
 * One MusicBrainzClient for the whole app. Nest modules are singletons, so
 * every importer (SoundtrackModule, MusicModule) shares the same instance and
 * therefore the same 1 req/sec throttle queue.
 */
@Module({
	providers: [MusicBrainzClient],
	exports: [MusicBrainzClient],
})
export class MusicBrainzModule {}
