import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess } from 'child_process';
import { mkdir, rm, writeFile, access } from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigService } from '../../config/config.service.js';
import { TRANSCODING_PROFILES } from './transcoder.profiles.js';

interface TranscodeOptions {
  quality?: string;
  audioTrack?: number;
  subtitleTrack?: number;
}

type TranscodeState = 'running' | 'completed' | 'failed';

@Injectable()
export class TranscoderService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscoderService.name);
  private readonly activeProcesses = new Map<string, ChildProcess>();
  /** Tracks the state of each transcode session (running / completed / failed) */
  private readonly sessionStates = new Map<string, { state: TranscodeState; error?: string }>();
  private readonly cacheDir: string;

  constructor(private readonly config: ConfigService) {
    this.cacheDir = path.resolve(
      this.config.get<string>('cache.streamDir') || './data/cache/streams',
    );
  }

  async onModuleDestroy() {
    // Kill all active transcode processes on shutdown
    for (const [sessionId] of this.activeProcesses) {
      this.stopTranscode(sessionId);
    }
  }

  /**
   * Get the persistent cache directory for a given movie file + quality.
   */
  getPersistentDir(movieFileId: string, quality: string): string {
    return path.join(this.cacheDir, 'persistent', movieFileId, quality);
  }

  /**
   * Check whether a fully completed transcode cache exists.
   */
  async hasCachedTranscode(movieFileId: string, quality: string): Promise<boolean> {
    const dir = this.getPersistentDir(movieFileId, quality);
    try {
      await access(path.join(dir, '.complete'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove persistent cache for one file (all qualities) or all files.
   */
  async clearCache(movieFileId?: string): Promise<void> {
    const target = movieFileId
      ? path.join(this.cacheDir, 'persistent', movieFileId)
      : path.join(this.cacheDir, 'persistent');
    try {
      await rm(target, { recursive: true, force: true });
      this.logger.log(`Cleared persistent cache: ${target}`);
    } catch (err) {
      this.logger.warn(`Failed to clear cache ${target}: ${err}`);
    }
  }

  /**
   * Get the transcode state for a session. Returns undefined if the session
   * was never tracked (e.g. direct play or unknown session).
   */
  getTranscodeState(sessionId: string): { state: TranscodeState; error?: string } | undefined {
    return this.sessionStates.get(sessionId);
  }

  async startTranscode(
    sessionId: string,
    filePath: string,
    options: TranscodeOptions = {},
    outputDir?: string,
  ): Promise<void> {
    const targetDir = outputDir || this.getSessionDir(sessionId);
    await mkdir(targetDir, { recursive: true });

    const quality = options.quality || '1080p';
    const profile = TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES]
      ?? TRANSCODING_PROFILES['1080p'];

    if (!profile) {
      throw new Error(`No transcoding profile found for quality "${quality}"`);
    }

    const outputPath = path.join(targetDir, 'stream.m3u8');
    const segmentPattern = path.join(targetDir, 'segment_%04d.ts');

    const hwAccel = this.config.get<string>('transcoding.hwAccel') || 'none';
    const videoCodec = this.getVideoCodec(hwAccel);

    return new Promise<void>((resolve, reject) => {
      let command = ffmpeg(filePath)
        .outputOptions([
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '0',
          '-hls_segment_filename', segmentPattern,
          '-hls_playlist_type', 'event',
          '-hls_flags', 'independent_segments',
        ])
        .videoCodec(videoCodec)
        .audioCodec('aac')
        .outputOptions([
          '-threads', '0',
          '-g', '48',
          '-sc_threshold', '0',
          '-b:a', profile.audioBitrate,
          '-b:v', profile.videoBitrate,
        ])
        .size(`${profile.width}x${profile.height}`)
        .outputOptions(['-preset', profile.preset]);

      // Apply hardware acceleration input options
      if (hwAccel === 'nvenc') {
        command = command.inputOptions(['-hwaccel', 'cuda']);
      } else if (hwAccel === 'vaapi') {
        command = command.inputOptions([
          '-hwaccel', 'vaapi',
          '-hwaccel_output_format', 'vaapi',
          '-vaapi_device', '/dev/dri/renderD128',
        ]);
      } else if (hwAccel === 'qsv') {
        command = command.inputOptions(['-hwaccel', 'qsv']);
      }

      // Map video stream
      command = command.outputOptions(['-map', '0:v:0']);

      // Select specific audio track if provided (? suffix prevents crash on files with no audio)
      if (options.audioTrack !== undefined) {
        command = command.outputOptions(['-map', `0:a:${options.audioTrack}?`]);
      } else {
        command = command.outputOptions(['-map', '0:a:0?']);
      }

      command
        .output(outputPath)
        .on('start', (commandLine: string) => {
          this.logger.log(`FFmpeg started for session ${sessionId}, outputDir=${targetDir}`);
          this.logger.debug(`FFmpeg command: ${commandLine}`);
          this.sessionStates.set(sessionId, { state: 'running' });
          // Resolve immediately once FFmpeg starts; segments will be generated progressively
          resolve();
        })
        .on('progress', (progress: any) => {
          this.logger.debug(
            `Transcode progress [${sessionId}]: ${progress.percent?.toFixed(1)}%`,
          );
        })
        .on('error', (err: Error) => {
          this.logger.error(`FFmpeg error for session ${sessionId}: ${err.message}`);
          this.activeProcesses.delete(sessionId);
          this.sessionStates.set(sessionId, { state: 'failed', error: err.message });
          // Only reject if we haven't resolved yet
          reject(err);
        })
        .on('end', () => {
          this.logger.log(`Transcode complete for session ${sessionId}`);
          this.activeProcesses.delete(sessionId);
          this.sessionStates.set(sessionId, { state: 'completed' });
          // Write .complete marker for persistent cache
          if (outputDir) {
            writeFile(path.join(targetDir, '.complete'), '').catch(() => {});
          }
        });

      // Run the command and capture the child process
      const proc = command.run();

      // fluent-ffmpeg stores the process on the command object
      const ffmpegProcess = (command as any).ffmpegProc;
      if (ffmpegProcess) {
        this.activeProcesses.set(sessionId, ffmpegProcess);
      }
    });
  }

  async startRemux(sessionId: string, filePath: string, outputDir?: string): Promise<void> {
    const targetDir = outputDir || this.getSessionDir(sessionId);
    await mkdir(targetDir, { recursive: true });

    const outputPath = path.join(targetDir, 'stream.m3u8');
    const segmentPattern = path.join(targetDir, 'segment_%04d.ts');

    return new Promise<void>((resolve, reject) => {
      const command = ffmpeg(filePath)
        .outputOptions([
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '0',
          '-hls_segment_filename', segmentPattern,
          '-hls_playlist_type', 'event',
          '-hls_flags', 'independent_segments',
        ])
        .videoCodec('copy')
        .audioCodec('copy')
        .outputOptions([
          '-map', '0:v:0',
          '-map', '0:a:0?',
        ])
        .output(outputPath)
        .on('start', (commandLine: string) => {
          this.logger.log(`FFmpeg remux started for session ${sessionId}, outputDir=${targetDir}`);
          this.logger.debug(`FFmpeg command: ${commandLine}`);
          this.sessionStates.set(sessionId, { state: 'running' });
          resolve();
        })
        .on('progress', (progress: any) => {
          this.logger.debug(
            `Remux progress [${sessionId}]: ${progress.percent?.toFixed(1)}%`,
          );
        })
        .on('error', (err: Error) => {
          this.logger.error(`FFmpeg remux error for session ${sessionId}: ${err.message}`);
          this.activeProcesses.delete(sessionId);
          this.sessionStates.set(sessionId, { state: 'failed', error: err.message });
          reject(err);
        })
        .on('end', () => {
          this.logger.log(`Remux complete for session ${sessionId}`);
          this.activeProcesses.delete(sessionId);
          this.sessionStates.set(sessionId, { state: 'completed' });
          if (outputDir) {
            writeFile(path.join(targetDir, '.complete'), '').catch(() => {});
          }
        });

      command.run();

      const ffmpegProcess = (command as any).ffmpegProc;
      if (ffmpegProcess) {
        this.activeProcesses.set(sessionId, ffmpegProcess);
      }
    });
  }

  /**
   * Run a full transcode or remux to the persistent cache directory.
   * Resolves when FFmpeg finishes (not on start), so the cache is complete.
   */
  async preTranscode(
    movieFileId: string,
    filePath: string,
    mode: string,
    quality: string = '1080p',
  ): Promise<void> {
    const persistDir = this.getPersistentDir(movieFileId, quality);

    // Already cached
    if (await this.hasCachedTranscode(movieFileId, quality)) {
      this.logger.log(`Pre-transcode skipped — cache exists for ${movieFileId}/${quality}`);
      return;
    }

    await mkdir(persistDir, { recursive: true });

    const outputPath = path.join(persistDir, 'stream.m3u8');
    const segmentPattern = path.join(persistDir, 'segment_%04d.ts');
    const processKey = `pre-${movieFileId}-${quality}`;

    const isTranscode = mode === 'transcode';

    const hwAccel = this.config.get<string>('transcoding.hwAccel') || 'none';

    return new Promise<void>((resolve, reject) => {
      let command = ffmpeg(filePath)
        .outputOptions([
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '0',
          '-hls_segment_filename', segmentPattern,
          '-hls_playlist_type', 'event',
          '-hls_flags', 'independent_segments',
        ]);

      if (isTranscode) {
        const profile = (TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES]
          ?? TRANSCODING_PROFILES['1080p'])!;
        const videoCodec = this.getVideoCodec(hwAccel);

        command = command
          .videoCodec(videoCodec)
          .audioCodec('aac')
          .outputOptions([
            '-threads', '0',
            '-g', '48',
            '-sc_threshold', '0',
            '-b:a', profile.audioBitrate,
            '-b:v', profile.videoBitrate,
          ])
          .size(`${profile.width}x${profile.height}`)
          .outputOptions(['-preset', profile.preset]);

        if (hwAccel === 'nvenc') {
          command = command.inputOptions(['-hwaccel', 'cuda']);
        } else if (hwAccel === 'vaapi') {
          command = command.inputOptions([
            '-hwaccel', 'vaapi',
            '-hwaccel_output_format', 'vaapi',
            '-vaapi_device', '/dev/dri/renderD128',
          ]);
        } else if (hwAccel === 'qsv') {
          command = command.inputOptions(['-hwaccel', 'qsv']);
        }
      } else {
        // DIRECT_STREAM → remux (copy codecs)
        command = command.videoCodec('copy').audioCodec('copy');
      }

      command = command.outputOptions(['-map', '0:v:0', '-map', '0:a:0?']);

      command
        .output(outputPath)
        .on('start', (commandLine: string) => {
          this.logger.log(`Pre-transcode started for ${movieFileId}: ${commandLine}`);
        })
        .on('progress', (progress: any) => {
          this.logger.debug(
            `Pre-transcode progress [${movieFileId}]: ${progress.percent?.toFixed(1)}%`,
          );
        })
        .on('error', (err: Error) => {
          this.logger.error(`Pre-transcode error for ${movieFileId}: ${err.message}`);
          this.activeProcesses.delete(processKey);
          reject(err);
        })
        .on('end', () => {
          this.logger.log(`Pre-transcode complete for ${movieFileId}/${quality}`);
          this.activeProcesses.delete(processKey);
          writeFile(path.join(persistDir, '.complete'), '').then(() => resolve()).catch(() => resolve());
        });

      command.run();

      const ffmpegProcess = (command as any).ffmpegProc;
      if (ffmpegProcess) {
        this.activeProcesses.set(processKey, ffmpegProcess);
      }
    });
  }

  stopTranscode(sessionId: string): void {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      this.logger.log(`Stopping transcode for session ${sessionId}`);
      try {
        // On Windows, SIGKILL is not available; use SIGTERM which works cross-platform.
        // fluent-ffmpeg processes respond to SIGTERM gracefully.
        proc.kill();
      } catch (err) {
        this.logger.warn(`Failed to kill FFmpeg process for session ${sessionId}: ${err}`);
      }
      this.activeProcesses.delete(sessionId);
    }
  }

  getSessionDir(sessionId: string): string {
    return path.join(this.cacheDir, sessionId);
  }

  async cleanup(sessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    try {
      await rm(sessionDir, { recursive: true, force: true });
      this.logger.log(`Cleaned up transcode files for session ${sessionId}`);
    } catch (err) {
      this.logger.warn(`Failed to clean up session ${sessionId}: ${err}`);
    }
  }

  private getVideoCodec(hwAccel: string): string {
    switch (hwAccel) {
      case 'nvenc':
        return 'h264_nvenc';
      case 'vaapi':
        return 'h264_vaapi';
      case 'qsv':
        return 'h264_qsv';
      default:
        return 'libx264';
    }
  }
}
