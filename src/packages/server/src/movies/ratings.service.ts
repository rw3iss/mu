import { paginationDefaults } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { entityRatings, movies } from '../database/schema/index.js';
import { EntityRatingsService } from '../entities/entity-ratings.service.js';

const isMovie = eq(entityRatings.entityType, 'movie');

/** Movie-facing wrapper over the generic EntityRatingsService. */
@Injectable()
export class RatingsService {
	constructor(
		private readonly database: DatabaseService,
		private readonly ratings: EntityRatingsService,
	) {}

	rate(userId: string, movieId: string, rating: number) {
		const row = this.ratings.rate(userId, { type: 'movie', id: movieId }, rating);
		return {
			id: row.id,
			userId: row.userId,
			movieId: row.entityId,
			rating: row.rating,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	removeRating(userId: string, movieId: string) {
		this.ratings.remove(userId, { type: 'movie', id: movieId });
	}

	getUserRatings(userId: string, page?: number, pageSize?: number) {
		const { page: p, pageSize: ps, offset } = paginationDefaults({ page, pageSize });

		const data = this.database.db
			.select({
				id: entityRatings.id,
				movieId: entityRatings.entityId,
				rating: entityRatings.rating,
				createdAt: entityRatings.createdAt,
				updatedAt: entityRatings.updatedAt,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
			})
			.from(entityRatings)
			.innerJoin(movies, and(isMovie, eq(entityRatings.entityId, movies.id)))
			.where(eq(entityRatings.userId, userId))
			.orderBy(sql`${entityRatings.updatedAt} DESC`)
			.limit(ps)
			.offset(offset)
			.all();

		const totalResult = this.database.db
			.select({ count: count() })
			.from(entityRatings)
			.where(and(eq(entityRatings.userId, userId), isMovie))
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
          SELECT ${entityRatings.entityId} FROM ${entityRatings} WHERE ${entityRatings.userId} = ${userId} AND ${entityRatings.entityType} = 'movie'
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
          SELECT ${entityRatings.entityId} FROM ${entityRatings} WHERE ${entityRatings.userId} = ${userId} AND ${entityRatings.entityType} = 'movie'
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
