import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { nowISO, WsEvent, StreamMode } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { EventsService } from '../events/events.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { SubtitleService } from './subtitles/subtitle.service.js';
import {
  movies,
  movieFiles,
  streamSessions,
  userWatchHistory,
} from '../database/schema/index.js';

interface StartStreamOptions {
  quality?: string;
  audioTrack?: number;
  subtitleTrack?: number;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly events: EventsService,
    private readonly transcoderService: TranscoderService,
    private readonly directPlayService: DirectPlayService,
    private readonly subtitleService: SubtitleService,
  ) {}

  async startStream(movieId: string, userId: string, options: StartStreamOptions = {}) {
    const movieFileList = await this.database.db
      .select()
      .from(movieFiles)
      .where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)));

    if (movieFileList.length === 0) {
      throw new NotFoundException(`No available file found for movie ${movieId}`);
    }

    // Pick the best available file (prefer highest resolution)
    const file = this.selectBestFile(movieFileList);

    // Determine stream mode based on container and codec
    const mode = this.determineStreamMode(file);

    const sessionId = crypto.randomUUID();
    const quality = options.quality || '1080p';

    await this.database.db.insert(streamSessions).values({
      id: sessionId,
      movieId,
      userId,
      movieFileId: file.id,
      quality,
      transcoding: mode === StreamMode.TRANSCODE,
      startedAt: nowISO(),
      lastActiveAt: nowISO(),
      positionSeconds: 0,
    });

    // Extract subtitles from the file
    let subtitleTracks: { index: number; language: string; title: string }[] = [];
    try {
      subtitleTracks = await this.subtitleService.extractSubtitles(file.filePath, file.id);
    } catch (err) {
      this.logger.warn(`Failed to extract subtitles for file ${file.id}: ${err}`);
    }

    // Find external subtitle files alongside the video
    let externalSubs: string[] = [];
    try {
      externalSubs = await this.subtitleService.findExternalSubtitles(file.filePath);
    } catch (err) {
      this.logger.warn(`Failed to find external subtitles: ${err}`);
    }

    // If transcoding is needed, start the transcode pipeline
    if (mode === StreamMode.TRANSCODE) {
      await this.transcoderService.startTranscode(sessionId, file.filePath, {
        quality,
        audioTrack: options.audioTrack,
        subtitleTrack: options.subtitleTrack,
      });
    }

    // Look up resume position from watch history
    let resumePosition = 0;
    const historyRows = await this.database.db
      .select()
      .from(userWatchHistory)
      .where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)));

    if (historyRows.length > 0) {
      resumePosition = historyRows[0]!.positionSeconds ?? 0;
    }

    // Build stream URL based on mode
    const directPlay = mode !== StreamMode.TRANSCODE;
    let streamUrl: string;
    if (directPlay) {
      streamUrl = `/api/v1/stream/direct/${file.id}`;
    } else {
      streamUrl = `/api/v1/stream/${sessionId}/manifest.m3u8`;
    }

    this.events.emit(WsEvent.STREAM_STARTED, {
      sessionId,
      movieId,
      userId,
      mode,
    });

    this.logger.log(
      `Stream started: session=${sessionId}, movie=${movieId}, mode=${mode}, quality=${quality}`,
    );

    return {
      sessionId,
      movieId,
      streamUrl,
      directPlay,
      format: directPlay ? 'native' : 'hls',
      subtitles: subtitleTracks.map((t) => ({
        id: String(t.index),
        label: t.title || t.language,
        language: t.language,
        url: `/api/v1/stream/${sessionId}/subtitles/${t.index}.vtt`,
      })),
      audioTracks: [],
      qualities: [],
      startPosition: resumePosition,
    };
  }

  async updateProgress(sessionId: string, positionSeconds: number) {
    const sessions = await this.database.db
      .select()
      .from(streamSessions)
      .where(eq(streamSessions.id, sessionId));

    if (sessions.length === 0) {
      throw new NotFoundException(`Stream session ${sessionId} not found`);
    }

    const session = sessions[0]!;

    await this.database.db
      .update(streamSessions)
      .set({
        positionSeconds,
        lastActiveAt: nowISO(),
      })
      .where(eq(streamSessions.id, sessionId));

    // Upsert watch history
    const existing = await this.database.db
      .select()
      .from(userWatchHistory)
      .where(
        and(
          eq(userWatchHistory.userId, session.userId),
          eq(userWatchHistory.movieId, session.movieId),
        ),
      );

    if (existing.length > 0) {
      await this.database.db
        .update(userWatchHistory)
        .set({
          positionSeconds,
          watchedAt: nowISO(),
        })
        .where(eq(userWatchHistory.id, existing[0]!.id));
    } else {
      await this.database.db.insert(userWatchHistory).values({
        id: crypto.randomUUID(),
        userId: session.userId,
        movieId: session.movieId,
        positionSeconds,
        durationWatchedSeconds: 0,
        watchedAt: nowISO(),
      });
    }
  }

  async endStream(sessionId: string) {
    const sessions = await this.database.db
      .select()
      .from(streamSessions)
      .where(eq(streamSessions.id, sessionId));

    if (sessions.length === 0) {
      throw new NotFoundException(`Stream session ${sessionId} not found`);
    }

    const session = sessions[0]!;

    // Stop any active transcode
    if (session.transcoding) {
      this.transcoderService.stopTranscode(sessionId);
      await this.transcoderService.cleanup(sessionId);
    }

    // Mark session as ended by clearing lastActiveAt
    await this.database.db
      .delete(streamSessions)
      .where(eq(streamSessions.id, sessionId));

    // Update watch history with final position
    const existing = await this.database.db
      .select()
      .from(userWatchHistory)
      .where(
        and(
          eq(userWatchHistory.userId, session.userId),
          eq(userWatchHistory.movieId, session.movieId),
        ),
      );

    if (existing.length > 0) {
      await this.database.db
        .update(userWatchHistory)
        .set({
          positionSeconds: session.positionSeconds ?? 0,
          watchedAt: nowISO(),
        })
        .where(eq(userWatchHistory.id, existing[0]!.id));
    }

    this.events.emit(WsEvent.STREAM_ENDED, {
      sessionId,
      userId: session.userId,
      movieId: session.movieId,
    });

    this.logger.log(`Stream ended: session=${sessionId}`);
  }

  async getActiveSessions() {
    return this.database.db
      .select()
      .from(streamSessions);
  }

  /**
   * Select the best file from a list of available movie files.
   * Prefers the highest resolution file available.
   */
  private selectBestFile(files: any[]) {
    if (files.length === 1) return files[0];

    // Sort by resolution height descending, pick the first
    return files.sort((a, b) => {
      const aHeight = a.resolutionHeight ?? 0;
      const bHeight = b.resolutionHeight ?? 0;
      return bHeight - aHeight;
    })[0];
  }

  /**
   * Determine the optimal stream mode based on container format and video codec.
   */
  private determineStreamMode(file: any): string {
    const filePath = (file.filePath || '').toLowerCase();
    const codec = (file.codecVideo || '').toLowerCase();

    const isH264 = codec === 'h264' || codec === 'avc' || codec === 'h.264';
    const isMp4 = filePath.endsWith('.mp4') || filePath.endsWith('.m4v');
    const isMkv = filePath.endsWith('.mkv');
    const isWebm = filePath.endsWith('.webm');

    // If we have codec info, use it for precise decisions
    if (codec) {
      if (isH264 && isMp4) return StreamMode.DIRECT_PLAY;
      if (isH264 && isMkv) return StreamMode.DIRECT_STREAM;
      return StreamMode.TRANSCODE;
    }

    // No codec info available (scanner didn't probe) — default to direct play
    // for browser-friendly containers; browsers handle mp4/webm/mkv well
    if (isMp4 || isWebm) return StreamMode.DIRECT_PLAY;
    if (isMkv) return StreamMode.DIRECT_STREAM;

    return StreamMode.DIRECT_PLAY;
  }
}
