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

const PROFILE_CACHE_TTL = 6 * 60 * 60;

/**
 * Builds a per-user taste profile from ratings + watch history. Used
 * as one input to the personalized recommendation flow (alongside the
 * strategy pipeline). Kept focused — its job is only to produce the
 * profile object; the orchestrator decides how to combine it with
 * content / external strategies.
 */
@Injectable()
export class TasteProfileService {
	private readonly logger = new Logger('TasteProfile');

	constructor(
		private readonly database: DatabaseService,
		private readonly cache: CacheService,
	) {}

	async buildProfile(userId: string): Promise<TasteProfile> {
		const cacheKey = `profile:${userId}`;
		const cached = await this.cache.get<TasteProfile>(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
		);
		if (cached) return cached;

		const ratings = this.database.db
			.select({
				rating: userRatings.rating,
				movieId: userRatings.movieId,
				year: movies.year,
				genres: movieMetadata.genres,
				directors: movieMetadata.directors,
				cast: movieMetadata.cast,
			})
			.from(userRatings)
			.innerJoin(movies, eq(movies.id, userRatings.movieId))
			.leftJoin(movieMetadata, eq(movieMetadata.movieId, userRatings.movieId))
			.where(eq(userRatings.userId, userId))
			.orderBy(desc(userRatings.rating))
			.all();

		const history = this.database.db
			.select({
				movieId: userWatchHistory.movieId,
				year: movies.year,
				genres: movieMetadata.genres,
				directors: movieMetadata.directors,
				cast: movieMetadata.cast,
			})
			.from(userWatchHistory)
			.innerJoin(movies, eq(movies.id, userWatchHistory.movieId))
			.leftJoin(movieMetadata, eq(movieMetadata.movieId, userWatchHistory.movieId))
			.where(eq(userWatchHistory.userId, userId))
			.all();

		const genres = new Map<string, number>();
		const directors = new Map<string, number>();
		const actors = new Map<string, number>();
		const decades = new Map<number, number>();
		let ratingSum = 0;

		for (const row of ratings) {
			const w = row.rating / 10;
			ratingSum += row.rating;
			accumulate(genres, parseArr(row.genres), w);
			accumulate(directors, parseArr(row.directors), w);
			accumulate(actors, parseArr(row.cast), w);
			if (row.year)
				decades.set(decadeOf(row.year), (decades.get(decadeOf(row.year)) ?? 0) + w);
		}

		const ratedIds = new Set(ratings.map((r) => r.movieId));
		for (const row of history) {
			if (ratedIds.has(row.movieId)) continue;
			const w = 0.5;
			accumulate(genres, parseArr(row.genres), w);
			accumulate(directors, parseArr(row.directors), w);
			accumulate(actors, parseArr(row.cast), w);
			if (row.year)
				decades.set(decadeOf(row.year), (decades.get(decadeOf(row.year)) ?? 0) + w);
		}

		const totalRated = ratings.length;
		const totalWatched = new Set([
			...ratings.map((r) => r.movieId),
			...history.map((h) => h.movieId),
		]).size;
		const averageRating = totalRated > 0 ? ratingSum / totalRated : 0;

		const profile: TasteProfile = {
			userId,
			favoriteGenres: rank(genres),
			favoriteDirectors: rank(directors).slice(0, 20),
			favoriteActors: rank(actors).slice(0, 30),
			preferredDecades: rankDecades(decades),
			averageRating: Math.round(averageRating * 100) / 100,
			totalRated,
			totalWatched,
			updatedAt: nowISO(),
		};

		await this.cache.set(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
			profile,
			PROFILE_CACHE_TTL,
		);
		this.logger.log(
			`Built taste profile for ${userId}: ${totalRated} rated, ${totalWatched} watched`,
		);
		return profile;
	}

	invalidate(userId: string): void {
		void this.cache.delete(CACHE_NAMESPACES.RECOMMENDATIONS, `profile:${userId}`);
	}
}

/**
 * Some `movie_metadata` JSON columns store objects rather than bare
 * strings — notably `cast` is `{name, character, profileUrl, tmdbId}[]`.
 * This helper accepts either shape and returns clean string names, so
 * downstream Map keys / Set membership work consistently. Anything
 * with no extractable string name is dropped.
 */
function parseArr(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		const out: string[] = [];
		for (const item of parsed) {
			if (typeof item === 'string') {
				if (item.trim()) out.push(item);
			} else if (item && typeof item === 'object') {
				const name = (item as { name?: unknown }).name;
				if (typeof name === 'string' && name.trim()) out.push(name);
			}
		}
		return out;
	} catch {
		return [];
	}
}

function accumulate(map: Map<string, number>, items: string[], weight: number): void {
	for (const item of items) {
		if (!item) continue;
		map.set(item, (map.get(item) ?? 0) + weight);
	}
}

function decadeOf(year: number): number {
	return Math.floor(year / 10) * 10;
}

function rank(map: Map<string, number>): { name: string; weight: number }[] {
	if (map.size === 0) return [];
	const max = Math.max(...map.values());
	if (max === 0) return [];
	return Array.from(map.entries())
		.map(([name, value]) => ({ name, weight: Math.round((value / max) * 1000) / 1000 }))
		.sort((a, b) => b.weight - a.weight);
}

function rankDecades(map: Map<number, number>): { decade: number; weight: number }[] {
	if (map.size === 0) return [];
	const max = Math.max(...map.values());
	if (max === 0) return [];
	return Array.from(map.entries())
		.map(([decade, value]) => ({ decade, weight: Math.round((value / max) * 1000) / 1000 }))
		.sort((a, b) => b.weight - a.weight);
}
