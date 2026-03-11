import { CACHE_NAMESPACES, nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { CacheService } from '../cache/cache.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieMetadata, movies, userRatings, userWatchHistory } from '../database/schema/index.js';

export interface TasteProfile {
	userId: string;
	favoriteGenres: { name: string; weight: number }[];
	favoriteDirectors: { name: string; weight: number }[];
	favoriteActors: { name: string; weight: number }[];
	preferredDecades: { decade: number; weight: number }[];
	averageRating: number;
	totalRated: number;
	totalWatched: number;
	updatedAt: string;
}

const PROFILE_CACHE_TTL = 6 * 60 * 60; // 6 hours in seconds

@Injectable()
export class TasteProfileService {
	private readonly logger = new Logger(TasteProfileService.name);

	constructor(
		private readonly database: DatabaseService,
		private readonly cache: CacheService,
	) {}

	/**
	 * Build a comprehensive taste profile for a user based on their
	 * ratings and watch history.
	 */
	async buildProfile(userId: string): Promise<TasteProfile> {
		const cacheKey = `profile:${userId}`;
		const cached = await this.cache.get<TasteProfile>(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
		);
		if (cached) {
			return cached;
		}

		this.logger.log(`Building taste profile for user ${userId}`);

		// 1. Get all user ratings joined with movie data and metadata
		const ratingsWithMovies = await this.database.db
			.select({
				rating: userRatings.rating,
				movieId: userRatings.movieId,
				title: movies.title,
				year: movies.year,
				metaGenres: movieMetadata.genres,
				metaDirectors: movieMetadata.directors,
				metaCast: movieMetadata.cast,
			})
			.from(userRatings)
			.innerJoin(movies, eq(movies.id, userRatings.movieId))
			.leftJoin(movieMetadata, eq(movieMetadata.movieId, userRatings.movieId))
			.where(eq(userRatings.userId, userId))
			.orderBy(desc(userRatings.rating))
			.all();

		// 2. Get user watch history
		const watchHistory = await this.database.db
			.select({
				movieId: userWatchHistory.movieId,
				title: movies.title,
				year: movies.year,
				metaGenres: movieMetadata.genres,
				metaDirectors: movieMetadata.directors,
				metaCast: movieMetadata.cast,
			})
			.from(userWatchHistory)
			.innerJoin(movies, eq(movies.id, userWatchHistory.movieId))
			.leftJoin(movieMetadata, eq(movieMetadata.movieId, userWatchHistory.movieId))
			.where(eq(userWatchHistory.userId, userId))
			.all();

		// 3. Analyze patterns
		const genreWeights = new Map<string, number>();
		const directorWeights = new Map<string, number>();
		const actorWeights = new Map<string, number>();
		const decadeWeights = new Map<number, number>();
		let ratingSum = 0;

		// Process rated movies (weighted by rating)
		for (const row of ratingsWithMovies) {
			const ratingWeight = row.rating / 10; // Normalize 0-10 to 0-1

			// Genres
			const genres = this.parseJsonColumn(row.metaGenres);
			for (const genre of genres) {
				const current = genreWeights.get(genre) || 0;
				genreWeights.set(genre, current + ratingWeight);
			}

			// Directors
			const directors = this.parseJsonColumn(row.metaDirectors);
			for (const director of directors) {
				const current = directorWeights.get(director) || 0;
				directorWeights.set(director, current + ratingWeight);
			}

			// Actors
			const cast = this.parseJsonColumn(row.metaCast);
			for (const actor of cast) {
				const current = actorWeights.get(actor) || 0;
				actorWeights.set(actor, current + ratingWeight);
			}

			// Decades
			if (row.year) {
				const decade = Math.floor(row.year / 10) * 10;
				const current = decadeWeights.get(decade) || 0;
				decadeWeights.set(decade, current + ratingWeight);
			}

			ratingSum += row.rating;
		}

		// Also incorporate watch history (with lower weight for unrated watches)
		const ratedMovieIds = new Set(ratingsWithMovies.map((r) => r.movieId));
		for (const row of watchHistory) {
			if (ratedMovieIds.has(row.movieId)) continue; // Already counted via rating

			const watchWeight = 0.5; // Base weight for watched-but-not-rated

			const genres = this.parseJsonColumn(row.metaGenres);
			for (const genre of genres) {
				const current = genreWeights.get(genre) || 0;
				genreWeights.set(genre, current + watchWeight);
			}

			const directors = this.parseJsonColumn(row.metaDirectors);
			for (const director of directors) {
				const current = directorWeights.get(director) || 0;
				directorWeights.set(director, current + watchWeight);
			}

			const cast = this.parseJsonColumn(row.metaCast);
			for (const actor of cast) {
				const current = actorWeights.get(actor) || 0;
				actorWeights.set(actor, current + watchWeight);
			}

			if (row.year) {
				const decade = Math.floor(row.year / 10) * 10;
				const current = decadeWeights.get(decade) || 0;
				decadeWeights.set(decade, current + watchWeight);
			}
		}

		// Normalize and sort all weight maps
		const favoriteGenres = this.normalizeAndSort(genreWeights);
		const favoriteDirectors = this.normalizeAndSort(directorWeights);
		const favoriteActors = this.normalizeAndSort(actorWeights);
		const preferredDecades = this.normalizeDecadesAndSort(decadeWeights);

		const totalRated = ratingsWithMovies.length;
		const averageRating = totalRated > 0 ? ratingSum / totalRated : 0;
		const totalWatched = new Set([
			...ratingsWithMovies.map((r) => r.movieId),
			...watchHistory.map((w) => w.movieId),
		]).size;

		const profile: TasteProfile = {
			userId,
			favoriteGenres,
			favoriteDirectors: favoriteDirectors.slice(0, 20),
			favoriteActors: favoriteActors.slice(0, 30),
			preferredDecades,
			averageRating: Math.round(averageRating * 100) / 100,
			totalRated,
			totalWatched,
			updatedAt: nowISO(),
		};

		// Cache the profile
		await this.cache.set(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
			profile,
			PROFILE_CACHE_TTL,
		);

		this.logger.log(
			`Built taste profile for user ${userId}: ${totalRated} rated, ${totalWatched} watched`,
		);

		return profile;
	}

	/**
	 * Parse a JSON text column (genres, directors, cast) into a string array.
	 * Returns empty array on failure.
	 */
	private parseJsonColumn(value: string | null | undefined): string[] {
		if (!value) return [];
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	/**
	 * Normalize weights to 0-1 range and sort descending.
	 */
	private normalizeAndSort(weights: Map<string, number>): { name: string; weight: number }[] {
		if (weights.size === 0) return [];

		const maxWeight = Math.max(...weights.values());
		if (maxWeight === 0) return [];

		return Array.from(weights.entries())
			.map(([key, value]) => ({
				name: key,
				weight: Math.round((value / maxWeight) * 1000) / 1000,
			}))
			.sort((a, b) => b.weight - a.weight);
	}

	/**
	 * Normalize decade weights and sort descending.
	 */
	private normalizeDecadesAndSort(
		weights: Map<number, number>,
	): { decade: number; weight: number }[] {
		if (weights.size === 0) return [];

		const maxWeight = Math.max(...weights.values());
		if (maxWeight === 0) return [];

		return Array.from(weights.entries())
			.map(([decade, value]) => ({
				decade,
				weight: Math.round((value / maxWeight) * 1000) / 1000,
			}))
			.sort((a, b) => b.weight - a.weight);
	}
}
