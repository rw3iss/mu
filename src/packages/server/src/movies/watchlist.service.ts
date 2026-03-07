import { Injectable, ConflictException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { userWatchlist, movies } from '../database/schema/index.js';

@Injectable()
export class WatchlistService {
  constructor(private readonly database: DatabaseService) {}

  add(userId: string, movieId: string, notes?: string) {
    const existing = this.database.db
      .select()
      .from(userWatchlist)
      .where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.movieId, movieId)))
      .get();

    if (existing) {
      throw new ConflictException('Movie is already in watchlist');
    }

    const id = crypto.randomUUID();
    const now = nowISO();

    this.database.db.insert(userWatchlist).values({
      id,
      userId,
      movieId,
      addedAt: now,
      notes: notes ?? null,
    }).run();

    return { id, userId, movieId, addedAt: now, notes: notes ?? null };
  }

  toggle(userId: string, movieId: string) {
    const existing = this.database.db
      .select()
      .from(userWatchlist)
      .where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.movieId, movieId)))
      .get();

    if (existing) {
      this.remove(userId, movieId);
      return { inWatchlist: false };
    }

    this.add(userId, movieId);
    return { inWatchlist: true };
  }

  remove(userId: string, movieId: string) {
    this.database.db
      .delete(userWatchlist)
      .where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.movieId, movieId)))
      .run();
  }

  getWatchlist(userId: string) {
    return this.database.db
      .select({
        id: userWatchlist.id,
        movieId: userWatchlist.movieId,
        addedAt: userWatchlist.addedAt,
        notes: userWatchlist.notes,
        movieTitle: movies.title,
        movieYear: movies.year,
        moviePosterUrl: movies.posterUrl,
        movieOverview: movies.overview,
        movieRuntimeMinutes: movies.runtimeMinutes,
      })
      .from(userWatchlist)
      .innerJoin(movies, eq(userWatchlist.movieId, movies.id))
      .where(eq(userWatchlist.userId, userId))
      .orderBy(userWatchlist.addedAt)
      .all();
  }
}
