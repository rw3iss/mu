import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies } from '../database/schema/index.js';

/**
 * Minimum JPEG file size (in bytes) for a frame to be considered "non-blank".
 * At 960px wide with quality 2, a black frame is typically 3-8 KB.
 * Anything below this threshold is almost certainly a black or nearly-blank frame.
 */
const MIN_FRAME_BYTES = 10240;

interface ProbeInfo {
	duration: number;
	width: number;
	height: number;
}

@Injectable()
export class ThumbnailService {
	private readonly logger = new Logger('ThumbnailService');
	private readonly thumbnailDir: string;
	private readonly maxWidth: number;

	constructor(
		private readonly database: DatabaseService,
		private readonly config: ConfigService,
		private readonly guidResolver: GuidResolverService,
	) {
		this.thumbnailDir = resolve(
			this.config.get<string>('media.thumbnailDir', './data/thumbnails'),
		);
		this.maxWidth = this.config.get<number>('media.thumbnailWidth', 640);

		if (!existsSync(this.thumbnailDir)) {
			mkdirSync(this.thumbnailDir, { recursive: true });
		}
	}

	/**
	 * Generate a thumbnail for a movie by extracting a frame from its video file.
	 * Uses a smart algorithm that tries multiple positions to avoid black/blank frames.
	 */
	async generateForMovie(movieId: string): Promise<string | null> {
		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();

		if (!file || !file.filePath) {
			this.logger.warn(`No file found for movie ${this.guidResolver.resolve(movieId)}`);
			return null;
		}

		return this.generateFromFile(movieId, file.filePath);
	}

	/**
	 * Generate a thumbnail for a movie from a specific file path.
	 * Preserves the video's native aspect ratio — scales to maxWidth and lets
	 * height follow naturally.  Stores the aspect ratio on the movie record so
	 * the frontend can lay out images correctly without loading them first.
	 */
	async generateFromFile(movieId: string, filePath: string): Promise<string | null> {
		const outputFilename = `${movieId}.jpg`;
		const outputPath = join(this.thumbnailDir, outputFilename);

		try {
			const probe = await this.probeVideo(filePath);
			const seekTime = await this.findBestFrame(filePath, probe);

			await this.extractFrame(filePath, outputPath, seekTime);

			// Cache-bust: append version param so browsers fetch the fresh image
			const thumbnailUrl = `/api/v1/media/thumbnails/${outputFilename}?v=${Date.now()}`;
			const aspectRatio =
				probe.width && probe.height
					? Math.round((probe.width / probe.height) * 1000) / 1000
					: null;

			this.database.db
				.update(movies)
				.set({
					thumbnailUrl,
					thumbnailAspectRatio: aspectRatio,
					updatedAt: nowISO(),
				})
				.where(eq(movies.id, movieId))
				.run();

			this.logger.debug(
				`Thumbnail generated for movie ${this.guidResolver.resolve(movieId)} at ${seekTime}s (AR: ${aspectRatio})`,
			);
			return thumbnailUrl;
		} catch (err: any) {
			this.logger.warn(`Failed to generate thumbnail for movie ${this.guidResolver.resolve(movieId)}: ${err.message}`);
			return null;
		}
	}

	/**
	 * Smart frame selection algorithm.
	 *
	 * Tries candidate timestamps in order and picks the first frame that isn't
	 * mostly black.  "Blackness" is detected by checking the JPEG file size —
	 * a black frame compresses to a very small file (~1-3 KB),
	 * while a real frame is typically 10-50+ KB.
	 *
	 * Candidate order:
	 *   1.  ~2s  (very start, past any initial black)
	 *   2. ~30s  (past typical intros / studio logos)
	 *   3.  10%  of duration
	 *   4.  25%  of duration
	 *   5.  50%  of duration (midpoint fallback)
	 */
	private async findBestFrame(filePath: string, probe: ProbeInfo): Promise<number> {
		const candidates = this.getCandidateTimestamps(probe.duration);
		const tempPath = join(this.thumbnailDir, `_probe_${Date.now()}.jpg`);

		try {
			for (const ts of candidates) {
				try {
					await this.extractFrame(filePath, tempPath, ts);

					if (existsSync(tempPath)) {
						const size = statSync(tempPath).size;
						if (size >= MIN_FRAME_BYTES) {
							this.logger.debug(
								`Frame at ${ts}s passed brightness check (${size} bytes)`,
							);
							return ts;
						}
						this.logger.debug(
							`Frame at ${ts}s is likely black (${size} bytes), trying next`,
						);
					}
				} catch {
					// Frame extraction failed at this timestamp — try next
				}
			}
		} finally {
			try {
				if (existsSync(tempPath)) unlinkSync(tempPath);
			} catch {
				// ignore
			}
		}

		// All candidates looked dark — fall back to midpoint
		return Math.floor(probe.duration * 0.5);
	}

	/**
	 * Build an ordered list of candidate timestamps, clamped to the video duration.
	 */
	private getCandidateTimestamps(durationSeconds: number): number[] {
		const maxSeek = Math.max(0, durationSeconds - 1);
		const raw = [
			2,
			30,
			Math.floor(durationSeconds * 0.1),
			Math.floor(durationSeconds * 0.25),
			Math.floor(durationSeconds * 0.5),
		];

		const seen = new Set<number>();
		const result: number[] = [];
		for (const ts of raw) {
			const clamped = Math.min(ts, maxSeek);
			if (!seen.has(clamped)) {
				seen.add(clamped);
				result.push(clamped);
			}
		}
		return result;
	}

	/**
	 * Probe the video for duration and dimensions.
	 */
	probeVideo(filePath: string): Promise<ProbeInfo> {
		return new Promise((resolve, reject) => {
			ffmpeg.ffprobe(filePath, (err, metadata) => {
				if (err) return reject(err);

				const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');

				resolve({
					duration: metadata?.format?.duration ?? 60,
					width: videoStream?.width ?? 0,
					height: videoStream?.height ?? 0,
				});
			});
		});
	}

	/**
	 * Kept for backward compatibility with callers that only need duration.
	 */
	probeDuration(filePath: string): Promise<number> {
		return this.probeVideo(filePath).then((p) => p.duration);
	}

	/**
	 * Extract a single frame at the given seek time.
	 *
	 * Uses `-vf scale=WIDTH:-2` to scale to a max width while preserving the
	 * video's native aspect ratio.  The `-2` ensures the height is rounded to
	 * an even number (required by most codecs / JPEG encoders).
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
				.outputOptions(['-vf', `scale=${this.maxWidth}:-2`, '-q:v', '2'])
				.output(outputPath)
				.on('end', () => resolve())
				.on('error', (err) => reject(err))
				.run();
		});
	}

	/**
	 * Delete the cached thumbnail for a movie.
	 */
	clearForMovie(movieId: string): void {
		const thumbPath = join(this.thumbnailDir, `${movieId}.jpg`);
		if (existsSync(thumbPath)) {
			unlinkSync(thumbPath);
			this.logger.debug(`Cleared thumbnail for movie ${this.guidResolver.resolve(movieId)}`);
		}
	}

	/**
	 * Get the absolute path to a thumbnail file.
	 */
	getThumbnailPath(filename: string): string {
		return join(this.thumbnailDir, filename);
	}
}
