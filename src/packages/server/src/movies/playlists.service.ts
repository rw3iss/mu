import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, count, sql, asc, desc } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { playlists, playlistMovies, movies, userWatchHistory } from '../database/schema/index.js';

interface PlaylistMovieSummary {
  movieId: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  runtimeMinutes: number | null;
  durationSeconds: number | null;
  addedAt: string | null;
}

@Injectable()
export class PlaylistsService {
  constructor(private readonly database: DatabaseService) {}

  create(userId: string, name: string, description?: string) {
    const id = crypto.randomUUID();
    const now = nowISO();

    this.database.db.insert(playlists).values({
      id,
      userId,
      name,
      description: description ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return this.findById(id);
  }

  findAll(userId: string, options?: { includeMovies?: boolean; sortBy?: 'created' | 'updated' | 'name' | 'movieCount' | 'lastPlayed'; sortOrder?: 'asc' | 'desc' }) {
    const sortBy = options?.sortBy ?? 'updated';
    const order = options?.sortOrder ?? 'desc';
    const dirFn = order === 'asc' ? asc : desc;

    // For "lastPlayed" sorting we need a subquery-based approach
    if (sortBy === 'lastPlayed') {
      return this.findAllSortedByLastPlayed(userId, options?.includeMovies, order);
    }

    const orderExpr = (() => {
      switch (sortBy) {
        case 'created': return dirFn(playlists.createdAt);
        case 'name': return dirFn(playlists.name);
        case 'movieCount': return dirFn(count(playlistMovies.id));
        case 'updated':
        default: return dirFn(playlists.updatedAt);
      }
    })();

    const result = this.database.db
      .select({
        id: playlists.id,
        name: playlists.name,
        description: playlists.description,
        coverUrl: playlists.coverUrl,
        isSmart: playlists.isSmart,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
        movieCount: count(playlistMovies.id),
      })
      .from(playlists)
      .leftJoin(playlistMovies, eq(playlists.id, playlistMovies.playlistId))
      .where(eq(playlists.userId, userId))
      .groupBy(playlists.id)
      .orderBy(orderExpr)
      .all();

    if (!options?.includeMovies) {
      return result;
    }

    return this.attachMovieSummaries(result);
  }

  /**
   * Sort playlists by "last played": rank each playlist by how many of its movies
   * were recently played. Uses the most recent watchedAt per movie, then counts
   * how many of each playlist's movies appear among the user's recently watched.
   * Ties broken by playlist updatedAt.
   */
  private findAllSortedByLastPlayed(userId: string, includeMovies?: boolean, order: 'asc' | 'desc' = 'desc') {
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    const result = this.database.db.all<{
      id: string;
      name: string;
      description: string | null;
      cover_url: string | null;
      is_smart: number | null;
      created_at: string;
      updated_at: string;
      movie_count: number;
      last_played_score: number | null;
    }>(sql`
      SELECT
        p.id,
        p.name,
        p.description,
        p.cover_url,
        p.is_smart,
        p.created_at,
        p.updated_at,
        COALESCE(mc.cnt, 0) AS movie_count,
        lp.score AS last_played_score
      FROM playlists p
      LEFT JOIN (
        SELECT playlist_id, COUNT(*) AS cnt
        FROM playlist_movies
        GROUP BY playlist_id
      ) mc ON mc.playlist_id = p.id
      LEFT JOIN (
        SELECT
          pm.playlist_id,
          SUM(CASE WHEN lwh.max_watched IS NOT NULL THEN 1 ELSE 0 END) AS score
        FROM playlist_movies pm
        LEFT JOIN (
          SELECT movie_id, MAX(watched_at) AS max_watched
          FROM user_watch_history
          WHERE user_id = ${userId}
          GROUP BY movie_id
        ) lwh ON lwh.movie_id = pm.movie_id
        GROUP BY pm.playlist_id
      ) lp ON lp.playlist_id = p.id
      WHERE p.user_id = ${userId}
      ORDER BY COALESCE(lp.score, 0) ${sql.raw(dir)}, p.updated_at ${sql.raw(dir)}
    `);

    const mapped = result.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      coverUrl: r.cover_url,
      isSmart: r.is_smart ? true : false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      movieCount: r.movie_count,
    }));

    if (!includeMovies) {
      return mapped;
    }

