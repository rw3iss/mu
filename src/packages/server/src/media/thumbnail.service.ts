import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { movies, movieFiles } from '../database/schema/index.js';

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger('ThumbnailService');
  private readonly thumbnailDir: string;
  private readonly width: number;
  private readonly height: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.thumbnailDir = resolve(
      this.config.get<string>('media.thumbnailDir', './data/thumbnails'),
    );
    this.width = this.config.get<number>('media.thumbnailWidth', 320);
    this.height = this.config.get<number>('media.thumbnailHeight', 180);

    if (!existsSync(this.thumbnailDir)) {
      mkdirSync(this.thumbnailDir, { recursive: true });
    }
  }

  /**
   * Generate a thumbnail for a movie by extracting a frame from its video file.
   * Captures a frame at ~10% into the video to avoid black intro frames.
   */
  async generateForMovie(movieId: string): Promise<string | null> {
    // Find the first available file for this movie
    const file = this.database.db
      .select()
      .from(movieFiles)
      .where(eq(movieFiles.movieId, movieId))
      .get();

    if (!file || !file.filePath) {
      this.logger.warn(`No file found for movie ${movieId}`);
      return null;
    }

    const outputFilename = `${movieId}.jpg`;
    const outputPath = join(this.thumbnailDir, outputFilename);

    try {
      // Get duration to pick a good frame
      const durationSeconds = await this.probeDuration(file.filePath);
      // Capture at 10% or 5 seconds, whichever is greater (avoids black frames)
      const seekTime = Math.max(5, Math.floor(durationSeconds * 0.1));

      await this.extractFrame(file.filePath, outputPath, seekTime);

      // Store a relative URL for the API to serve
      const thumbnailUrl = `/api/v1/media/thumbnails/${outputFilename}`;

      this.database.db
        .update(movies)
        .set({ thumbnailUrl, updatedAt: nowISO() })
        .where(eq(movies.id, movieId))
        .run();

      this.logger.debug(`Thumbnail generated for movie ${movieId}`);
      return thumbnailUrl;
    } catch (err: any) {
      this.logger.warn(
        `Failed to generate thumbnail for movie ${movieId}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Probe video duration in seconds.
   */
  private probeDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata?.format?.duration ?? 60);
      });
    });
  }

  /**
   * Extract a single frame at the given seek time.
   */
  private extractFrame(
    inputPath: string,
    outputPath: string,
    seekSeconds: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(seekSeconds)
        .frames(1)
        .size(`${this.width}x${this.height}`)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  /**
   * Get the absolute path to a thumbnail file.
   */
  getThumbnailPath(filename: string): string {
    return join(this.thumbnailDir, filename);
  }
}
