import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { stat, opendir } from 'fs/promises';
import { basename, extname, join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { nowISO, SUPPORTED_VIDEO_EXTENSIONS, WsEvent } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { EventsService } from '../events/events.service.js';
import { CacheService } from '../cache/cache.service.js';
import {
  mediaSources,
  movies,
  movieFiles,
  scanLog,
} from '../database/schema/index.js';

interface ParsedFilename {
  title: string;
  year?: number;
  quality?: string;
}

@Injectable()
export class ScannerService {
  private readonly logger = new Logger('ScannerService');

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly events: EventsService,
    private readonly cache: CacheService,
  ) {}

  async scanSource(sourceId: string) {
    const source = this.database.db
      .select()
      .from(mediaSources)
      .where(eq(mediaSources.id, sourceId))
      .get();

    if (!source) {
      throw new Error(`Source ${sourceId} not found`);
    }

    const logId = crypto.randomUUID();
    const now = nowISO();

    this.database.db.insert(scanLog).values({
      id: logId,
      sourceId,
      startedAt: now,
      status: 'running',
    }).run();

    this.events.emit(WsEvent.SCAN_STARTED, { sourceId, logId });
    this.logger.log(`Scan started for source: ${source.path}`);

    let filesFound = 0;
    let filesAdded = 0;
    let filesUpdated = 0;
    let filesRemoved = 0;
    const errors: string[] = [];
    const foundPaths = new Set<string>();
    const newMovieIds: string[] = [];

    try {
      for await (const filePath of this.walkDir(source.path, SUPPORTED_VIDEO_EXTENSIONS)) {
        filesFound++;
        foundPaths.add(filePath);

        try {
          const fileStat = await stat(filePath);
          const fileName = basename(filePath);
          const fileModifiedAt = fileStat.mtime.toISOString();
          const fileSize = fileStat.size;

          const existing = this.database.db
            .select()
            .from(movieFiles)
            .where(eq(movieFiles.filePath, filePath))
            .get();

          if (existing) {
            if (existing.fileModifiedAt !== fileModifiedAt || existing.fileSize !== fileSize) {
              this.database.db
                .update(movieFiles)
                .set({ fileSize, fileModifiedAt, available: true })
                .where(eq(movieFiles.id, existing.id))
                .run();
              filesUpdated++;
            } else if (!existing.available) {
              this.database.db
                .update(movieFiles)
                .set({ available: true })
                .where(eq(movieFiles.id, existing.id))
                .run();
            }
          } else {
            const parsed = this.parseFilename(fileName);
            const movieId = crypto.randomUUID();
            const movieNow = nowISO();

            this.database.db.insert(movies).values({
              id: movieId,
              title: parsed.title,
              year: parsed.year ?? null,
              addedAt: movieNow,
              updatedAt: movieNow,
            }).run();

            // Probe the file for codec/duration info
            const probeInfo = await this.probeFile(filePath);

            this.database.db.insert(movieFiles).values({
              id: crypto.randomUUID(),
              movieId,
              sourceId,
              filePath,
              fileName,
              fileSize,
              resolution: parsed.quality ?? probeInfo.resolution ?? null,
              codecVideo: probeInfo.codecVideo ?? null,
              codecAudio: probeInfo.codecAudio ?? null,
              durationSeconds: probeInfo.durationSeconds ?? null,
              bitrate: probeInfo.bitrate ?? null,
              available: true,
              addedAt: movieNow,
              fileModifiedAt,
            }).run();

            filesAdded++;
            newMovieIds.push(movieId);
            this.events.emit(WsEvent.LIBRARY_MOVIE_ADDED, { movieId, title: parsed.title });
          }
        } catch (err: any) {
          errors.push(`Error processing ${filePath}: ${err.message}`);
          this.logger.warn(`Error processing file ${filePath}: ${err.message}`);
        }

        if (filesFound % 50 === 0) {
          this.events.emit(WsEvent.SCAN_PROGRESS, { sourceId, logId, filesFound });
        }
      }

      // Mark files no longer present as unavailable
      const dbFiles = this.database.db
        .select({ id: movieFiles.id, filePath: movieFiles.filePath })
        .from(movieFiles)
        .where(and(eq(movieFiles.sourceId, sourceId), eq(movieFiles.available, true)))
        .all();

      for (const dbFile of dbFiles) {
        if (!foundPaths.has(dbFile.filePath)) {
          this.database.db
            .update(movieFiles)
            .set({ available: false })
            .where(eq(movieFiles.id, dbFile.id))
            .run();
          filesRemoved++;
        }
      }

      // Update source stats
      this.database.db
        .update(mediaSources)
        .set({
          lastScannedAt: nowISO(),
          fileCount: foundPaths.size,
          updatedAt: nowISO(),
        })
        .where(eq(mediaSources.id, sourceId))
        .run();

      // Finalize scan log
      this.database.db
        .update(scanLog)
        .set({
          completedAt: nowISO(),
          status: 'completed',
          filesFound,
          filesAdded,
          filesUpdated,
          filesRemoved,
          errors: JSON.stringify(errors),
        })
        .where(eq(scanLog.id, logId))
        .run();

      this.events.emit(WsEvent.SCAN_COMPLETED, {
        sourceId,
        logId,
        filesFound,
        filesAdded,
        filesUpdated,
        filesRemoved,
      });

      this.logger.log(
        `Scan completed for ${source.path}: found=${filesFound} added=${filesAdded} updated=${filesUpdated} removed=${filesRemoved}`,
      );

      // Metadata + thumbnail jobs are now enqueued automatically by
      // LibraryJobsService when it receives LIBRARY_MOVIE_ADDED events.
    } catch (err: any) {
      this.database.db
        .update(scanLog)
        .set({
          completedAt: nowISO(),
          status: 'failed',
          filesFound,
          filesAdded,
          filesUpdated,
          filesRemoved,
          errors: JSON.stringify([...errors, err.message]),
        })
        .where(eq(scanLog.id, logId))
        .run();

      this.events.emit(WsEvent.SCAN_ERROR, { sourceId, logId, error: err.message });
      this.logger.error(`Scan failed for ${source.path}: ${err.message}`);
      throw err;
    }

    return { logId, filesFound, filesAdded, filesUpdated, filesRemoved };
  }

  parseFilename(filename: string): ParsedFilename {
    const ext = extname(filename);
    let name = filename.replace(ext, '');

    // Try "Movie Name (2020)" pattern
    const parenYear = name.match(/^(.+?)\s*\((\d{4})\)/);
    if (parenYear?.[1] && parenYear[2]) {
      return {
        title: parenYear[1].trim(),
        year: parseInt(parenYear[2], 10),
        quality: this.extractQuality(name),
      };
    }

    // Try "Movie.Name.2020.1080p" or "Movie Name 2020 1080p" pattern
    const dotYear = name.match(/^(.+?)[.\s](\d{4})[.\s]/);
    if (dotYear?.[1] && dotYear[2]) {
      const title = dotYear[1].replace(/\./g, ' ').trim();
      return {
        title,
        year: parseInt(dotYear[2], 10),
        quality: this.extractQuality(name),
      };
    }

    // Try year at end: "Movie Name 2020"
    const endYear = name.match(/^(.+?)\s+(\d{4})$/);
    if (endYear?.[1] && endYear[2]) {
      return {
        title: endYear[1].replace(/\./g, ' ').trim(),
        year: parseInt(endYear[2], 10),
      };
    }

    // No year found - clean up the title
    return {
      title: name.replace(/\./g, ' ').replace(/\s+/g, ' ').trim(),
      quality: this.extractQuality(name),
    };
  }

  private extractQuality(name: string): string | undefined {
    const match = name.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
    return match?.[1]?.toLowerCase();
  }

  /**
   * Use FFprobe to extract codec, resolution, duration, and bitrate from a file.
   * Returns partial info on failure so scanning can continue.
   */
  private async probeFile(filePath: string): Promise<{
    codecVideo?: string;
    codecAudio?: string;
    resolution?: string;
    durationSeconds?: number;
    bitrate?: number;
  }> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          this.logger.warn(`FFprobe failed for ${basename(filePath)}: ${err.message}`);
          resolve({});
          return;
        }

        const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
        const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

        const width = videoStream?.width;
        const height = videoStream?.height;
        let resolution: string | undefined;
        if (height) {
          if (height >= 2160) resolution = '2160p';
          else if (height >= 1080) resolution = '1080p';
          else if (height >= 720) resolution = '720p';
          else if (height >= 480) resolution = '480p';
          else resolution = `${height}p`;
        }

        resolve({
          codecVideo: videoStream?.codec_name ?? undefined,
          codecAudio: audioStream?.codec_name ?? undefined,
          resolution,
          durationSeconds: metadata.format?.duration
            ? Math.round(metadata.format.duration)
            : undefined,
          bitrate: metadata.format?.bit_rate
            ? Math.round(Number(metadata.format.bit_rate))
            : undefined,
        });
      });
    });
  }

  async *walkDir(dirPath: string, extensions: readonly string[]): AsyncGenerator<string> {
    const extSet = new Set(extensions.map((e) => e.toLowerCase()));
    let dir;
    try {
      dir = await opendir(dirPath);
    } catch {
      return;
    }

    for await (const entry of dir) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        yield* this.walkDir(fullPath, extensions);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (extSet.has(ext)) {
          yield fullPath;
        }
      }
    }
  }
}
