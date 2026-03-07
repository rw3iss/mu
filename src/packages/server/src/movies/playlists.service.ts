import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, count, sql, asc } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { playlists, playlistMovies, movies } from '../database/schema/index.js';

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

  findAll(userId: string) {
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
      .all();

    return result;
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
