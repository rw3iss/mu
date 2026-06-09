import { nowISO, paginationDefaults } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	movieFiles,
	movies,
	userWatchHistory,
} from '../database/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class HistoryService {
	private readonly logger = new Logger('HistoryService');

	constructor(
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
	) {}

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

	/**
	 * Delete the watch-history row for a single (user, movie). Used
	 * when the player reaches end-of-stream, when the user clicks
	 * "Start over", or when the user manually resets a movie. After
	 * this call, the resume button disappears and the next playback
	 * session starts fresh.
	 */
	clearPosition(userId: string, movieId: string): boolean {
		const result = this.database.db
			.delete(userWatchHistory)
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)))
			.run();
		return result.changes > 0;
	}

	/**
	 * Bulk lookup of all in-progress resume positions for one user.
	 * Returned as a movieId-keyed map plus a flat list (for clients
	 * that want stable iteration). Joins movie_files so the client
	 * can compute progress percent without a follow-up call.
	 */
	getAllPositions(userId: string): {
		positions: Array<{
			movieId: string;
			positionSeconds: number;
			durationSeconds: number | null;
			watchedAt: string;
		}>;
	} {
		// LEFT JOIN movie_files for runtime. We pick the first file per
		// movie (LIMIT 1 isn't expressible in a simple JOIN, so use a
		// MIN aggregate keyed by movie_id — most movies have one file).
		const rows = this.database.db
			.select({
				movieId: userWatchHistory.movieId,
				positionSeconds: userWatchHistory.positionSeconds,
				watchedAt: userWatchHistory.watchedAt,
				durationSeconds: movieFiles.durationSeconds,
			})
			.from(userWatchHistory)
			.leftJoin(movieFiles, eq(movieFiles.movieId, userWatchHistory.movieId))
			.where(eq(userWatchHistory.userId, userId))
			.orderBy(desc(userWatchHistory.watchedAt))
			.all();

		// Multi-file movies will produce multiple rows per movieId; keep
		// the first (most-recent watchedAt order already applied).
		const seen = new Set<string>();
		const positions: Array<{
			movieId: string;
			positionSeconds: number;
			durationSeconds: number | null;
			watchedAt: string;
		}> = [];
		for (const r of rows) {
			if (seen.has(r.movieId)) continue;
			seen.add(r.movieId);
			positions.push({
				movieId: r.movieId,
				positionSeconds: r.positionSeconds ?? 0,
				durationSeconds: r.durationSeconds ?? null,
				watchedAt: r.watchedAt,
			});
		}
		return { positions };
	}

	getContinueWatching(userId: string) {
		// Returns the user's most-recently-watched movies regardless of
		// completion state. The dashboard's "Continue Watching" rail
		// mirrors the sidebar's "Recent" list — anything you watched,
		// fully or partially, ordered by when you last touched it.
		// Completed movies still show with progress=1 so the card shows
		// the full progress bar (the player decides whether "Play"
		// resumes or restarts based on watch position).
		const rows = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				year: movies.year,
				overview: movies.overview,
				posterUrl: movies.posterUrl,
				thumbnailUrl: movies.thumbnailUrl,
				backdropUrl: movies.backdropUrl,
				runtimeMinutes: movies.runtimeMinutes,
				addedAt: movies.addedAt,
				positionSeconds: userWatchHistory.positionSeconds,
				completed: userWatchHistory.completed,
				watchedAt: userWatchHistory.watchedAt,
				durationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
			})
			.from(userWatchHistory)
			.innerJoin(movies, eq(userWatchHistory.movieId, movies.id))
			.where(eq(userWatchHistory.userId, userId))
			.orderBy(desc(userWatchHistory.watchedAt))
			.limit(20)
			.all();

		return rows.map((row) => {
			const totalSeconds = row.durationSeconds || (row.runtimeMinutes ?? 0) * 60;
			const watchPosition = row.completed ? totalSeconds : (row.positionSeconds ?? 0);
			const watchProgress = totalSeconds > 0 ? Math.min(1, watchPosition / totalSeconds) : 0;
			const posterUrl = row.posterUrl || row.thumbnailUrl;
			return {
				id: row.id,
				title: row.title,
				year: row.year,
				overview: row.overview ?? '',
				posterUrl,
				thumbnailUrl: row.thumbnailUrl,
				backdropUrl: row.backdropUrl,
				runtime: row.runtimeMinutes ?? 0,
				addedAt: row.addedAt,
				watchPosition,
				durationSeconds: totalSeconds,
				watched: !!row.completed,
				watchedAt: row.watchedAt,
				watchProgress,
				genres: [] as string[],
				cast: [] as unknown[],
				rating: 0,
			};
		});
	}

	/** Total movies in the user's history (started or completed) — the "watched" tally. */
	getHistoryCount(userId: string): number {
		const result = this.database.db
			.select({ count: count() })
			.from(userWatchHistory)
			.where(eq(userWatchHistory.userId, userId))
			.get();
		return result?.count ?? 0;
	}

	/** Most recent watch timestamp for the user, or null. */
	getLastWatchedAt(userId: string): string | null {
		const result = this.database.db
			.select({ watchedAt: userWatchHistory.watchedAt })
			.from(userWatchHistory)
			.where(eq(userWatchHistory.userId, userId))
			.orderBy(desc(userWatchHistory.watchedAt))
			.limit(1)
			.get();
		return result?.watchedAt ?? null;
	}

	getWatchedCount(userId: string): number {
		const result = this.database.db
			.select({ count: count() })
			.from(userWatchHistory)
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
			.get();
		return result?.count ?? 0;
	}

	clearWatchedFlags(userId: string): number {
		const watchedCount = this.getWatchedCount(userId);
		this.database.db
			.update(userWatchHistory)
			.set({ completed: false })
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
			.run();
		return watchedCount;
	}
}
