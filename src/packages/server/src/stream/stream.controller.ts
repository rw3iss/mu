import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { StreamService } from './stream.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { eq } from 'drizzle-orm';
import { movieFiles } from '../database/schema/index.js';

@Controller('stream')
export class StreamController {
  private readonly logger = new Logger(StreamController.name);

  constructor(
    private readonly streamService: StreamService,
    private readonly hlsGenerator: HlsGeneratorService,
    private readonly directPlayService: DirectPlayService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Start a new streaming session for a movie.
   */
  @Get(':movieId/start')
  async startStream(
    @Param('movieId') movieId: string,
    @Query('quality') quality: string | undefined,
    @Query('audioTrack') audioTrack: string | undefined,
    @Query('subtitleTrack') subtitleTrack: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.streamService.startStream(movieId, user.sub ?? user.id, {
      quality,
      audioTrack: audioTrack ? parseInt(audioTrack, 10) : undefined,
      subtitleTrack: subtitleTrack ? parseInt(subtitleTrack, 10) : undefined,
    });
  }

  /**
   * Get the HLS manifest for an active transcoding session.
   */
  @Get(':sessionId/manifest.m3u8')
  async getManifest(
    @Param('sessionId') sessionId: string,
    @Res() reply: FastifyReply,
  ) {
    const manifest = await this.hlsGenerator.getManifest(sessionId);

    if (!manifest) {
      throw new NotFoundException(`Manifest not found for session ${sessionId}`);
    }

    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'no-cache')
      .send(manifest);
  }

  /**
   * Get a specific HLS segment for an active transcoding session.
   */
  @Get(':sessionId/segment/:segmentNumber.ts')
  async getSegment(
    @Param('sessionId') sessionId: string,
    @Param('segmentNumber') segmentNumber: string,
    @Res() reply: FastifyReply,
  ) {
    const segment = await this.hlsGenerator.getSegment(sessionId, parseInt(segmentNumber, 10));

    if (!segment) {
      throw new NotFoundException(
        `Segment ${segmentNumber} not found for session ${sessionId}`,
      );
    }

    return reply
      .header('Content-Type', 'video/mp2t')
      .header('Cache-Control', 'public, max-age=86400')
      .send(segment);
  }

  /**
   * Update playback progress for an active session.
   */
  @Post(':sessionId/progress')
  async updateProgress(
    @Param('sessionId') sessionId: string,
    @Body() body: { positionSeconds: number },
  ) {
    await this.streamService.updateProgress(sessionId, body.positionSeconds);
    return { success: true };
  }

  /**
   * End a streaming session, stopping any active transcode and cleaning up resources.
   */
  @Delete(':sessionId')
  async endStream(@Param('sessionId') sessionId: string) {
    await this.streamService.endStream(sessionId);
    return { success: true };
  }

  /**
   * Direct play / direct stream a file with HTTP range request support.
   */
  @Get('direct/:fileId')
  async directPlay(
    @Param('fileId') fileId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const fileRows = await this.db.db
      .select()
      .from(movieFiles)
      .where(eq(movieFiles.id, fileId));

    if (fileRows.length === 0) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    const file = fileRows[0]!;
    return this.directPlayService.serveFile(file.filePath, request, reply);
  }

  /**
   * List all active streaming sessions (admin endpoint).
   */
  @Get('sessions')
  async getActiveSessions() {
    return this.streamService.getActiveSessions();
  }
}
