import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MusicBrainzClient } from './musicbrainz.client.js';
import { SoundtrackController } from './soundtrack.controller.js';
import { SoundtrackService } from './soundtrack.service.js';

/**
 * Soundtrack lookups (album tracklist) via MusicBrainz. Keyless — no
 * provider-platform credentials needed; the client self-throttles to
 * MusicBrainz's 1 req/sec policy and results are cached per movie.
 */
@Module({
	imports: [DatabaseModule],
	controllers: [SoundtrackController],
	providers: [SoundtrackService, MusicBrainzClient],
	exports: [SoundtrackService],
})
export class SoundtrackModule {}
