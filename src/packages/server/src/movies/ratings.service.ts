import { Injectable, BadRequestException } from '@nestjs/common';
import { eq, and, count, sql } from 'drizzle-orm';
import { nowISO, paginationDefaults, RATING_MIN, RATING_MAX } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { userRatings, movies } from '../database/schema/index.js';

@Injectable()
export class RatingsService {
  constructor(private readonly database: DatabaseService) {}

  rate(userId: string, movieId: string, rating: number) {
    if (rating < RATING_MIN || rating > RATING_MAX) {
      throw new BadRequestException(`Rating must be between ${RATING_MIN} and ${RATING_MAX}`);
    }

    const now = nowISO();
    const existing = this.database.db
      .select()
      .from(userRatings)
      .where(and(eq(userRatings.userId, userId), eq(userRatings.movieId, movieId)))
      .get();

    if (existing) {
      this.database.db
        .update(userRatings)
        .set({ rating, updatedAt: now })
        .where(eq(userRatings.id, existing.id))
        .run();
      return { ...existing, rating, updatedAt: now };
    }

    const id = crypto.randomUUID();
    this.database.db.insert(userRatings).values({
      id,
      userId,
      movieId,
      rating,
      createdAt: now,
      updatedAt: now,
    }).run();

    return { id, userId, movieId, rating, createdAt: now, updatedAt: now };
  }

  removeRating(userId: string, movieId: string) {
    this.database.db
      .delete(userRatings)
      .where(and(eq(userRatings.userId, userId), eq(userRatings.movieId, movieId)))
      .run();
  }

  getUserRatings(userId: string, page?: number, pageSize?: number) {
    const { page: p, pageSize: ps, offset } = paginationDefaults({ page, pageSize });

    const data = this.database.db
      .select({
        id: userRatings.id,
        movieId: userRatings.movieId,
        rating: userRatings.rating,
        createdAt: userRatings.createdAt,
        updatedAt: userRatings.updatedAt,
        movieTitle: movies.title,
        movieYear: movies.year,
        moviePosterUrl: movies.posterUrl,
      })
      .from(userRatings)
      .innerJoin(movies, eq(userRatings.movieId, movies.id))
      .where(eq(userRatings.userId, userId))
      .orderBy(sql`${userRatings.updatedAt} DESC`)
      .limit(ps)
      .offset(offset)
      .all();

    const totalResult = this.database.db
      .select({ count: count() })
      .from(userRatings)
      .where(eq(userRatings.userId, userId))
      .get();
    const total = totalResult?.count ?? 0;

    return {
      data,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
    };
  }

  getUnrated(userId: string, page?: number, pageSize?: number) {
    const { page: p, pageSize: ps, offset } = paginationDefaults({ page, pageSize });

    const data = this.database.db
      .select()
      .from(movies)
      .where(
        sql`${movies.id} NOT IN (
          SELECT ${userRatings.movieId} FROM ${userRatings} WHERE ${userRatings.userId} = ${userId}
        )`,
      )
      .orderBy(sql`${movies.addedAt} DESC`)
      .limit(ps)
      .offset(offset)
      .all();

    const totalResult = this.database.db
      .select({ count: count() })
      .from(movies)
      .where(
        sql`${movies.id} NOT IN (
          SELECT ${userRatings.movieId} FROM ${userRatings} WHERE ${userRatings.userId} = ${userId}
        )`,
      )
      .get();
    const total = totalResult?.count ?? 0;

    return {
      data,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
    };
  }
}
