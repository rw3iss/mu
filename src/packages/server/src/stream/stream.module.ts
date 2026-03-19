import { Module } from '@nestjs/common';
import { RemoteModule } from '../remote/remote.module.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';
import { SubtitleController } from './subtitles/subtitle.controller.js';
import { SubtitleService } from './subtitles/subtitle.service.js';
import { SubtitleManageController } from './subtitles/subtitle-manage.controller.js';
import { SubtitleSearchService } from './subtitles/subtitle-search.service.js';
import { ChunkManagerService } from './transcoder/chunk-manager.service.js';
import { ChunkManifestService } from './transcoder/chunk-manifest.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';

@Module({
	imports: [RemoteModule],
	controllers: [StreamController, SubtitleController, SubtitleManageController],
	providers: [
		StreamService,
		TranscoderService,
		HlsGeneratorService,
		ChunkManagerService,
		ChunkManifestService,
		DirectPlayService,
		SubtitleService,
		SubtitleSearchService,
	],
	exports: [
		StreamService,
		TranscoderService,
		DirectPlayService,
		HlsGeneratorService,
		ChunkManagerService,
		ChunkManifestService,
		SubtitleService,
		SubtitleSearchService,
	],
})
export class StreamModule {}
