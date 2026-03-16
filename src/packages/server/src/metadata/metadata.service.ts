import { nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CacheService } from '../cache/cache.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { OmdbProvider, OmdbSearchResult } from './providers/omdb.provider.js';
import { TmdbProvider } from './providers/tmdb.provider.js';

@Injectable()
export class MetadataService {
	private readonly logger = new Logger('MetadataService');

	constructor(
		private readonly database: DatabaseService,
		private readonly tmdb: TmdbProvider,
		private readonly omdb: OmdbProvider,
		private readonly cache: CacheService,
		private readonly events: EventsService,
	) {}

	async fetchForMovie(movieId: string): Promise<any> {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();

		if (!movie) {
			throw new NotFoundException(`Movie ${movieId} not found`);
		}

		const title = movie.title;
		const year = movie.year ?? undefined;

		// Get file duration for confidence matching
		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();
		const fileDurationSeconds = file?.durationSeconds ?? undefined;

		// Step 1: Parallel search — TMDB + OMDB
		const [tmdbResult, omdbResult] = await Promise.allSettled([
			this.tmdb.searchMovie(title, year),
			this.omdb.searchByTitle(title, year),
		]);

		const tmdbSearchResults = tmdbResult.status === 'fulfilled' ? tmdbResult.value : null;
		const omdbData: OmdbSearchResult | null =
			omdbResult.status === 'fulfilled' ? omdbResult.value : null;

		if (tmdbResult.status === 'rejected') {
			this.logger.warn(`TMDB search failed: ${tmdbResult.reason}`);
		}
		if (omdbResult.status === 'rejected') {
			this.logger.warn(`OMDB search failed: ${omdbResult.reason}`);
		}

		// Step 2: Confidence matching for TMDB results
		let bestTmdbMatch: NonNullable<typeof tmdbSearchResults>[number] | null = null;
		let bestConfidence = 0;

		if (tmdbSearchResults && tmdbSearchResults.length > 0) {
			for (const candidate of tmdbSearchResults) {
				const candidateYear = candidate.release_date
					? parseInt(candidate.release_date.slice(0, 4), 10)
					: undefined;
				const score = this.computeConfidence(
					title,
					year,
					fileDurationSeconds,
					candidate.title,
					candidateYear,
					undefined, // TMDB search results don't include runtime
				);
				if (score > bestConfidence) {
					bestConfidence = score;
					bestTmdbMatch = candidate;
				}
			}

			if (bestConfidence < 40) {
				this.logger.warn(
					`Best TMDB match for "${title}" scored ${bestConfidence} (below threshold 40), skipping TMDB`,
				);
				bestTmdbMatch = null;
			}
		}

		// If neither found anything, return null
		if (!bestTmdbMatch && !omdbData) {
			this.logger.warn(`No results from TMDB or OMDB for "${title}" (${year})`);
			return null;
		}

		const now = nowISO();

		// Step 3: Fetch TMDB details if we have a confident match
		let details: Awaited<ReturnType<TmdbProvider['getMovieDetails']>> = null;
		if (bestTmdbMatch) {
			details = await this.tmdb.getMovieDetails(bestTmdbMatch.id);
			if (!details) {
				this.logger.warn(`Could not fetch TMDB details for ${bestTmdbMatch.id}`);
			}
		}

		// If TMDB details fetch failed and no OMDB data, return null
		if (!details && !omdbData) {
			return null;
		}

		// Step 4: If we have TMDB details but no OMDB data yet, try OMDB by IMDB ID
		let omdbSupplementary: Awaited<ReturnType<OmdbProvider['getByImdbId']>> = null;
		if (details?.imdb_id && !omdbData) {
			omdbSupplementary = await this.omdb.getByImdbId(details.imdb_id);
			if (omdbSupplementary) {
				this.logger.log(`Supplementing with OMDB data via IMDB ID ${details.imdb_id}`);
			}
		}

		// Step 5: Determine authoritative IDs
		// OMDB imdbId takes precedence over TMDB's imdb_id
		const imdbId = omdbData?.imdbId ?? details?.imdb_id ?? null;
		const tmdbId = details?.id ?? null;

		// Step 6: Update movies table
		const trailerVideo = details?.videos?.results?.find(
			(v) => v.site === 'YouTube' && v.type === 'Trailer',
		);
		const trailerUrl = trailerVideo
			? `https://www.youtube.com/watch?v=${trailerVideo.key}`
			: null;

		const movieUpdate: Record<string, unknown> = {
			tmdbId,
			imdbId,
			updatedAt: now,
		};

		if (details) {
			movieUpdate.overview = details.overview || (omdbData?.plot ?? null);
			movieUpdate.tagline = details.tagline || null;
			movieUpdate.originalTitle =
				details.original_title !== details.title ? details.original_title : null;
			movieUpdate.runtimeMinutes = details.runtime || (omdbData?.runtimeMinutes ?? null);
			movieUpdate.releaseDate = details.release_date || null;
			movieUpdate.language = details.spoken_languages?.[0]?.iso_639_1 ?? null;
			movieUpdate.country = details.production_countries?.[0]?.iso_3166_1 ?? null;
			movieUpdate.posterUrl = this.tmdb.getImageUrl(details.poster_path);
			movieUpdate.backdropUrl = this.tmdb.getImageUrl(details.backdrop_path, 'w1280');
			movieUpdate.trailerUrl = trailerUrl;
			movieUpdate.year = details.release_date
				? parseInt(details.release_date.slice(0, 4), 10)
				: movie.year;

			// Content rating from TMDB release_dates (US certification) or OMDB Rated
			const usRelease = details.release_dates?.results?.find((r) => r.iso_3166_1 === 'US');
			const certification = usRelease?.release_dates
				?.map((rd) => rd.certification)
				.find((c) => c && c.length > 0);
			movieUpdate.contentRating =
				certification || omdbData?.rated || omdbSupplementary?.rated || null;
		} else if (omdbData) {
			// OMDB-only path
			movieUpdate.overview = omdbData.plot;
			movieUpdate.runtimeMinutes = omdbData.runtimeMinutes;
			movieUpdate.contentRating = omdbData.rated;
			if (omdbData.year) movieUpdate.year = omdbData.year;
		}

		this.database.db.update(movies).set(movieUpdate).where(eq(movies.id, movieId)).run();

		// Step 7: Create/update movie_metadata
		const genres = details
			? JSON.stringify(details.genres.map((g) => g.name))
			: omdbData?.genre
				? JSON.stringify(omdbData.genre.split(', '))
				: JSON.stringify([]);

		const castMembers = details
			? JSON.stringify(
					(details.credits?.cast ?? []).slice(0, 20).map((c) => ({
						name: c.name,
						character: c.character,
						profileUrl: this.tmdb.getImageUrl(c.profile_path, 'w185'),
						tmdbId: c.id,
					})),
				)
			: JSON.stringify([]);

		const directors = details
			? JSON.stringify(
					(details.credits?.crew ?? [])
						.filter((c) => c.job === 'Director')
						.map((c) => c.name),
				)
			: omdbData?.director
				? JSON.stringify(omdbData.director.split(', '))
				: JSON.stringify([]);

		const writers = details
			? JSON.stringify(
					(details.credits?.crew ?? [])
						.filter((c) => c.department === 'Writing')
						.map((c) => c.name),
				)
			: omdbData?.writer
				? JSON.stringify(omdbData.writer.split(', '))
				: JSON.stringify([]);

		const keywords = details?.keywords?.keywords
			? JSON.stringify(details.keywords.keywords.map((k) => k.name))
			: JSON.stringify([]);
		const productionCompanies = details
			? JSON.stringify(details.production_companies.map((c) => c.name))
			: JSON.stringify([]);

		// Get OMDB ratings — either from title search or by IMDB ID lookup
		const omdbRatingsSource = omdbData ?? omdbSupplementary;
		const imdbRating = omdbRatingsSource?.imdbRating ?? null;
		const imdbVotes = omdbRatingsSource?.imdbVotes ?? null;
		const rottenTomatoesScore = omdbRatingsSource?.rottenTomatoesScore ?? null;
		const metacriticScore = omdbRatingsSource?.metacriticScore ?? null;

		const existingMeta = this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();

		const metaValues = {
			movieId,
			genres,
			cast: castMembers,
			directors,
			writers,
			keywords,
			productionCompanies,
			budget: details?.budget || null,
			revenue: details?.revenue || null,
			tmdbRating: details?.vote_average || null,
			tmdbVotes: details?.vote_count || null,
			imdbRating,
			imdbVotes,
			rottenTomatoesScore,
			metacriticScore,
			source: details && omdbData ? 'tmdb+omdb' : details ? 'tmdb' : 'omdb',
			fetchedAt: now,
			updatedAt: now,
		};

		if (existingMeta) {
			this.database.db
				.update(movieMetadata)
				.set(metaValues)
				.where(eq(movieMetadata.id, existingMeta.id))
				.run();
		} else {
			this.database.db
				.insert(movieMetadata)
				.values({
					id: crypto.randomUUID(),
					...metaValues,
				})
				.run();
		}

		const sources = [details ? 'TMDB' : null, omdbData ? 'OMDB' : null]
			.filter(Boolean)
			.join('+');
		this.logger.log(
			`Metadata fetched for "${movie.title}" (${sources}, confidence: ${bestConfidence})`,
		);

		// Emit WebSocket event
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'metadata-refresh' });

		return this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
	}

	async refreshMetadata(movieId: string) {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();

		if (!movie) {
			throw new NotFoundException(`Movie ${movieId} not found`);
		}

		// Clear TMDB cache
		if (movie.tmdbId) {
			await this.cache.delete('metadata', `details:${movie.tmdbId}`);
		}
		await this.cache.delete('metadata', `search:${movie.title}:${movie.year ?? ''}`);

		// Clear OMDB cache
		await this.cache.delete('metadata', `omdb:${movie.imdbId ?? ''}`);
		await this.cache.delete('metadata', `omdb:search:${movie.title}:${movie.year ?? ''}`);

		return this.fetchForMovie(movieId);
	}

	async bulkFetch(movieIds: string[], concurrency: number = 3) {
		const results: { movieId: string; success: boolean; error?: string }[] = [];

		for (let i = 0; i < movieIds.length; i += concurrency) {
			const batch = movieIds.slice(i, i + concurrency);
			const batchResults = await Promise.allSettled(
				batch.map(async (movieId) => {
					await this.fetchForMovie(movieId);
					return { movieId, success: true };
				}),
			);

			for (const result of batchResults) {
				if (result.status === 'fulfilled') {
					results.push(result.value);
				} else {
					results.push({
						movieId: batch[batchResults.indexOf(result)] ?? 'unknown',
						success: false,
						error: result.reason?.message ?? 'Unknown error',
					});
				}
			}
		}

		return results;
	}

	/**
	 * Compute confidence score for a candidate match.
	 * - Title similarity: 0-40 points
	 * - Year match: 0-30 points
	 * - Duration match: 0-25 points
	 */
	private computeConfidence(
		searchTitle: string,
		searchYear: number | undefined,
		fileDurationSeconds: number | undefined,
		candidateTitle: string,
		candidateYear: number | undefined,
		candidateRuntimeMinutes: number | undefined,
	): number {
		let score = 0;

		// Title similarity (0-40 points)
		const normSearch = this.normalizeTitle(searchTitle);
		const normCandidate = this.normalizeTitle(candidateTitle);
		if (normSearch === normCandidate) {
			score += 40;
		} else if (normSearch.includes(normCandidate) || normCandidate.includes(normSearch)) {
			score += 25;
		} else {
			// Simple character overlap ratio
			const longer = normSearch.length > normCandidate.length ? normSearch : normCandidate;
			const shorter = normSearch.length > normCandidate.length ? normCandidate : normSearch;
			if (longer.length > 0) {
				let matches = 0;
				const longerChars = longer.split('');
				const shorterChars = shorter.split('');
				for (const ch of shorterChars) {
					const idx = longerChars.indexOf(ch);
					if (idx !== -1) {
						matches++;
						longerChars.splice(idx, 1);
					}
				}
				const ratio = matches / longer.length;
				score += Math.round(ratio * 40);
			}
		}

		// Year match (0-30 points)
		if (searchYear && candidateYear) {
			const diff = Math.abs(searchYear - candidateYear);
			if (diff === 0) score += 30;
			else if (diff === 1) score += 15;
			else if (diff === 2) score += 5;
		}

		// Duration match (0-25 points)
		if (fileDurationSeconds && candidateRuntimeMinutes) {
			const fileMins = fileDurationSeconds / 60;
			const diff = Math.abs(fileMins - candidateRuntimeMinutes);
			if (diff <= 5) score += 25;
			else if (diff <= 10) score += 10;
		}

		return score;
	}

	/**
	 * Normalize a title for comparison: lowercase, strip articles, remove punctuation.
	 */
	private normalizeTitle(title: string): string {
		return title
			.toLowerCase()
			.replace(/^(the|a|an)\s+/i, '')
			.replace(/[^\w\s]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}
}
