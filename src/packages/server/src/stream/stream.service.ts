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
import { SettingsService } from '../settings/settings.service.js';
import {
  movies,
  movieFiles,
  streamSessions,
  userWatchHistory,
  users,
} from '../database/schema/index.js';

interface StartStreamOptions {
  quality?: string;
  audioTrack?: number;
  subtitleTrack?: number;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  /** Maps sessionId → the directory where HLS segments live (persistent or ephemeral) */
  private readonly sessionDirs = new Map<string, string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly events: EventsService,
    private readonly transcoderService: TranscoderService,
    private readonly directPlayService: DirectPlayService,
    private readonly subtitleService: SubtitleService,
    private readonly settings: SettingsService,
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
      transcoding: mode !== StreamMode.DIRECT_PLAY,
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

    // Start transcode or remux pipeline as needed
    const lib = this.settings.get<Record<string, unknown>>('library', {});
    const persistEnabled = (lib as any)?.persistTranscodes !== false;

    if (mode === StreamMode.TRANSCODE || mode === StreamMode.DIRECT_STREAM) {
      const persistDir = this.transcoderService.getPersistentDir(file.id, quality);
      const hasCached = persistEnabled && await this.transcoderService.hasCachedTranscode(file.id, quality);

      if (hasCached) {
        // Use the existing persistent cache — no FFmpeg needed
        this.sessionDirs.set(sessionId, persistDir);
        this.logger.log(`Using cached transcode for session=${sessionId}, file=${file.id}`);
      } else {
        const outputDir = persistEnabled ? persistDir : undefined;
        if (outputDir) {
          this.sessionDirs.set(sessionId, persistDir);
        }

        if (mode === StreamMode.TRANSCODE) {
          await this.transcoderService.startTranscode(sessionId, file.filePath, {
            quality,
            audioTrack: options.audioTrack,
            subtitleTrack: options.subtitleTrack,
          }, outputDir);
        } else {
          await this.transcoderService.startRemux(sessionId, file.filePath, outputDir);
        }
      }
    }

    // Look up resume position from watch history, and ensure a history
    // entry exists (so the movie appears in history immediately on play).
    let resumePosition = 0;
    const historyRows = await this.database.db
      .select()
      .from(userWatchHistory)
      .where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)));

    if (historyRows.length > 0) {
      resumePosition = historyRows[0]!.positionSeconds ?? 0;
      // Touch watchedAt so it sorts to the top of history
      await this.database.db
        .update(userWatchHistory)
        .set({ watchedAt: nowISO() })
        .where(eq(userWatchHistory.id, historyRows[0]!.id));
    } else {
      // Create history entry immediately on play
      await this.database.db.insert(userWatchHistory).values({
        id: crypto.randomUUID(),
        userId,
        movieId,
        positionSeconds: 0,
        durationWatchedSeconds: 0,
        watchedAt: nowISO(),
      });
    }

    // Build stream URL based on mode
    const directPlay = mode === StreamMode.DIRECT_PLAY;
    let streamUrl: string;
    if (directPlay) {
      streamUrl = `/api/v1/stream/direct/${file.id}`;
    } else {
      // Both TRANSCODE and DIRECT_STREAM use HLS manifest
      streamUrl = `/api/v1/stream/${sessionId}/manifest.m3u8`;
    }

    this.events.emit(WsEvent.STREAM_STARTED, {
      sessionId,
      movieId,
      userId,
      mode,
    });

    const resolvedDir = this.sessionDirs.get(sessionId) || this.transcoderService.getSessionDir(sessionId);
    this.logger.log(
      `Stream started: session=${sessionId}, movie=${movieId}, file=${file.id}, mode=${mode}, quality=${quality}, segmentDir=${resolvedDir}`,
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
      // Only delete ephemeral session dirs — persistent cache dirs are kept
      const isPersistent = this.sessionDirs.has(sessionId);
      if (!isPersistent) {
        await this.transcoderService.cleanup(sessionId);
      }
      this.sessionDirs.delete(sessionId);
    }

    // Mark session as ended by clearing lastActiveAt
    await this.database.db
      .delete(streamSessions)
      .where(eq(streamSessions.id, sessionId));

    // Update watch history with final position
    const finalPosition = session.positionSeconds ?? 0;
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
          positionSeconds: finalPosition,
          watchedAt: nowISO(),
        })
        .where(eq(userWatchHistory.id, existing[0]!.id));
    } else {
      await this.database.db.insert(userWatchHistory).values({
        id: crypto.randomUUID(),
        userId: session.userId,
        movieId: session.movieId,
        positionSeconds: finalPosition,
        durationWatchedSeconds: 0,
        watchedAt: nowISO(),
      });
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
      .select({
        sessionId: streamSessions.id,
        userId: streamSessions.userId,
        username: users.username,
        movieId: streamSessions.movieId,
        movieTitle: movies.title,
        position: streamSessions.positionSeconds,
        startedAt: streamSessions.startedAt,
        lastActivity: streamSessions.lastActiveAt,
      })
      .from(streamSessions)
      .leftJoin(users, eq(streamSessions.userId, users.id))
      .leftJoin(movies, eq(streamSessions.movieId, movies.id))
      .all();
  }

  async endAllSessions(): Promise<number> {
    const sessions = this.database.db
      .select()
      .from(streamSessions)
      .all();

    for (const session of sessions) {
      try {
        await this.endStream(session.id);
      } catch (err: any) {
        this.logger.warn(`Failed to end session ${session.id}: ${err.message}`);
      }
    }

    return sessions.length;
  }

  /**
   * Get the HLS directory for a session — persistent cache dir if available,
   * otherwise the default ephemeral session dir.
   */
  getSessionCacheDir(sessionId: string): string | undefined {
    return this.sessionDirs.get(sessionId);
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
   *
   * Browser-native playback requires H.264/AAC in an MP4 or WebM container.
   * Everything else must be transcoded to HLS.
   */
  determineStreamMode(file: any): string {
    const filePath = (file.filePath || '').toLowerCase();
    const codec = (file.codecVideo || '').toLowerCase();
    const ext = filePath.slice(filePath.lastIndexOf('.'));

    const isH264 = codec === 'h264' || codec === 'avc' || codec === 'h.264';
    const isHevc = codec === 'hevc' || codec === 'h265' || codec === 'h.265';
    const isMp4 = ext === '.mp4' || ext === '.m4v';
    const isMkv = ext === '.mkv';
    const isWebm = ext === '.webm';

    // Browser-compatible containers
    const isBrowserContainer = isMp4 || isWebm;

    // If we have codec info, use it for precise decisions
    if (codec) {
      if (isH264 && isBrowserContainer) return StreamMode.DIRECT_PLAY;
      if (isH264 && isMkv) return StreamMode.DIRECT_STREAM;
      // HEVC, XviD, MPEG-4, VP8/9, etc. all need transcoding
      return StreamMode.TRANSCODE;
    }

    // No codec info — decide based on container only.
    // Only MP4/WebM are safe to attempt direct play without knowing the codec.
    // MKV without codec info must transcode (can't assume H.264 for remux).
    if (isMp4 || isWebm) return StreamMode.DIRECT_PLAY;

    // Default: transcode anything we're not sure about
    return StreamMode.TRANSCODE;
  }
}
