import { existsSync, statSync } from 'node:fs';
import { nowISO, WsEvent } from '@mu/shared';
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Logger,
	Param,
	Post,
	Query,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { LibraryJobsService } from '../library/library-jobs.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { FileProbeService } from './file-probe.service.js';
import { MatchCandidatesRepository } from './match-candidates.repository.js';
import { MetadataService } from './metadata.service.js';

interface ApplyCandidateBody {
	provider: string;
	externalId: string;
}

@Controller()
export class MetadataController {
	private readonly logger = new Logger('MetadataController');

	constructor(
		private readonly metadataService: MetadataService,
		private readonly database: DatabaseService,
		private readonly thumbnailService: ThumbnailService,
		private readonly events: EventsService,
		private readonly libraryJobs: LibraryJobsService,
		private readonly guidResolver: GuidResolverService,
		private readonly fileProbe: FileProbeService,
		private readonly matchCandidates: MatchCandidatesRepository,
	) {}

	@RequireAction('view:library')
	@Get('movies/:id/match-candidates')
	listCandidates(@Param('id') movieId: string) {
		return { candidates: this.matchCandidates.list('movie', movieId) };
	}

	/** Free-text metadata search for the "Search for Metadata" modal. */
	@RequireAction('view:library')
	@Get('metadata/search')
	async searchMetadata(@Query('q') q: string, @Query('type') type?: string) {
		const candidates = await this.metadataService.searchCandidates(q ?? '', type);
		return { candidates };
	}

	/** Fetch + persist the complete TMDB cast for a movie (ingest keeps 20). */
	@RequireAction('view:library')
	@Post('movies/:id/full-cast')
	async fullCast(@Param('id') movieId: string) {
		const cast = await this.metadataService.fetchFullCast(movieId);
		return { cast };
	}

	/** Assign a chosen search result as this movie's metadata. */
	@Post('movies/:id/assign-metadata')
	@RequireAction('edit:movie')
	async assignMetadata(
		@Param('id') movieId: string,
		@Body() body: { tmdbId?: number; imdbId?: string },
	) {
		const result = await this.metadataService.assignMetadata(movieId, {
			tmdbId: body?.tmdbId ?? null,
			imdbId: body?.imdbId ?? null,
		});
		return result ?? { message: 'No metadata applied' };
	}

	@Post('movies/:id/match-candidates/apply')
	@Roles('admin')
	@RequireAction('edit:movie')
	async applyCandidate(@Param('id') movieId: string, @Body() body: ApplyCandidateBody) {
		if (!body?.provider || !body?.externalId) {
			throw new BadRequestException('provider and externalId required');
		}
		const result = await this.metadataService.applyCandidate(
			movieId,
			body.provider,
			body.externalId,
		);
		return result ?? { message: 'Candidate applied (no details returned)' };
	}

	@Delete('movies/:id/match-candidates')
	@Roles('admin')
	@RequireAction('edit:movie')
	clearCandidates(@Param('id') movieId: string) {
		this.matchCandidates.clear('movie', movieId);
		return { ok: true };
	}

	@Post('movies/refresh-all')
	@Roles('admin')
	@RequireAction('edit:movie')
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
	@RequireAction('edit:movie')
	async refreshMetadata(@Param('id') movieId: string) {
		// User-triggered refresh: pull the real title back too (overwriting a
		// manual edit). The user can re-edit afterwards if they want.
		const metadata = await this.metadataService.refreshMetadata(movieId, {
			overwriteTitle: true,
		});
		return metadata ?? { message: 'No metadata found' };
	}

	@Post('movies/:id/clear-metadata')
	@Roles('admin')
	@RequireAction('edit:movie')
	async clearMetadata(@Param('id') movieId: string) {
		try {
			await this.metadataService.clearMetadata(movieId);
		} catch {
			return { message: 'Movie not found' };
		}
		return { message: 'Metadata cleared' };
	}

	@Post('movies/:id/rescan')
	@Roles('admin')
	@RequireAction('edit:movie')
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

			const probeResult = await this.fileProbe.probe(file.filePath);

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

		// Enqueue pre-transcode jobs if needed (file available but no valid cached transcode)
		let transcoding = false;
		const movieTitle = movie?.title || 'Unknown';
		let prioritized = 0;
		try {
			await this.libraryJobs.enqueuePreTranscodeIfNeeded(movieId, movieTitle);
			transcoding = true;
			// User-triggered rescan: jump this movie's processing job (existing or
			// freshly enqueued above) to the front of the queue.
			prioritized = this.libraryJobs.prioritizeMovieJobs(movieId);
		} catch (err: any) {
			this.logger.warn(`Failed to enqueue pre-transcode during rescan: ${err.message}`);
		}

		this.logger.log(
			`Rescanned ${results.length} file(s) for movie ${this.guidResolver.resolve(movieId)}`,
		);

		// Emit WebSocket event
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'rescan' });

		return { files: results, thumbnailUrl, transcoding, prioritized };
	}
}
