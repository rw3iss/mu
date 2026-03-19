import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { nowISO, WsEvent } from '@mu/shared';
import { Controller, Logger, Param, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { Roles } from '../common/decorators/roles.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { LibraryJobsService } from '../library/library-jobs.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { MetadataService } from './metadata.service.js';

@Controller()
export class MetadataController {
	private readonly logger = new Logger('MetadataController');

	constructor(
		private readonly metadataService: MetadataService,
		private readonly database: DatabaseService,
		private readonly thumbnailService: ThumbnailService,
		private readonly events: EventsService,
		private readonly libraryJobs: LibraryJobsService,
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

	@Post('movies/:id/clear-metadata')
	@Roles('admin')
	async clearMetadata(@Param('id') movieId: string) {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) return { message: 'Movie not found' };

		// Derive a basic title from the movie's file name
		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();
		let baseTitle = movie.title;
		if (file?.fileName) {
			// Strip extension and clean up filename for display
			baseTitle = file.fileName
				.replace(/\.[^.]+$/, '')
				.replace(/[._]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		}

		// Clear all metadata and reset title to filename-derived name
		this.database.db
			.update(movies)
			.set({
				title: baseTitle,
				year: null,
				overview: null,
				tagline: null,
				originalTitle: null,
				posterUrl: null,
				backdropUrl: null,
				trailerUrl: null,
				imdbId: null,
				tmdbId: null,
				releaseDate: null,
				language: null,
				country: null,
				contentRating: null,
				runtimeMinutes: null,
				updatedAt: nowISO(),
			})
			.where(eq(movies.id, movieId))
			.run();

		// Delete the movie_metadata record entirely
		this.database.db.delete(movieMetadata).where(eq(movieMetadata.movieId, movieId)).run();

		this.logger.log(`Cleared metadata for movie ${movieId} (${movie.title})`);
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'clear-metadata' });

		return { message: 'Metadata cleared' };
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

		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();

		const results: {
			fileId: string;
			fileName: string | null;
			updated: boolean;
			missing: boolean;
			corrupt?: boolean;
		}[] = [];

		for (const file of files) {
			// Check if the file exists on disk and re-mark as available if it does
			const fileExists = existsSync(file.filePath);
			if (fileExists && !file.available) {
				this.database.db
					.update(movieFiles)
					.set({ available: true })
					.where(eq(movieFiles.id, file.id))
					.run();
				this.logger.log(`Re-marked file as available: ${file.filePath}`);
			} else if (!fileExists && file.available) {
				this.database.db
					.update(movieFiles)
					.set({ available: false })
					.where(eq(movieFiles.id, file.id))
					.run();
				this.logger.warn(`File no longer accessible, marked unavailable: ${file.filePath}`);
			}

			if (!fileExists) {
				results.push({
					fileId: file.id,
					fileName: file.fileName,
					updated: false,
					missing: true,
				});
				continue;
			}

			// Check for empty/corrupt files (< 1KB)
			try {
				const stat = statSync(file.filePath);
				if (stat.size < 1024) {
					this.logger.warn(
						`File is empty or corrupt (${stat.size} bytes): ${file.filePath}`,
					);
					this.database.db
						.update(movieFiles)
						.set({ available: false })
						.where(eq(movieFiles.id, file.id))
						.run();
					results.push({
						fileId: file.id,
						fileName: file.fileName,
						updated: false,
						missing: false,
						corrupt: true,
					});
					continue;
				}
			} catch {
				// stat failed — treat as missing
				results.push({
					fileId: file.id,
					fileName: file.fileName,
					updated: false,
					missing: true,
				});
				continue;
			}

			const probeResult = await this.probeFileFull(file.filePath);

			if (!probeResult) {
				results.push({
					fileId: file.id,
					fileName: file.fileName,
					updated: false,
					missing: false,
				});
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
					videoWidth: codecInfo.videoWidth ?? null,
					videoHeight: codecInfo.videoHeight ?? null,
					videoBitDepth: codecInfo.videoBitDepth ?? null,
					videoFrameRate: codecInfo.videoFrameRate ?? null,
					videoProfile: codecInfo.videoProfile ?? null,
					videoColorSpace: codecInfo.videoColorSpace ?? null,
					hdr: codecInfo.hdr ?? false,
					containerFormat: codecInfo.containerFormat ?? null,
					audioTracks: codecInfo.audioTracks
						? JSON.stringify(codecInfo.audioTracks)
						: '[]',
					subtitleTracks: codecInfo.subtitleTracks
						? JSON.stringify(codecInfo.subtitleTracks)
						: '[]',
					fileMetadata: JSON.stringify(fileMetadata),
				})
				.where(eq(movieFiles.id, file.id))
				.run();

			// Update movie record from file metadata tags — only fill empty fields
			if (movie) {
				const tags = fileMetadata.formatTags ?? {};
				const movieUpdate: Record<string, unknown> = { updatedAt: nowISO() };

				// Title: only if currently empty or matches a bare filename pattern
				if (!movie.title) {
					const tagTitle = tags.title || tags.TITLE;
					if (tagTitle && typeof tagTitle === 'string' && tagTitle.trim()) {
						movieUpdate.title = tagTitle.trim();
					}
				}

				// Year: only if not already set
				if (!movie.year) {
					const tagDate =
						tags.date || tags.DATE || tags.DATE_RELEASED || tags.year || tags.YEAR;
					if (tagDate) {
						const yearMatch = String(tagDate).match(/(\d{4})/);
						if (yearMatch) {
							movieUpdate.year = parseInt(yearMatch[1]!, 10);
						}
					}
				}

				// Overview/description: only if not already set
				if (!movie.overview) {
					const tagDesc =
						tags.description ||
						tags.DESCRIPTION ||
						tags.synopsis ||
						tags.SYNOPSIS ||
						tags.comment ||
						tags.COMMENT;
					if (tagDesc && typeof tagDesc === 'string' && tagDesc.trim()) {
						movieUpdate.overview = tagDesc.trim();
					}
				}

				// Content rating: only if not already set
				if (!movie.contentRating) {
					const tagRating = tags.rating || tags.RATING || tags.content_rating;
					if (tagRating && typeof tagRating === 'string' && tagRating.trim()) {
						movieUpdate.contentRating = tagRating.trim();
					}
				}

				// Runtime from probe duration — always update (file-derived, not metadata)
				if (codecInfo.durationSeconds && codecInfo.durationSeconds > 0) {
					movieUpdate.runtimeMinutes = Math.round(codecInfo.durationSeconds / 60);
				}

				this.database.db
					.update(movies)
					.set(movieUpdate)
					.where(eq(movies.id, movieId))
					.run();
			}

			results.push({
				fileId: file.id,
				fileName: file.fileName,
				updated: true,
				missing: false,
			});
		}

		// Generate a smart thumbnail (tries multiple positions, avoids black frames)
		let thumbnailUrl: string | null = null;
		const bestFile = files.find((f) => f.available) ?? files[0];
		if (bestFile?.filePath) {
			try {
				thumbnailUrl = await this.thumbnailService.generateFromFile(
					movieId,
					bestFile.filePath,
				);
			} catch (err: any) {
				this.logger.warn(`Thumbnail generation failed during rescan: ${err.message}`);
			}
		}

		// Enqueue pre-transcode jobs if needed (file available but no cached transcode)
		let transcoding = false;
		const movieTitle = movie?.title || 'Unknown';
		try {
			this.libraryJobs.enqueuePreTranscodeIfNeeded(movieId, movieTitle);
			transcoding = true;
		} catch (err: any) {
			this.logger.warn(`Failed to enqueue pre-transcode during rescan: ${err.message}`);
		}

		this.logger.log(`Rescanned ${results.length} file(s) for movie ${movieId}`);

		// Emit WebSocket event
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'rescan' });

		return { files: results, thumbnailUrl, transcoding };
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
			videoWidth?: number;
			videoHeight?: number;
			videoBitDepth?: number;
			videoFrameRate?: string;
			videoProfile?: string;
			videoColorSpace?: string;
			hdr?: boolean;
			containerFormat?: string;
			audioTracks?: any[];
			subtitleTracks?: any[];
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

				// HDR detection
				const colorTransfer = (videoStream as any)?.color_transfer ?? '';
				const colorSpace = (videoStream as any)?.color_space ?? '';
				const hdr =
					colorTransfer === 'smpte2084' ||
					colorTransfer === 'arib-std-b67' ||
					colorSpace === 'bt2020nc' ||
					colorSpace === 'bt2020c';

				// Frame rate
				const rFrameRate = (videoStream as any)?.r_frame_rate;
				let videoFrameRate: string | undefined;
				if (rFrameRate) {
					const parts = rFrameRate.split('/');
					if (parts.length === 2 && Number(parts[1])) {
						videoFrameRate = (Number(parts[0]) / Number(parts[1])).toFixed(3);
					} else {
						videoFrameRate = rFrameRate;
					}
				}

				// Audio tracks
				const audioStreams = (metadata.streams ?? []).filter(
					(s) => s.codec_type === 'audio',
				);
				const audioTracks = audioStreams.map((s: any, i: number) => ({
					index: i,
					codec: s.codec_name ?? 'unknown',
					language: s.tags?.language ?? 'und',
					title: s.tags?.title ?? `Track ${i + 1}`,
					channels: s.channels ?? 0,
					channelLayout: s.channel_layout ?? '',
					sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
					bitDepth: s.bits_per_raw_sample
						? parseInt(s.bits_per_raw_sample, 10)
						: undefined,
				}));

				// Subtitle tracks
				const subtitleStreams = (metadata.streams ?? []).filter(
					(s) => s.codec_type === 'subtitle',
				);
				const subtitleTracks = subtitleStreams.map((s: any, i: number) => ({
					index: i,
					codec: s.codec_name ?? 'unknown',
					language: s.tags?.language ?? 'und',
					title: s.tags?.title ?? `Track ${i + 1}`,
					forced: s.disposition?.forced === 1,
					external: false,
				}));

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
					videoWidth: width,
					videoHeight: height,
					videoBitDepth: (videoStream as any)?.bits_per_raw_sample
						? parseInt((videoStream as any).bits_per_raw_sample, 10)
						: undefined,
					videoFrameRate,
					videoProfile:
						videoStream?.profile != null ? String(videoStream.profile) : undefined,
					videoColorSpace: colorSpace || undefined,
					hdr,
					containerFormat: metadata.format?.format_name ?? undefined,
					audioTracks,
					subtitleTracks,
				};

				// Raw metadata blob
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
						? Object.fromEntries(Object.entries(s.tags).map(([k, v]) => [k, String(v)]))
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
