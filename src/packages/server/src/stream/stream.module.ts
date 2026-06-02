import { Module } from '@nestjs/common';
import { RemoteModule } from '../remote/remote.module.js';
import { ConversionService } from './conversion/conversion.service.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';
import { SubtitleController } from './subtitles/subtitle.controller.js';
import { SubtitleService } from './subtitles/subtitle.service.js';
import { SubtitleIngestionService } from './subtitles/subtitle-ingestion.service.js';
import { SubtitleManageController } from './subtitles/subtitle-manage.controller.js';
import { SubtitleRemoteProxyService } from './subtitles/subtitle-remote-proxy.service.js';
import { SubtitleSearchService } from './subtitles/subtitle-search.service.js';
import { SubtitleTracksRepository } from './subtitles/subtitle-tracks.repository.js';
import { ChunkManagerService } from './transcoder/chunk-manager.service.js';
import { ChunkManifestService } from './transcoder/chunk-manifest.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { TranscodeDebugController } from './transcoder/transcode-debug.controller.js';
import { TranscodeDebuggerService } from './transcoder/transcode-debugger.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';

@Module({
	imports: [RemoteModule],
	controllers: [
		StreamController,
		SubtitleController,
		SubtitleManageController,
		TranscodeDebugController,
	],
	providers: [
		StreamService,
		TranscoderService,
		ConversionService,
		HlsGeneratorService,
		ChunkManagerService,
		ChunkManifestService,
		DirectPlayService,
		SubtitleService,
		SubtitleSearchService,
		SubtitleRemoteProxyService,
		SubtitleTracksRepository,
		SubtitleIngestionService,
		TranscodeDebuggerService,
	],
	exports: [
		StreamService,
		TranscoderService,
		ConversionService,
		DirectPlayService,
		HlsGeneratorService,
		ChunkManagerService,
		ChunkManifestService,
		SubtitleService,
		SubtitleSearchService,
		SubtitleTracksRepository,
		SubtitleIngestionService,
		TranscodeDebuggerService,
	],
})
export class StreamModule {}
