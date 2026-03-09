import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

interface SubtitleTrack {
  index: number;
  language: string;
  title: string;
}

@Injectable()
export class SubtitleService {
  private readonly logger = new Logger(SubtitleService.name);
  private readonly cacheDir: string;

  constructor() {
    this.cacheDir = path.resolve('data/cache/subtitles');
  }

  /**
   * Extract embedded subtitle tracks from a video file using ffprobe,
   * then extract each subtitle stream to WebVTT format.
   * Returns metadata about the discovered subtitle tracks.
   */
  async extractSubtitles(filePath: string, movieFileId: string): Promise<SubtitleTrack[]> {
    const outputDir = this.getSubtitleDir(movieFileId);
    await mkdir(outputDir, { recursive: true });

    // Use ffprobe to discover subtitle streams
    const probeData = await this.probe(filePath);
    const subtitleStreams = (probeData.streams || []).filter(
      (stream: any) => stream.codec_type === 'subtitle',
    );

    if (subtitleStreams.length === 0) {
      this.logger.debug(`No embedded subtitles found in ${path.basename(filePath)}`);
      return [];
    }

    const tracks: SubtitleTrack[] = [];

    for (let i = 0; i < subtitleStreams.length; i++) {
      const stream = subtitleStreams[i];
      const language = stream.tags?.language || 'und';
      const title = stream.tags?.title || `Track ${i}`;
      const outputPath = path.join(outputDir, `${i}.vtt`);

      try {
        await this.extractTrack(filePath, stream.index, outputPath);
        tracks.push({ index: i, language, title });
        this.logger.debug(`Extracted subtitle track ${i} (${language}) from ${path.basename(filePath)}`);
      } catch (err) {
        this.logger.warn(`Failed to extract subtitle track ${i} from ${path.basename(filePath)}: ${err}`);
      }
    }

    return tracks;
  }

  /**
   * Get the file path for a specific extracted subtitle track in WebVTT format.
   */
  getSubtitleFile(movieFileId: string, trackIndex: number): string {
    return path.join(this.getSubtitleDir(movieFileId), `${trackIndex}.vtt`);
  }

  /**
   * Search for external subtitle files (.srt, .vtt, .ass) located alongside the video file.
   * Returns an array of absolute paths to discovered subtitle files.
   */
  async findExternalSubtitles(videoFilePath: string): Promise<string[]> {
    const dir = path.dirname(videoFilePath);
    const baseName = path.basename(videoFilePath, path.extname(videoFilePath));
    const subtitleExtensions = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const subtitleFiles: string[] = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!subtitleExtensions.includes(ext)) continue;

      // Match files that start with the same base name as the video
      // This catches patterns like: movie.en.srt, movie.srt, movie.forced.en.srt
      if (file.startsWith(baseName)) {
        subtitleFiles.push(path.join(dir, file));
      }
    }

    return subtitleFiles;
  }

  /**
   * Delete cached subtitles for a movie file.
   */
  async clearCache(movieFileId: string): Promise<void> {
    const dir = this.getSubtitleDir(movieFileId);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      this.logger.debug(`Cleared subtitle cache for file ${movieFileId}`);
    }
  }

  /**
   * Get the cache directory for a specific movie file's subtitles.
   */
  private getSubtitleDir(movieFileId: string): string {
    return path.join(this.cacheDir, movieFileId);
  }

  /**
   * Run ffprobe on a file and return the parsed metadata.
   */
  private probe(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: Error | null, data: any) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  }

  /**
   * Extract a single subtitle track to WebVTT format using FFmpeg.
   */
  private extractTrack(
    inputPath: string,
    streamIndex: number,
    outputPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-map', `0:${streamIndex}`,
          '-c:s', 'webvtt',
        ])
        .output(outputPath)
        .on('error', (err: Error) => reject(err))
        .on('end', () => resolve())
        .run();
    });
  }
}
