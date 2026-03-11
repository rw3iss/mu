import { Module } from '@nestjs/common';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';
import { SubtitleController } from './subtitles/subtitle.controller.js';
import { SubtitleService } from './subtitles/subtitle.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';

@Module({
	controllers: [StreamController, SubtitleController],
	providers: [
		StreamService,
		TranscoderService,
		HlsGeneratorService,
		DirectPlayService,
		SubtitleService,
	],
	exports: [StreamService, TranscoderService, SubtitleService],
})
export class StreamModule {}
