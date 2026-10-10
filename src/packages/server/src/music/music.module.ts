import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LibraryModule } from '../library/library.module.js';
import { MusicBrainzModule } from '../providers/sources/musicbrainz/musicbrainz.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { MusicAdminService } from './admin/music-admin.service.js';
import { ArtworkService } from './catalog/artwork.service.js';
import { AudioImporter } from './catalog/audio-importer.js';
import { MusicCatalogService } from './catalog/catalog.service.js';
import { MusicController } from './http/music.controller.js';
import { MusicMetadataController } from './http/music-metadata.controller.js';
import { MusicJobsService } from './jobs/music-jobs.service.js';
import { MusicQueryService } from './library/music-query.service.js';
import { CoverArtClient, LrclibClient, WikiClient } from './metadata/clients.js';
import { MusicMetadataService } from './metadata/music-metadata.service.js';
import { MusicEntitiesService } from './music-entities.service.js';
import { MusicSettingsService } from './music-settings.service.js';
import { AudioTranscodeService } from './playback/audio-transcode.service.js';
import { MusicStreamService } from './playback/music-stream.service.js';

/**
 * Optional Music feature (docs/music-support-plan.md). Always loaded so the
 * importer and jobs exist; the controller and job handlers refuse work while
 * the `music` feature flag is off.
 */
@Module({
	imports: [DatabaseModule, LibraryModule, StreamModule, MusicBrainzModule],
	controllers: [MusicController, MusicMetadataController],
	providers: [
		ArtworkService,
		MusicCatalogService,
		MusicSettingsService,
		MusicQueryService,
		AudioTranscodeService,
		MusicStreamService,
		MusicJobsService,
		AudioImporter,
		MusicEntitiesService,
		CoverArtClient,
		LrclibClient,
		WikiClient,
		MusicMetadataService,
		MusicAdminService,
	],
	exports: [MusicQueryService, MusicSettingsService, MusicCatalogService],
})
export class MusicModule {}
