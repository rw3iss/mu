import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { TmdbProvider } from './providers/tmdb.provider.js';
import { OmdbProvider } from './providers/omdb.provider.js';
import { CacheService } from '../cache/cache.service.js';
import { movies, movieMetadata } from '../database/schema/index.js';

@Injectable()
export class MetadataService {
  private readonly logger = new Logger('MetadataService');

  constructor(
    private readonly database: DatabaseService,
    private readonly tmdb: TmdbProvider,
    private readonly omdb: OmdbProvider,
    private readonly cache: CacheService,
  ) {}

  async fetchForMovie(movieId: string) {
    const movie = this.database.db
      .select()
      .from(movies)
      .where(eq(movies.id, movieId))
      .get();

    if (!movie) {
      throw new NotFoundException(`Movie ${movieId} not found`);
    }

    // Step 1: Search TMDB by title + year
    const searchResults = await this.tmdb.searchMovie(movie.title, movie.year ?? undefined);
    if (!searchResults || searchResults.length === 0) {
      this.logger.warn(`No TMDB results for "${movie.title}" (${movie.year})`);
      return null;
    }

    const match = searchResults[0]!;

    // Step 2: Get full details from TMDB
    const details = await this.tmdb.getMovieDetails(match.id);
    if (!details) {
      this.logger.warn(`Could not fetch TMDB details for ${match.id}`);
      return null;
    }

    const now = nowISO();

    // Step 3: Update movies table
    const trailerVideo = details.videos?.results?.find(
      (v) => v.site === 'YouTube' && v.type === 'Trailer',
    );
    const trailerUrl = trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : null;

    this.database.db
      .update(movies)
      .set({
        tmdbId: details.id,
        imdbId: details.imdb_id ?? null,
        overview: details.overview || null,
        tagline: details.tagline || null,
        runtimeMinutes: details.runtime || null,
        releaseDate: details.release_date || null,
        language: details.spoken_languages?.[0]?.iso_639_1 ?? null,
        country: details.production_countries?.[0]?.iso_3166_1 ?? null,
        posterUrl: this.tmdb.getImageUrl(details.poster_path),
        backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280'),
        trailerUrl,
        year: details.release_date ? parseInt(details.release_date.slice(0, 4), 10) : movie.year,
        updatedAt: now,
      })
      .where(eq(movies.id, movieId))
      .run();

    // Step 4: Create/update movie_metadata
    const genres = JSON.stringify(details.genres.map((g) => g.name));
    const castMembers = JSON.stringify(
      (details.credits?.cast ?? []).slice(0, 20).map((c) => ({
        name: c.name,
        character: c.character,
        profileUrl: this.tmdb.getImageUrl(c.profile_path, 'w185'),
        tmdbId: c.id,
      })),
    );
    const directors = JSON.stringify(
      (details.credits?.crew ?? [])
        .filter((c) => c.job === 'Director')
        .map((c) => c.name),
    );
    const writers = JSON.stringify(
      (details.credits?.crew ?? [])
        .filter((c) => c.department === 'Writing')
        .map((c) => c.name),
    );
    const keywords = JSON.stringify([]);
    const productionCompanies = JSON.stringify(
      details.production_companies.map((c) => c.name),
    );

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
      budget: details.budget || null,
      revenue: details.revenue || null,
      tmdbRating: details.vote_average || null,
      tmdbVotes: details.vote_count || null,
      source: 'tmdb',
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
      this.database.db.insert(movieMetadata).values({
        id: crypto.randomUUID(),
        ...metaValues,
      }).run();
    }

    // Step 5: If OMDB configured and we have an IMDb ID, fetch supplementary data
    if (details.imdb_id) {
      const omdbData = await this.omdb.getByImdbId(details.imdb_id);
      if (omdbData) {
        const metaRecord = this.database.db
          .select()
          .from(movieMetadata)
          .where(eq(movieMetadata.movieId, movieId))
          .get();

        if (metaRecord) {
          this.database.db
            .update(movieMetadata)
            .set({
              imdbRating: omdbData.imdbRating,
              imdbVotes: omdbData.imdbVotes,
              rottenTomatoesScore: omdbData.rottenTomatoesScore,
              metacriticScore: omdbData.metacriticScore,
              updatedAt: nowISO(),
            })
            .where(eq(movieMetadata.id, metaRecord.id))
            .run();
        }
      }
    }

    this.logger.log(`Metadata fetched for "${movie.title}" (TMDB ID: ${details.id})`);

    return this.database.db
      .select()
      .from(movieMetadata)
      .where(eq(movieMetadata.movieId, movieId))
      .get();
  }

  async refreshMetadata(movieId: string) {
    // Clear cache for this movie's TMDB data so we refetch
    const movie = this.database.db
      .select()
      .from(movies)
      .where(eq(movies.id, movieId))
      .get();

    if (!movie) {
      throw new NotFoundException(`Movie ${movieId} not found`);
    }

    if (movie.tmdbId) {
      await this.cache.delete('metadata', `details:${movie.tmdbId}`);
    }
    await this.cache.delete('metadata', `search:${movie.title}:${movie.year ?? ''}`);

    return this.fetchForMovie(movieId);
  }

  async bulkFetch(movieIds: string[], concurrency: number = 3) {
    const results: { movieId: string; success: boolean; error?: string }[] = [];

    // Process in batches for concurrency control
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
}
