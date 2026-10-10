import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { MusicBrainzModule } from '../../providers/sources/musicbrainz/musicbrainz.module.js';
import { SearchModule } from '../../search/search.module.js';
import { MusicModule } from '../music.module.js';
import { AlbumFilmsService } from './album-films.service.js';
import { ListenBrainzClient } from './listenbrainz.client.js';
import { MbPreviewService } from './mb-preview.service.js';
import { MusicDiscoveryController } from './music-discovery.controller.js';
import { MusicDiscoveryService } from './music-discovery.service.js';

/**
 * Music search & discovery (plan Phase 6): Discover, `mb:` stub previews and
 * album→film cross-links. Separate from MusicModule so the catalogue module
 * stays independent of search / external discovery sources.
 */
@Module({
	imports: [DatabaseModule, MusicModule, MusicBrainzModule, SearchModule],
	controllers: [MusicDiscoveryController],
	providers: [MusicDiscoveryService, MbPreviewService, AlbumFilmsService, ListenBrainzClient],
	exports: [MusicDiscoveryService, MbPreviewService],
})
export class MusicDiscoveryModule {}
