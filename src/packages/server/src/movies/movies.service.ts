import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { eq, like, and, desc, asc, sql, count } from 'drizzle-orm';
import { nowISO, paginationDefaults } from '@mu/shared';
import type { MovieListQuery } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import {
  movies,
  movieMetadata,
  movieFiles,
  userWatchlist,
  userRatings,
} from '../database/schema/index.js';

@Injectable()
export class MoviesService {
  private readonly logger = new Logger('MoviesService');

  constructor(private readonly database: DatabaseService) {}

  findAll(query: MovieListQuery) {
    const { page, pageSize, offset } = paginationDefaults(query);

    const conditions = [];

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
      default:
        orderBy = desc(movies.addedAt);
    }

    // Build query with optional genre join
    let data;
    let total: number;

    if (query.genre) {
      data = this.database.db
        .select({
          id: movies.id,
          title: movies.title,
          originalTitle: movies.originalTitle,
          year: movies.year,
          overview: movies.overview,
          runtimeMinutes: movies.runtimeMinutes,
          posterUrl: movies.posterUrl,
          backdropUrl: movies.backdropUrl,
          imdbId: movies.imdbId,
          tmdbId: movies.tmdbId,
          contentRating: movies.contentRating,
          addedAt: movies.addedAt,
          updatedAt: movies.updatedAt,
        })
        .from(movies)
        .leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
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
        .select()
        .from(movies)
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
      movies: data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  findById(id: string, userId?: string) {
    const movie = this.database.db
      .select()
      .from(movies)
      .where(eq(movies.id, id))
      .get();

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

    // Check watchlist status and user rating if userId provided
    let inWatchlist = false;
    let userRating = 0;
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
    }

    return this.flattenMovie(movie, metadata, inWatchlist, userRating);
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

    return {
      id: movie.id,
      title: movie.title,
      year: movie.year ?? 0,
      overview: movie.overview ?? '',
      posterUrl: movie.posterUrl ?? '',
      backdropUrl: movie.backdropUrl ?? '',
      runtime: movie.runtimeMinutes ?? 0,
      imdbId: movie.imdbId ?? undefined,
      tmdbId: movie.tmdbId ?? undefined,
      addedAt: movie.addedAt ?? '',
      genres: parseJson(metadata?.genres),
      cast: parseJson(metadata?.cast),
      director: (() => {
        const directors = parseJson(metadata?.directors);
        return directors.length > 0
          ? (typeof directors[0] === 'string' ? directors[0] : directors[0]?.name ?? '')
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
      .all();
  }

  search(q: string) {
    return this.database.db
      .select()
      .from(movies)
      .where(like(movies.title, `%${q}%`))
      .orderBy(asc(movies.title))
      .limit(50)
      .all();
  }

  update(id: string, data: Partial<{
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
  }>) {
    const existing = this.database.db
      .select()
      .from(movies)
      .where(eq(movies.id, id))
      .get();

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
    const existing = this.database.db
      .select()
      .from(movies)
      .where(eq(movies.id, id))
      .get();

    if (!existing) {
      throw new NotFoundException(`Movie ${id} not found`);
    }

    this.database.db.delete(movies).where(eq(movies.id, id)).run();
    this.logger.log(`Deleted movie: ${existing.title}`);
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

  bulkAction(action: string, movieIds: string[], userId: string, extra?: { playlistId?: string }) {
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
