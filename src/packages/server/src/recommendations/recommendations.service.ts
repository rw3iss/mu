import { Injectable, Logger } from '@nestjs/common';
import { eq, desc, and, sql, gt, inArray } from 'drizzle-orm';
import { nowISO, CACHE_NAMESPACES } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { TasteProfileService, TasteProfile } from './taste-profile.service.js';
import {
  movies,
  movieMetadata,
  userRatings,
  userWatchHistory,
  userWatchlist,
} from '../database/schema/index.js';

export interface ScoredMovie {
  movieId: string;
  title: string;
  year: number | null;
  score: number;
  explanation: string[];
  posterUrl?: string | null;
}

const RECOMMENDATIONS_CACHE_TTL = 60 * 60; // 1 hour in seconds

// Scoring weights
const WEIGHT_GENRE = 0.4;
const WEIGHT_PEOPLE = 0.25;
const WEIGHT_YEAR = 0.1;
const WEIGHT_RATING_SIMILARITY = 0.15;
const WEIGHT_POPULARITY = 0.1;

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly cache: CacheService,
    private readonly tasteProfile: TasteProfileService,
  ) {}

  /**
   * Get personalized movie recommendations for a user.
   * Uses a content-based scoring algorithm weighted across
   * genre, director/actor, year, rating similarity, and popularity.
   */
  async getRecommendations(
    userId: string,
    limit: number = 24,
  ): Promise<ScoredMovie[]> {
    const cacheKey = `recs:${userId}:${limit}`;
    const cached = await this.cache.get<ScoredMovie[]>(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    this.logger.log(`Generating recommendations for user ${userId}`);

    // 1. Build the user's taste profile
    const profile = await this.tasteProfile.buildProfile(userId);

    // 2. Get movies the user has already rated or watched (to exclude)
    const ratedMovieIds = await this.getUserRatedMovieIds(userId);
    const watchedMovieIds = await this.getUserWatchedMovieIds(userId);
    const excludeIds = new Set([...ratedMovieIds, ...watchedMovieIds]);

    // 3. Get all candidate movies with their metadata
    const candidates = await this.database.db
      .select({
        id: movies.id,
        title: movies.title,
        year: movies.year,
        posterUrl: movies.posterUrl,
        metaGenres: movieMetadata.genres,
        metaDirectors: movieMetadata.directors,
        metaCast: movieMetadata.cast,
        metaRating: movieMetadata.tmdbRating,
      })
      .from(movies)
      .leftJoin(movieMetadata, eq(movieMetadata.movieId, movies.id))
      .all();

    // 4. Score each candidate
    const scored: ScoredMovie[] = [];

    for (const candidate of candidates) {
      if (excludeIds.has(candidate.id)) continue;

      const { score, explanation } = this.scoreMovie(candidate, profile);

      if (score > 0) {
        scored.push({
          movieId: candidate.id,
          title: candidate.title,
          year: candidate.year,
          score: Math.round(score * 1000) / 1000,
          explanation,
          posterUrl: candidate.posterUrl,
        });
      }
    }

    // 5. Sort by score descending and take top N
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    // 6. Cache results
    await this.cache.set(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
      results,
      RECOMMENDATIONS_CACHE_TTL,
    );

    this.logger.log(
      `Generated ${results.length} recommendations for user ${userId}`,
    );

    return results;
  }

  /**
   * Find movies similar to a given movie based on shared genres,
   * directors, and cast members.
   */
  async getSimilarMovies(
    movieId: string,
    limit: number = 24,
  ): Promise<ScoredMovie[]> {
    const cacheKey = `similar:${movieId}:${limit}`;
    const cached = await this.cache.get<ScoredMovie[]>(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    // 1. Get the source movie's metadata
    const sourceMetadata = await this.database.db
      .select({
        movieId: movieMetadata.movieId,
        genres: movieMetadata.genres,
        directors: movieMetadata.directors,
        cast: movieMetadata.cast,
      })
      .from(movieMetadata)
      .where(eq(movieMetadata.movieId, movieId))
      .get();

    if (!sourceMetadata) {
      return [];
    }

    const sourceGenres = this.parseJsonColumn(sourceMetadata.genres);
    const sourceDirectors = this.parseJsonColumn(sourceMetadata.directors);
    const sourceCast = this.parseJsonColumn(sourceMetadata.cast);

    const sourceGenreSet = new Set(sourceGenres);
    const sourceDirectorSet = new Set(sourceDirectors);
    const sourceCastSet = new Set(sourceCast);

    // 2. Get all other movies with metadata
    const candidates = await this.database.db
      .select({
        id: movies.id,
        title: movies.title,
        year: movies.year,
        posterUrl: movies.posterUrl,
        metaGenres: movieMetadata.genres,
        metaDirectors: movieMetadata.directors,
        metaCast: movieMetadata.cast,
      })
      .from(movies)
      .leftJoin(movieMetadata, eq(movieMetadata.movieId, movies.id))
      .all();

    // 3. Score by overlap
    const scored: ScoredMovie[] = [];

    for (const candidate of candidates) {
      if (candidate.id === movieId) continue;

      const candidateGenres = this.parseJsonColumn(candidate.metaGenres);
      const candidateDirectors = this.parseJsonColumn(candidate.metaDirectors);
      const candidateCast = this.parseJsonColumn(candidate.metaCast);

      const genreOverlap = candidateGenres.filter((g) =>
        sourceGenreSet.has(g),
      ).length;
      const directorOverlap = candidateDirectors.filter((d) =>
        sourceDirectorSet.has(d),
      ).length;
      const castOverlap = candidateCast.filter((a) =>
        sourceCastSet.has(a),
      ).length;

      const totalOverlap = genreOverlap * 3 + directorOverlap * 5 + castOverlap * 2;

      if (totalOverlap === 0) continue;

      const explanation: string[] = [];
      if (genreOverlap > 0) {
        const sharedGenres = candidateGenres.filter((g) =>
          sourceGenreSet.has(g),
        );
        explanation.push(`Shared genres: ${sharedGenres.join(', ')}`);
      }
      if (directorOverlap > 0) {
        const sharedDirectors = candidateDirectors.filter((d) =>
          sourceDirectorSet.has(d),
        );
        explanation.push(`Same director: ${sharedDirectors.join(', ')}`);
      }
      if (castOverlap > 0) {
        const sharedCast = candidateCast.filter((a) =>
          sourceCastSet.has(a),
        );
        explanation.push(
          `Shared cast: ${sharedCast.slice(0, 3).join(', ')}`,
        );
      }

      scored.push({
        movieId: candidate.id,
        title: candidate.title,
        year: candidate.year,
        score: totalOverlap,
        explanation,
        posterUrl: candidate.posterUrl,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    await this.cache.set(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
      results,
      RECOMMENDATIONS_CACHE_TTL,
    );

    return results;
  }

  /**
   * Get top movies in a specific genre that the user hasn't seen.
   */
  async getGenreRecommendations(
    genre: string,
    userId: string,
    limit: number = 24,
  ): Promise<ScoredMovie[]> {
    const cacheKey = `genre:${genre}:${userId}:${limit}`;
    const cached = await this.cache.get<ScoredMovie[]>(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    // Get movies the user has already seen
    const ratedMovieIds = await this.getUserRatedMovieIds(userId);
    const watchedMovieIds = await this.getUserWatchedMovieIds(userId);
    const excludeIds = new Set([...ratedMovieIds, ...watchedMovieIds]);

    // Get all movies with metadata
    const candidates = await this.database.db
      .select({
        id: movies.id,
        title: movies.title,
        year: movies.year,
        posterUrl: movies.posterUrl,
        metaGenres: movieMetadata.genres,
        metaRating: movieMetadata.tmdbRating,
      })
      .from(movies)
      .leftJoin(movieMetadata, eq(movieMetadata.movieId, movies.id))
      .all();

    const genreLower = genre.toLowerCase();
    const scored: ScoredMovie[] = [];

    for (const candidate of candidates) {
      if (excludeIds.has(candidate.id)) continue;

      const genres = this.parseJsonColumn(candidate.metaGenres);
      const hasGenre = genres.some((g) => g.toLowerCase() === genreLower);
      if (!hasGenre) continue;

      // Score by vote average (popularity/quality)
      const rating = candidate.metaRating ?? 0;

      scored.push({
        movieId: candidate.id,
        title: candidate.title,
        year: candidate.year,
        score: rating,
        explanation: [`Top rated in ${genre}`],
        posterUrl: candidate.posterUrl,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    await this.cache.set(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
      results,
      RECOMMENDATIONS_CACHE_TTL,
    );

    return results;
  }

  /**
   * Get trending movies based on most watched and rated in the last 30 days.
   */
  async getTrendingMovies(limit: number = 24): Promise<ScoredMovie[]> {
    const cacheKey = `trending:${limit}`;
    const cached = await this.cache.get<ScoredMovie[]>(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Count recent ratings per movie
    const recentRatings = await this.database.db
      .select({
        movieId: userRatings.movieId,
        ratingCount: sql<number>`count(*)`.as('rating_count'),
        avgRating: sql<number>`avg(${userRatings.rating})`.as('avg_rating'),
      })
      .from(userRatings)
      .where(gt(userRatings.createdAt, thirtyDaysAgo))
      .groupBy(userRatings.movieId)
      .all();

    // Count recent watches per movie
    const recentWatches = await this.database.db
      .select({
        movieId: userWatchHistory.movieId,
        watchCount: sql<number>`count(*)`.as('watch_count'),
      })
      .from(userWatchHistory)
      .where(gt(userWatchHistory.watchedAt, thirtyDaysAgo))
      .groupBy(userWatchHistory.movieId)
      .all();

    // Combine into a trending score
    const trendingScores = new Map<
      string,
      { ratingCount: number; avgRating: number; watchCount: number }
    >();

    for (const r of recentRatings) {
      trendingScores.set(r.movieId, {
        ratingCount: r.ratingCount,
        avgRating: r.avgRating,
        watchCount: 0,
      });
    }

    for (const w of recentWatches) {
      const existing = trendingScores.get(w.movieId);
      if (existing) {
        existing.watchCount = w.watchCount;
      } else {
        trendingScores.set(w.movieId, {
          ratingCount: 0,
          avgRating: 0,
          watchCount: w.watchCount,
        });
      }
    }

    if (trendingScores.size === 0) {
      return [];
    }

    // Get movie details for trending movies
    const trendingMovieIds = Array.from(trendingScores.keys());
    const movieDetails = await this.database.db
      .select({
        id: movies.id,
        title: movies.title,
        year: movies.year,
        posterUrl: movies.posterUrl,
      })
      .from(movies)
      .where(inArray(movies.id, trendingMovieIds))
      .all();

    const scored: ScoredMovie[] = [];

    for (const movie of movieDetails) {
      const trending = trendingScores.get(movie.id);
      if (!trending) continue;

      // Trending score: combination of watch count, rating count, and avg rating
      const score =
        trending.watchCount * 2 +
        trending.ratingCount * 3 +
        trending.avgRating;

      const explanation: string[] = [];
      if (trending.watchCount > 0) {
        explanation.push(`Watched ${trending.watchCount} times recently`);
      }
      if (trending.ratingCount > 0) {
        explanation.push(
          `Rated ${trending.ratingCount} times (avg: ${Math.round(trending.avgRating * 10) / 10})`,
        );
      }

      scored.push({
        movieId: movie.id,
        title: movie.title,
        year: movie.year,
        score,
        explanation,
        posterUrl: movie.posterUrl,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    await this.cache.set(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
      results,
      RECOMMENDATIONS_CACHE_TTL,
    );

    return results;
  }

  /**
   * Get recently added movies.
   */
  async getRecentlyAdded(limit: number = 24): Promise<ScoredMovie[]> {
    const cacheKey = `recent:${limit}`;
    const cached = await this.cache.get<ScoredMovie[]>(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const recentMovies = await this.database.db
      .select({
        id: movies.id,
        title: movies.title,
        year: movies.year,
        posterUrl: movies.posterUrl,
        addedAt: movies.addedAt,
      })
      .from(movies)
      .orderBy(desc(movies.addedAt))
      .limit(limit)
      .all();

    const results: ScoredMovie[] = recentMovies.map((movie, index) => ({
      movieId: movie.id,
      title: movie.title,
      year: movie.year,
      score: recentMovies.length - index, // Higher score for more recent
      explanation: [`Added ${movie.addedAt}`],
      posterUrl: movie.posterUrl,
    }));

    await this.cache.set(
      CACHE_NAMESPACES.RECOMMENDATIONS,
      cacheKey,
      results,
      RECOMMENDATIONS_CACHE_TTL,
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Score a candidate movie against the user's taste profile using
   * a weighted sum of content-based signals.
   */
  private scoreMovie(
    candidate: {
      id: string;
      title: string;
      year: number | null;
      metaGenres: string | null;
      metaDirectors: string | null;
      metaCast: string | null;
      metaRating: number | null;
    },
    profile: TasteProfile,
  ): { score: number; explanation: string[] } {
    const explanation: string[] = [];

    const genres = this.parseJsonColumn(candidate.metaGenres);
    const directors = this.parseJsonColumn(candidate.metaDirectors);
    const cast = this.parseJsonColumn(candidate.metaCast);

    // --- Genre overlap (40%) ---
    let genreScore = 0;
    if (genres.length > 0 && profile.favoriteGenres.length > 0) {
      const profileGenreMap = new Map(
        profile.favoriteGenres.map((g) => [g.name.toLowerCase(), g.weight]),
      );
      let genreMatchWeight = 0;
      const matchedGenres: string[] = [];

      for (const genre of genres) {
        const weight = profileGenreMap.get(genre.toLowerCase());
        if (weight !== undefined) {
          genreMatchWeight += weight;
          matchedGenres.push(genre);
        }
      }

      genreScore = Math.min(genreMatchWeight / genres.length, 1);
      if (matchedGenres.length > 0) {
        explanation.push(`Matches your favorite genres: ${matchedGenres.join(', ')}`);
      }
    }

    // --- Director/Actor match (25%) ---
    let peopleScore = 0;
    if (profile.favoriteDirectors.length > 0 || profile.favoriteActors.length > 0) {
      const directorMap = new Map(
        profile.favoriteDirectors.map((d) => [d.name.toLowerCase(), d.weight]),
      );
      const actorMap = new Map(
        profile.favoriteActors.map((a) => [a.name.toLowerCase(), a.weight]),
      );

      let directorMatchWeight = 0;
      const matchedDirectors: string[] = [];
      for (const director of directors) {
        const weight = directorMap.get(director.toLowerCase());
        if (weight !== undefined) {
          directorMatchWeight += weight;
          matchedDirectors.push(director);
        }
      }

      let actorMatchWeight = 0;
      const matchedActors: string[] = [];
      for (const actor of cast) {
        const weight = actorMap.get(actor.toLowerCase());
        if (weight !== undefined) {
          actorMatchWeight += weight;
          matchedActors.push(actor);
        }
      }

      // Directors weighted more heavily than actors
      peopleScore = Math.min(
        directorMatchWeight * 0.6 + actorMatchWeight * 0.4,
        1,
      );

      if (matchedDirectors.length > 0) {
        explanation.push(`Directed by ${matchedDirectors.join(', ')}`);
      }
      if (matchedActors.length > 0) {
        explanation.push(
          `Stars ${matchedActors.slice(0, 3).join(', ')}`,
        );
      }
    }

    // --- Year range preference (10%) ---
    let yearScore = 0;
    if (candidate.year && profile.preferredDecades.length > 0) {
      const movieDecade = Math.floor(candidate.year / 10) * 10;
      const decadeMatch = profile.preferredDecades.find(
        (d) => d.decade === movieDecade,
      );
      if (decadeMatch) {
        yearScore = decadeMatch.weight;
        explanation.push(`From a decade you enjoy (${movieDecade}s)`);
      }
    }

    // --- Rating similarity (15%) ---
    let ratingScore = 0;
    if (candidate.metaRating && profile.averageRating > 0) {
      // Movies with ratings close to what the user typically rates highly
      // get a boost. We compare the movie's public rating to the user's
      // average and reward proximity.
      const metaRatingNormalized = candidate.metaRating / 10; // Normalize to 0-1
      const userAvgNormalized = profile.averageRating / 10;

      // How close is this movie's rating to the user's average?
      const ratingDiff = Math.abs(metaRatingNormalized - userAvgNormalized);
      ratingScore = Math.max(0, 1 - ratingDiff * 2);
    }

    // --- Popularity factor (10%) ---
    let popularityScore = 0;
    if (candidate.metaRating) {
      popularityScore = Math.min(candidate.metaRating / 10, 1);
    }

    // --- Weighted sum ---
    const totalScore =
      genreScore * WEIGHT_GENRE +
      peopleScore * WEIGHT_PEOPLE +
      yearScore * WEIGHT_YEAR +
      ratingScore * WEIGHT_RATING_SIMILARITY +
      popularityScore * WEIGHT_POPULARITY;

    return { score: totalScore, explanation };
  }

  /**
   * Get IDs of all movies a user has rated.
   */
  private async getUserRatedMovieIds(userId: string): Promise<string[]> {
    const ratings = await this.database.db
      .select({ movieId: userRatings.movieId })
      .from(userRatings)
      .where(eq(userRatings.userId, userId))
      .all();
    return ratings.map((r) => r.movieId);
  }

  /**
   * Get IDs of all movies a user has watched.
   */
  private async getUserWatchedMovieIds(userId: string): Promise<string[]> {
    const history = await this.database.db
      .select({ movieId: userWatchHistory.movieId })
      .from(userWatchHistory)
      .where(eq(userWatchHistory.userId, userId))
      .all();
    return history.map((h) => h.movieId);
  }

  /**
   * Parse a JSON text column into a string array.
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
}
