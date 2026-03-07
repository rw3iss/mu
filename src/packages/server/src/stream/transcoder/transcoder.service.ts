import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigService } from '../../config/config.service.js';
import { TRANSCODING_PROFILES } from './transcoder.profiles.js';

interface TranscodeOptions {
  quality?: string;
  audioTrack?: number;
  subtitleTrack?: number;
}

@Injectable()
export class TranscoderService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscoderService.name);
  private readonly activeProcesses = new Map<string, ChildProcess>();
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

  async startTranscode(
    sessionId: string,
    filePath: string,
    options: TranscodeOptions = {},
  ): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    await mkdir(sessionDir, { recursive: true });

    const quality = options.quality || '1080p';
    const profile = TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES]
      ?? TRANSCODING_PROFILES['1080p'];

    if (!profile) {
      throw new Error(`No transcoding profile found for quality "${quality}"`);
    }

    const outputPath = path.join(sessionDir, 'stream.m3u8');
    const segmentPattern = path.join(sessionDir, 'segment_%04d.ts');

    const hwAccel = this.config.get<string>('transcoding.hwAccel') || 'none';
    const videoCodec = this.getVideoCodec(hwAccel);

    return new Promise<void>((resolve, reject) => {
      let command = ffmpeg(filePath)
        .outputOptions([
          '-f', 'hls',
          '-hls_time', '6',
          '-hls_list_size', '0',
          '-hls_segment_filename', segmentPattern,
          '-hls_playlist_type', 'event',
        ])
        .videoCodec(videoCodec)
        .audioCodec('aac')
        .audioBitrate(profile.audioBitrate)
        .videoBitrate(profile.videoBitrate)
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

      // Select specific audio track if provided
      if (options.audioTrack !== undefined) {
        command = command.outputOptions(['-map', `0:a:${options.audioTrack}`]);
      } else {
        command = command.outputOptions(['-map', '0:a:0']);
      }

      // Map video stream
      command = command.outputOptions(['-map', '0:v:0']);

      command
        .output(outputPath)
        .on('start', (commandLine: string) => {
          this.logger.log(`FFmpeg started for session ${sessionId}: ${commandLine}`);
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
          // Only reject if we haven't resolved yet
          reject(err);
        })
        .on('end', () => {
          this.logger.log(`Transcode complete for session ${sessionId}`);
          this.activeProcesses.delete(sessionId);
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
