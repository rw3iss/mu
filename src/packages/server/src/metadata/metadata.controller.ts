import { Controller, Post, Param, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { basename } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { nowISO } from '@mu/shared';
import { MetadataService } from './metadata.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { movies, movieMetadata, movieFiles } from '../database/schema/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller()
export class MetadataController {
  private readonly logger = new Logger('MetadataController');

  constructor(
    private readonly metadataService: MetadataService,
    private readonly database: DatabaseService,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  @Post('movies/refresh-all')
  @Roles('admin')
  async refreshAll() {
    // Get all movie IDs
    const allMovies = this.database.db.select({ id: movies.id }).from(movies).all();

    // Get movie IDs that already have metadata
    const withMetadata = new Set(
      this.database.db
        .select({ movieId: movieMetadata.movieId })
        .from(movieMetadata)
        .all()
        .map((m) => m.movieId),
    );

    // Filter to movies without metadata
    const movieIds = allMovies.filter((m) => !withMetadata.has(m.id)).map((m) => m.id);
    const movieCount = movieIds.length;

    // Fire off bulk fetch as a background process
    this.metadataService.bulkFetch(movieIds, 2).catch((err) => {
      this.logger.error(`Bulk metadata refresh failed: ${err.message}`);
    });

    return { message: 'Metadata refresh started', movieCount };
  }

  @Post('movies/:id/refresh')
  @Roles('admin')
  async refreshMetadata(@Param('id') movieId: string) {
    const metadata = await this.metadataService.refreshMetadata(movieId);
    return metadata ?? { message: 'No metadata found' };
  }

  @Post('movies/:id/rescan')
  @Roles('admin')
  async rescan(@Param('id') movieId: string) {
    const files = this.database.db
      .select()
      .from(movieFiles)
      .where(eq(movieFiles.movieId, movieId))
      .all();

    if (files.length === 0) {
      return { files: [], message: 'No files found for this movie' };
    }

    const movie = this.database.db
      .select()
      .from(movies)
      .where(eq(movies.id, movieId))
      .get();

    const results: { fileId: string; fileName: string | null; updated: boolean }[] = [];

    for (const file of files) {
      const probeResult = await this.probeFileFull(file.filePath);

      if (!probeResult) {
        results.push({ fileId: file.id, fileName: file.fileName, updated: false });
        continue;
      }

      const { codecInfo, fileMetadata } = probeResult;

      // Update movie_files with codec info + full metadata JSON
      this.database.db
        .update(movieFiles)
        .set({
          codecVideo: codecInfo.codecVideo ?? null,
          codecAudio: codecInfo.codecAudio ?? null,
          resolution: codecInfo.resolution ?? file.resolution,
          durationSeconds: codecInfo.durationSeconds ?? null,
          bitrate: codecInfo.bitrate ?? null,
          fileMetadata: JSON.stringify(fileMetadata),
        })
        .where(eq(movieFiles.id, file.id))
        .run();

      // Update movie record from file metadata tags
      if (movie) {
        const tags = fileMetadata.formatTags ?? {};
        const movieUpdate: Record<string, unknown> = { updatedAt: nowISO() };

        // Title: prefer file tag over filename-parsed title
        const tagTitle = tags.title || tags.TITLE;
        if (tagTitle && typeof tagTitle === 'string' && tagTitle.trim()) {
          movieUpdate.title = tagTitle.trim();
        }

        // Year: from date/DATE_RELEASED/year tags
        const tagDate = tags.date || tags.DATE || tags.DATE_RELEASED || tags.year || tags.YEAR;
        if (tagDate) {
          const yearMatch = String(tagDate).match(/(\d{4})/);
          if (yearMatch) {
            movieUpdate.year = parseInt(yearMatch[1]!, 10);
          }
        }

        // Overview/description
        const tagDesc =
          tags.description || tags.DESCRIPTION ||
          tags.synopsis || tags.SYNOPSIS ||
          tags.comment || tags.COMMENT;
        if (tagDesc && typeof tagDesc === 'string' && tagDesc.trim()) {
          movieUpdate.overview = tagDesc.trim();
        }

        // Content rating
        const tagRating = tags.rating || tags.RATING || tags.content_rating;
        if (tagRating && typeof tagRating === 'string' && tagRating.trim()) {
          movieUpdate.contentRating = tagRating.trim();
        }

        // Runtime from probe duration (more reliable than tags)
        if (codecInfo.durationSeconds && codecInfo.durationSeconds > 0) {
          movieUpdate.runtimeMinutes = Math.round(codecInfo.durationSeconds / 60);
        }

        this.database.db
          .update(movies)
          .set(movieUpdate)
          .where(eq(movies.id, movieId))
          .run();
      }

      results.push({ fileId: file.id, fileName: file.fileName, updated: true });
    }

    // Generate a smart thumbnail (tries multiple positions, avoids black frames)
    let thumbnailUrl: string | null = null;
    const bestFile = files.find((f) => f.available) ?? files[0];
    if (bestFile?.filePath) {
      try {
        thumbnailUrl = await this.thumbnailService.generateFromFile(movieId, bestFile.filePath);
      } catch (err: any) {
        this.logger.warn(`Thumbnail generation failed during rescan: ${err.message}`);
      }
    }

    this.logger.log(`Rescanned ${results.length} file(s) for movie ${movieId}`);
    return { files: results, thumbnailUrl };
  }

  /**
   * Full FFprobe extraction — returns both structured codec info and the
   * raw metadata (format tags, stream tags) that serve as the "exif" data.
   */
  private probeFileFull(filePath: string): Promise<{
    codecInfo: {
      codecVideo?: string;
      codecAudio?: string;
      resolution?: string;
      durationSeconds?: number;
      bitrate?: number;
    };
    fileMetadata: {
      formatTags: Record<string, string>;
      streams: {
        index: number;
        codecType?: string;
        codecName?: string;
        width?: number;
        height?: number;
        tags?: Record<string, string>;
      }[];
      format: {
        formatName?: string;
        duration?: number;
        size?: number;
        bitRate?: number;
      };
    };
  } | null> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          this.logger.warn(`FFprobe failed for ${basename(filePath)}: ${err.message}`);
          resolve(null);
          return;
        }

        const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
        const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

        // Structured codec info
        const height = videoStream?.height;
        let resolution: string | undefined;
        if (height) {
          if (height >= 2160) resolution = '2160p';
          else if (height >= 1080) resolution = '1080p';
          else if (height >= 720) resolution = '720p';
          else if (height >= 480) resolution = '480p';
          else resolution = `${height}p`;
        }

        const codecInfo = {
          codecVideo: videoStream?.codec_name ?? undefined,
          codecAudio: audioStream?.codec_name ?? undefined,
          resolution,
          durationSeconds: metadata.format?.duration
            ? Math.round(metadata.format.duration)
            : undefined,
          bitrate: metadata.format?.bit_rate
            ? Math.round(Number(metadata.format.bit_rate))
            : undefined,
        };

        // Raw metadata blob — all tags from format and each stream
        const formatTags: Record<string, string> = {};
        if (metadata.format?.tags) {
          for (const [key, value] of Object.entries(metadata.format.tags)) {
            if (value != null) formatTags[key] = String(value);
          }
        }

        const streams = (metadata.streams ?? []).map((s) => ({
          index: s.index,
          codecType: s.codec_type,
          codecName: s.codec_name,
          width: s.width,
          height: s.height,
          tags: s.tags
            ? Object.fromEntries(
                Object.entries(s.tags).map(([k, v]) => [k, String(v)]),
              )
            : undefined,
        }));

        const format = {
          formatName: metadata.format?.format_name,
          duration: metadata.format?.duration,
          size: metadata.format?.size,
          bitRate: metadata.format?.bit_rate
            ? Number(metadata.format.bit_rate)
            : undefined,
        };

        resolve({
          codecInfo,
          fileMetadata: { formatTags, streams, format },
        });
      });
    });
  }
}
