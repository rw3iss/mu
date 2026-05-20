import { forwardRef, Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module.js';
import { MediaModule } from '../media/media.module.js';
import { WikidataModule } from '../providers/sources/wikidata/wikidata.module.js';
import { FileProbeService } from './file-probe.service.js';
import { GroupMetadataService } from './group-metadata.service.js';
import { ImageController } from './image.controller.js';
import { ImageService } from './image.service.js';
import { MatchCandidatesRepository } from './match-candidates.repository.js';
import { MetadataController } from './metadata.controller.js';
import { MetadataService } from './metadata.service.js';
import { OmdbProvider } from './providers/omdb.provider.js';
import { TmdbProvider } from './providers/tmdb.provider.js';

@Module({
	imports: [MediaModule, WikidataModule, forwardRef(() => LibraryModule)],
	controllers: [MetadataController, ImageController],
	providers: [
		TmdbProvider,
		OmdbProvider,
		MetadataService,
		GroupMetadataService,
		ImageService,
		FileProbeService,
		MatchCandidatesRepository,
	],
	exports: [
		MetadataService,
		GroupMetadataService,
		ImageService,
		TmdbProvider,
		OmdbProvider,
		FileProbeService,
		MatchCandidatesRepository,
	],
})
export class MetadataModule {}
