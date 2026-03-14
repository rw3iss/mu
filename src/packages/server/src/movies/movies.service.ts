import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { MovieListQuery } from '@mu/shared';
import { nowISO, paginationDefaults } from '@mu/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, like, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	movieFiles,
	movieMetadata,
	movies,
	userRatings,
	userWatchHistory,
	userWatchlist,
} from '../database/schema/index.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { LibraryService } from '../library/library.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { ImageService } from '../metadata/image.service.js';
import { SubtitleService } from '../stream/subtitles/subtitle.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';

@Injectable()
export class MoviesService {
	private readonly logger = new Logger('MoviesService');

	constructor(
		private readonly database: DatabaseService,
		private readonly jobManager: JobManagerService,
		private readonly libraryService: LibraryService,
		private readonly thumbnailService: ThumbnailService,
		private readonly imageService: ImageService,
		private readonly transcoderService: TranscoderService,
		private readonly subtitleService: SubtitleService,
	) {}

	findAll(query: MovieListQuery, userId?: string) {
		const { page, pageSize, offset } = paginationDefaults(query);

		const conditions = [];

		// By default, hide hidden movies unless showHidden is explicitly set
		if (String(query.showHidden) !== 'true') {
			conditions.push(sql`(${movies.hidden} IS NULL OR ${movies.hidden} = 0)`);
		}

		if (query.search) {
			conditions.push(like(movies.title, `%${query.search}%`));
		}

		if (query.genre) {
			// Genres stored as JSON array in movie_metadata, use LIKE for containment
			conditions.push(like(movieMetadata.genres, `%"${query.genre}"%`));
		}

		if (query.yearFrom) {
			conditions.push(sql`${movies.year} >= ${query.yearFrom}`);
		}

		if (query.yearTo) {
			conditions.push(sql`${movies.year} <= ${query.yearTo}`);
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined;

		// Determine sort
		const sortOrder = query.sortOrder === 'asc' ? asc : desc;
		let orderBy;
		switch (query.sortBy) {
			case 'title':
				orderBy = sortOrder(movies.title);
				break;
			case 'year':
				orderBy = sortOrder(movies.year);
				break;
			case 'addedAt':
				orderBy = sortOrder(movies.addedAt);
				break;
			case 'runtime':
				orderBy = sortOrder(movies.runtimeMinutes);
				break;
			case 'rating':
				orderBy = sortOrder(userRatings.rating);
				break;
			case 'fileSize':
				orderBy = sortOrder(
					sql`(SELECT mf.file_size FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
				);
				break;
			default:
				orderBy = desc(movies.addedAt);
		}

		const selectFields = {
			id: movies.id,
			title: movies.title,
			originalTitle: movies.originalTitle,
			year: movies.year,
			overview: movies.overview,
			runtimeMinutes: movies.runtimeMinutes,
			posterUrl: movies.posterUrl,
			thumbnailUrl: movies.thumbnailUrl,
			backdropUrl: movies.backdropUrl,
			imdbId: movies.imdbId,
			tmdbId: movies.tmdbId,
			contentRating: movies.contentRating,
			hidden: movies.hidden,
			addedAt: movies.addedAt,
			updatedAt: movies.updatedAt,
			rating: userRatings.rating,
			watchPosition: userWatchHistory.positionSeconds,
			watchCompleted: userWatchHistory.completed,
			durationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
		};

		// Build query — always left-join userRatings for the current user
		const ratingJoinCond = userId
			? and(eq(movies.id, userRatings.movieId), eq(userRatings.userId, userId))
			: eq(movies.id, userRatings.movieId);

		const historyJoinCond = userId
			? and(eq(movies.id, userWatchHistory.movieId), eq(userWatchHistory.userId, userId))
			: eq(movies.id, userWatchHistory.movieId);

		let data;
		let total: number;

		if (query.genre) {
			data = this.database.db
				.select(selectFields)
				.from(movies)
				.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
				.leftJoin(userRatings, ratingJoinCond)
				.leftJoin(userWatchHistory, historyJoinCond)
				.where(where)
				.orderBy(orderBy)
				.limit(pageSize)
				.offset(offset)
				.all();

			const countResult = this.database.db
				.select({ count: count() })
				.from(movies)
				.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
				.where(where)
				.get();
			total = countResult?.count ?? 0;
		} else {
			data = this.database.db
				.select(selectFields)
				.from(movies)
				.leftJoin(userRatings, ratingJoinCond)
				.leftJoin(userWatchHistory, historyJoinCond)
				.where(where)
				.orderBy(orderBy)
				.limit(pageSize)
				.offset(offset)
				.all();

			const countResult = this.database.db
				.select({ count: count() })
				.from(movies)
				.where(where)
				.get();
			total = countResult?.count ?? 0;
		}

		return {
			movies: data.map((row) => {
				const position = row.watchCompleted ? 0 : (row.watchPosition ?? 0);
				return this.applyPosterFallback({
					...row,
					rating: row.rating ?? 0,
					watchPosition: position,
					durationSeconds: row.durationSeconds ?? 0,
					watchCompleted: undefined,
				});
			}),
			total,
			page,
			pageSize,
			totalPages: Math.ceil(total / pageSize),
		};
	}

	findById(id: string, userId?: string) {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!movie) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		const metadata = this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, id))
			.get();

		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, id))
			.all();

		// Check watchlist status, user rating, and watch position if userId provided
		let inWatchlist = false;
		let userRating = 0;
		let watchPosition = 0;
		let durationSeconds = 0;
		if (userId) {
			const watchlistEntry = this.database.db
				.select()
				.from(userWatchlist)
				.where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.movieId, id)))
				.get();
			inWatchlist = !!watchlistEntry;

			const ratingEntry = this.database.db
				.select()
				.from(userRatings)
				.where(and(eq(userRatings.userId, userId), eq(userRatings.movieId, id)))
				.get();
			userRating = ratingEntry?.rating ?? 0;

			const historyEntry = this.database.db
				.select()
				.from(userWatchHistory)
				.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, id)))
				.get();
			if (historyEntry) {
				watchPosition = historyEntry.completed ? 0 : (historyEntry.positionSeconds ?? 0);
			}
		}

		// Get duration and file info from movie file
		const firstFile = files[0];
		if (firstFile) {
			durationSeconds = firstFile.durationSeconds ?? 0;
		}

		const parseJson = (val: string | null | undefined): any[] => {
			if (!val) return [];
			try {
				const parsed = JSON.parse(val);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		};

		const fileInfo = firstFile
			? {
					containerFormat: firstFile.containerFormat,
					codecVideo: firstFile.codecVideo,
					codecAudio: firstFile.codecAudio,
					resolution: firstFile.resolution,
					videoWidth: firstFile.videoWidth,
					videoHeight: firstFile.videoHeight,
					videoBitDepth: firstFile.videoBitDepth,
					videoFrameRate: firstFile.videoFrameRate,
					videoProfile: firstFile.videoProfile,
					videoColorSpace: firstFile.videoColorSpace,
					hdr: firstFile.hdr,
					bitrate: firstFile.bitrate,
					fileSize: firstFile.fileSize,
					fileName: firstFile.fileName,
					audioTracks: parseJson(firstFile.audioTracks),
					subtitleTracks: parseJson(firstFile.subtitleTracks),
				}
			: null;

		const activeJobs = this.jobManager.findJobsByPayload('movieId', id, 'pre-transcode', [
			'pending',
			'running',
		]);
		const status = activeJobs.length > 0 ? 'processing' : 'idle';

		return {
			...this.flattenMovie(movie, metadata, inWatchlist, userRating),
			status,
			watchPosition,
			durationSeconds,
			fileInfo,
		};
	}

	/**
	 * Flatten a movie row + metadata into the shape the client expects.
	 */
	private flattenMovie(movie: any, metadata: any, inWatchlist = false, userRating = 0) {
		const parseJson = (val: string | null | undefined): any[] => {
			if (!val) return [];
			try {
				const parsed = JSON.parse(val);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		};

		// Use thumbnailUrl as poster fallback when no TMDB poster is set
		const posterUrl = movie.posterUrl || movie.thumbnailUrl || '';
		const thumbnailUrl = movie.thumbnailUrl || '';

		return {
			id: movie.id,
			title: movie.title,
			year: movie.year ?? 0,
			overview: movie.overview ?? '',
			posterUrl,
			thumbnailUrl,
			backdropUrl: movie.backdropUrl ?? '',
			runtime: movie.runtimeMinutes ?? 0,
			imdbId: movie.imdbId ?? undefined,
			tmdbId: movie.tmdbId ?? undefined,
			hidden: movie.hidden ?? false,
			addedAt: movie.addedAt ?? '',
			genres: parseJson(metadata?.genres),
			cast: parseJson(metadata?.cast),
			director: (() => {
				const directors = parseJson(metadata?.directors);
				return directors.length > 0
					? typeof directors[0] === 'string'
						? directors[0]
						: (directors[0]?.name ?? '')
					: undefined;
			})(),
			imdbRating: metadata?.imdbRating ?? undefined,
			rtRating: metadata?.rottenTomatoesScore ?? undefined,
			metacriticRating: metadata?.metacriticScore ?? undefined,
			rating: userRating,
			inWatchlist,
		};
	}

	findRecent(limit: number = 20) {
		return this.database.db
			.select()
			.from(movies)
			.orderBy(desc(movies.addedAt))
			.limit(limit)
			.all()
			.map(this.applyPosterFallback);
	}

	search(q: string) {
		return this.database.db
			.select()
			.from(movies)
			.where(like(movies.title, `%${q}%`))
			.orderBy(asc(movies.title))
			.limit(50)
			.all()
			.map(this.applyPosterFallback);
	}

	/**
	 * For list views, fall back to thumbnailUrl when posterUrl is empty.
	 */
	private applyPosterFallback<
		T extends { posterUrl?: string | null; thumbnailUrl?: string | null },
	>(movie: T): T {
		if (!movie.posterUrl && movie.thumbnailUrl) {
			return { ...movie, posterUrl: movie.thumbnailUrl };
		}
		return movie;
	}

	update(
		id: string,
		data: Partial<{
			title: string;
			year: number;
			overview: string;
			posterUrl: string;
			backdropUrl: string;
			imdbId: string;
			tmdbId: number;
			runtimeMinutes: number;
			contentRating: string;
			tagline: string;
			releaseDate: string;
			language: string;
			country: string;
			trailerUrl: string;
			hidden: boolean;
		}>,
	) {
		const existing = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!existing) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		this.database.db
			.update(movies)
			.set({ ...data, updatedAt: nowISO() })
			.where(eq(movies.id, id))
			.run();

		return this.findById(id);
	}

	remove(id: string) {
		const existing = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!existing) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		this.database.db.delete(movies).where(eq(movies.id, id)).run();
		this.logger.log(`Deleted movie: ${existing.title}`);
	}

	async deleteFromDisk(id: string, deleteEnclosingFolder: boolean): Promise<void> {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!movie) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, id))
			.all();

		// Safety: prevent deleting a library source root
		if (deleteEnclosingFolder) {
			const sources = this.libraryService.getSources();
			const sourcePaths = sources.map((s) => path.resolve(s.path));

			for (const file of files) {
				const dir = path.resolve(path.dirname(file.filePath));
				if (sourcePaths.includes(dir)) {
					throw new BadRequestException(
						`Cannot delete enclosing folder "${dir}" because it is a library source path`,
					);
				}
			}
		}

		// Delete files and caches
		for (const file of files) {
			await rm(file.filePath, { force: true });
			if (deleteEnclosingFolder) {
				await rm(path.dirname(file.filePath), { recursive: true, force: true });
			}
			await this.transcoderService.clearCache(file.id);
			await this.subtitleService.clearCache(file.id);
		}

		this.thumbnailService.clearForMovie(id);
		await this.imageService.clearForMovie(id);

		// Remove DB row (cascades handle FK tables)
		this.remove(id);

		this.logger.log(`Deleted movie from disk: ${movie.title}`);
	}

	getGenres(): string[] {
		const rows = this.database.db
			.select({ genres: movieMetadata.genres })
			.from(movieMetadata)
			.all();

		const genreSet = new Set<string>();
		for (const row of rows) {
			if (row.genres) {
				try {
					const parsed = JSON.parse(row.genres);
					if (Array.isArray(parsed)) {
						for (const g of parsed) {
							if (typeof g === 'string' && g.trim()) genreSet.add(g.trim());
						}
					}
				} catch {
					// skip malformed
				}
			}
		}

		return Array.from(genreSet).sort();
	}

	bulkAction(
		action: string,
		movieIds: string[],
		_userId: string,
		_extra?: { playlistId?: string },
	) {
		const results = { processed: 0, errors: [] as string[] };

		for (const movieId of movieIds) {
			try {
				switch (action) {
					case 'delete':
						this.remove(movieId);
						break;
					default:
						// Other bulk actions (mark_watched, add_to_playlist, refresh_metadata)
						// are delegated from the controller to the appropriate service
						break;
				}
				results.processed++;
			} catch (err: any) {
				results.errors.push(`${movieId}: ${err.message}`);
			}
		}

		return results;
	}
}