    return this.attachMovieSummaries(mapped);
  }

  private attachMovieSummaries<T extends { id: string }>(playlists_list: T[]) {
    return playlists_list.map((playlist) => {
      const movieSummaries = this.database.db
        .select({
          movieId: playlistMovies.movieId,
          title: movies.title,
          year: movies.year,
          posterUrl: movies.posterUrl,
          thumbnailUrl: movies.thumbnailUrl,
          runtimeMinutes: movies.runtimeMinutes,
          durationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
          addedAt: playlistMovies.addedAt,
        })
        .from(playlistMovies)
        .innerJoin(movies, eq(playlistMovies.movieId, movies.id))
        .where(eq(playlistMovies.playlistId, playlist.id))
        .orderBy(asc(playlistMovies.position))
        .all() as PlaylistMovieSummary[];

      return { ...playlist, movies: movieSummaries };
    });
  }

  findById(id: string) {
    const playlist = this.database.db
      .select()
      .from(playlists)
      .where(eq(playlists.id, id))
      .get();

    if (!playlist) {
      throw new NotFoundException(`Playlist ${id} not found`);
    }

    const items = this.database.db
      .select({
        id: playlistMovies.id,
        movieId: playlistMovies.movieId,
        position: playlistMovies.position,
        addedAt: playlistMovies.addedAt,
        movieTitle: movies.title,
        movieYear: movies.year,
        moviePosterUrl: movies.posterUrl,
        movieThumbnailUrl: movies.thumbnailUrl,
        movieRuntimeMinutes: movies.runtimeMinutes,
      })
      .from(playlistMovies)
      .innerJoin(movies, eq(playlistMovies.movieId, movies.id))
      .where(eq(playlistMovies.playlistId, id))
      .orderBy(asc(playlistMovies.position))
      .all();

    return { ...playlist, movies: items };
  }

  update(id: string, data: Partial<{ name: string; description: string; coverUrl: string }>) {
    const existing = this.database.db
      .select()
      .from(playlists)
      .where(eq(playlists.id, id))
      .get();

    if (!existing) {
      throw new NotFoundException(`Playlist ${id} not found`);
    }

    this.database.db
      .update(playlists)
      .set({ ...data, updatedAt: nowISO() })
      .where(eq(playlists.id, id))
      .run();

    return this.findById(id);
  }

  remove(id: string) {
    const existing = this.database.db
      .select()
      .from(playlists)
      .where(eq(playlists.id, id))
      .get();

    if (!existing) {
      throw new NotFoundException(`Playlist ${id} not found`);
    }

    this.database.db.delete(playlists).where(eq(playlists.id, id)).run();
  }

  addMovie(playlistId: string, movieId: string) {
    const existing = this.database.db
      .select()
      .from(playlistMovies)
      .where(and(eq(playlistMovies.playlistId, playlistId), eq(playlistMovies.movieId, movieId)))
      .get();

    if (existing) {
      throw new ConflictException('Movie is already in this playlist');
    }

    // Get the next position
    const maxPos = this.database.db
      .select({ maxPosition: sql<number>`COALESCE(MAX(${playlistMovies.position}), 0)` })
      .from(playlistMovies)
      .where(eq(playlistMovies.playlistId, playlistId))
      .get();

    const position = (maxPos?.maxPosition ?? 0) + 1;

    this.database.db.insert(playlistMovies).values({
      id: crypto.randomUUID(),
      playlistId,
      movieId,
      position,
      addedAt: nowISO(),
    }).run();

    // Update playlist timestamp
    this.database.db
      .update(playlists)
      .set({ updatedAt: nowISO() })
      .where(eq(playlists.id, playlistId))
      .run();
  }

  removeMovie(playlistId: string, movieId: string) {
    this.database.db
      .delete(playlistMovies)
      .where(and(eq(playlistMovies.playlistId, playlistId), eq(playlistMovies.movieId, movieId)))
      .run();

    this.database.db
      .update(playlists)
      .set({ updatedAt: nowISO() })
      .where(eq(playlists.id, playlistId))
      .run();
  }

  findByMovie(userId: string, movieId: string) {
    return this.database.db
      .select({
        id: playlists.id,
        name: playlists.name,
      })
      .from(playlistMovies)
      .innerJoin(playlists, eq(playlistMovies.playlistId, playlists.id))
      .where(and(eq(playlistMovies.movieId, movieId), eq(playlists.userId, userId)))
      .all();
  }

  reorder(playlistId: string, movieIds: string[]) {
    for (let i = 0; i < movieIds.length; i++) {
      const movieId = movieIds[i]!;
      this.database.db
        .update(playlistMovies)
        .set({ position: i + 1 })
        .where(
          and(eq(playlistMovies.playlistId, playlistId), eq(playlistMovies.movieId, movieId)),
        )
        .run();
    }

    this.database.db
      .update(playlists)
      .set({ updatedAt: nowISO() })
      .where(eq(playlists.id, playlistId))
      .run();
  }
}
