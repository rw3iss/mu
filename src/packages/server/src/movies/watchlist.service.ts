import { nowISO } from '@mu/shared';
import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { entityWatchlist, movies } from '../database/schema/index.js';

const isMovie = eq(entityWatchlist.entityType, 'movie');

@Injectable()
export class WatchlistService {
	constructor(private readonly database: DatabaseService) {}

	add(userId: string, movieId: string, notes?: string) {
		const existing = this.database.db
			.select()
			.from(entityWatchlist)
			.where(
				and(
					eq(entityWatchlist.userId, userId),
					isMovie,
					eq(entityWatchlist.entityId, movieId),
				),
			)
			.get();

		if (existing) {
			throw new ConflictException('Movie is already in watchlist');
		}

		const id = crypto.randomUUID();
		const now = nowISO();

		this.database.db
			.insert(entityWatchlist)
			.values({
				id,
				userId,
				entityType: 'movie',
				entityId: movieId,
				addedAt: now,
				notes: notes ?? null,
			})
			.run();

		return { id, userId, movieId, addedAt: now, notes: notes ?? null };
	}

	toggle(userId: string, movieId: string) {
		const existing = this.database.db
			.select()
			.from(entityWatchlist)
			.where(
				and(
					eq(entityWatchlist.userId, userId),
					isMovie,
					eq(entityWatchlist.entityId, movieId),
				),
			)
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
			.delete(entityWatchlist)
			.where(
				and(
					eq(entityWatchlist.userId, userId),
					isMovie,
					eq(entityWatchlist.entityId, movieId),
				),
			)
			.run();
	}

	getWatchlist(userId: string) {
		return this.database.db
			.select({
				id: entityWatchlist.id,
				movieId: entityWatchlist.entityId,
				addedAt: entityWatchlist.addedAt,
				notes: entityWatchlist.notes,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
				movieThumbnailUrl: movies.thumbnailUrl,
				movieOverview: movies.overview,
				movieRuntimeMinutes: movies.runtimeMinutes,
			})
			.from(entityWatchlist)
			.innerJoin(movies, and(isMovie, eq(entityWatchlist.entityId, movies.id)))
			.where(eq(entityWatchlist.userId, userId))
			.orderBy(entityWatchlist.addedAt)
			.all();
	}
}
