import { nowISO, paginationDefaults } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies, userWatchHistory } from '../database/schema/index.js';

@Injectable()
export class HistoryService {
	constructor(private readonly database: DatabaseService) {}

	addToHistory(
		userId: string,
		movieId: string,
		position: number,
		duration: number,
		completed: boolean,
	) {
		const now = nowISO();

		const existing = this.database.db
			.select()
			.from(userWatchHistory)
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)))
			.get();

		if (existing) {
			this.database.db
				.update(userWatchHistory)
				.set({
					positionSeconds: position,
					durationWatchedSeconds: duration,
					completed,
					watchedAt: now,
				})
				.where(eq(userWatchHistory.id, existing.id))
				.run();
			return {
				...existing,
				positionSeconds: position,
				durationWatchedSeconds: duration,
				completed,
				watchedAt: now,
			};
		}

		const id = crypto.randomUUID();
		this.database.db
			.insert(userWatchHistory)
			.values({
				id,
				userId,
				movieId,
				positionSeconds: position,
				durationWatchedSeconds: duration,
				completed,
				watchedAt: now,
			})
			.run();

		return {
			id,
			userId,
			movieId,
			positionSeconds: position,
			durationWatchedSeconds: duration,
			completed,
			watchedAt: now,
		};
	}

	getHistory(userId: string, page?: number, pageSize?: number) {
		const { page: p, pageSize: ps, offset } = paginationDefaults({ page, pageSize });

		const data = this.database.db
			.select({
				id: userWatchHistory.id,
				movieId: userWatchHistory.movieId,
				watchedAt: userWatchHistory.watchedAt,
				durationWatchedSeconds: userWatchHistory.durationWatchedSeconds,
				completed: userWatchHistory.completed,
				positionSeconds: userWatchHistory.positionSeconds,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
				movieThumbnailUrl: movies.thumbnailUrl,
				movieDurationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
			})
			.from(userWatchHistory)
			.innerJoin(movies, eq(userWatchHistory.movieId, movies.id))
			.where(eq(userWatchHistory.userId, userId))
			.orderBy(desc(userWatchHistory.watchedAt))
			.limit(ps)
			.offset(offset)
			.all();

		const totalResult = this.database.db
			.select({ count: count() })
			.from(userWatchHistory)
			.where(eq(userWatchHistory.userId, userId))
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

	markWatched(userId: string, movieId: string) {
		const now = nowISO();
		const existing = this.database.db
			.select()
			.from(userWatchHistory)
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)))
			.get();

		if (existing) {
			this.database.db
				.update(userWatchHistory)
				.set({ completed: true, watchedAt: now })
				.where(eq(userWatchHistory.id, existing.id))
				.run();
			return;
		}

		this.database.db
			.insert(userWatchHistory)
			.values({
				id: crypto.randomUUID(),
				userId,
				movieId,
				completed: true,
				watchedAt: now,
			})
			.run();
	}

	clearHistory(userId: string) {
		this.database.db.delete(userWatchHistory).where(eq(userWatchHistory.userId, userId)).run();
	}

	markUnwatched(userId: string, movieId: string) {
		this.database.db
			.delete(userWatchHistory)
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)))
			.run();
	}

	getContinueWatching(userId: string) {
		const rows = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				year: movies.year,
				posterUrl: movies.posterUrl,
				thumbnailUrl: movies.thumbnailUrl,
				runtimeMinutes: movies.runtimeMinutes,
				addedAt: movies.addedAt,
				positionSeconds: userWatchHistory.positionSeconds,
			})
			.from(userWatchHistory)
			.innerJoin(movies, eq(userWatchHistory.movieId, movies.id))
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, false)))
			.orderBy(desc(userWatchHistory.watchedAt))
			.limit(20)
			.all();

		return rows.map((row) => {
			const totalSeconds = (row.runtimeMinutes ?? 0) * 60;
			const watchProgress = totalSeconds > 0 ? (row.positionSeconds ?? 0) / totalSeconds : 0;
			const posterUrl = row.posterUrl || row.thumbnailUrl;
			return {
				id: row.id,
				title: row.title,
				year: row.year,
				posterUrl,
				thumbnailUrl: row.thumbnailUrl,
				runtimeMinutes: row.runtimeMinutes,
				addedAt: row.addedAt,
				watchProgress,
			};
		});
	}
}
