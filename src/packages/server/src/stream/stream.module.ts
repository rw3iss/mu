import { Module } from '@nestjs/common';
import { StreamController } from './stream.controller.js';
import { StreamService } from './stream.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { SubtitleService } from './subtitles/subtitle.service.js';
import { SubtitleController } from './subtitles/subtitle.controller.js';

@Module({
  controllers: [StreamController, SubtitleController],
  providers: [
    StreamService,
    TranscoderService,
    HlsGeneratorService,
    DirectPlayService,
    SubtitleService,
  ],
  exports: [StreamService, TranscoderService],
})
export class StreamModule {}
