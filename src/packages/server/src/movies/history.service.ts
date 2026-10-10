import { nowISO, paginationDefaults, WsEvent } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies, playHistory } from '../database/schema/index.js';

const isMovie = eq(playHistory.entityType, 'movie');

import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class HistoryService {
	private readonly logger = new Logger('HistoryService');

	constructor(
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly events: EventsService,
	) {}

	/** Notify clients (dashboard rail, resume bars) that a user's watch status changed. */
	private emitWatchChange(userId: string, movieId: string, watched: boolean): void {
		this.events.emit(WsEvent.WATCH_STATUS_CHANGED, { userId, movieId, watched });
	}

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
			.from(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.entityId, movieId)))
			.get();

		if (existing) {
			this.database.db
				.update(playHistory)
				.set({
					positionSeconds: position,
					durationWatchedSeconds: duration,
					completed,
					lastPlayedAt: now,
					// A play that just finished counts once.
					...(completed && !existing.completed
						? { playCount: sql`${playHistory.playCount} + 1` }
						: {}),
				})
				.where(eq(playHistory.id, existing.id))
				.run();
			const { entityId, entityType: _t, lastPlayedAt: _l, playCount: _c, ...rest } = existing;
			return {
				...rest,
				movieId: entityId,
				positionSeconds: position,
				durationWatchedSeconds: duration,
				completed,
				watchedAt: now,
			};
		}

		const id = crypto.randomUUID();
		this.database.db
			.insert(playHistory)
			.values({
				id,
				userId,
				entityType: 'movie',
				entityId: movieId,
				positionSeconds: position,
				durationWatchedSeconds: duration,
				completed,
				playCount: completed ? 1 : 0,
				lastPlayedAt: now,
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
				id: playHistory.id,
				movieId: playHistory.entityId,
				watchedAt: playHistory.lastPlayedAt,
				durationWatchedSeconds: playHistory.durationWatchedSeconds,
				completed: playHistory.completed,
				positionSeconds: playHistory.positionSeconds,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
				movieThumbnailUrl: movies.thumbnailUrl,
				movieDurationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
			})
			.from(playHistory)
			.innerJoin(movies, and(isMovie, eq(playHistory.entityId, movies.id)))
			.where(and(eq(playHistory.userId, userId), isMovie))
			.orderBy(desc(playHistory.lastPlayedAt))
			.limit(ps)
			.offset(offset)
			.all();

		const totalResult = this.database.db
			.select({ count: count() })
			.from(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie))
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
			.from(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.entityId, movieId)))
			.get();

		if (existing) {
			// Marking watched clears the resume position so it leaves "Continue
			// Watching" (which only lists in-progress titles) but stays in history.
			this.database.db
				.update(playHistory)
				.set({ completed: true, positionSeconds: 0, lastPlayedAt: now })
				.where(eq(playHistory.id, existing.id))
				.run();
			this.emitWatchChange(userId, movieId, true);
			return;
		}

		this.database.db
			.insert(playHistory)
			.values({
				id: crypto.randomUUID(),
				userId,
				entityType: 'movie',
				entityId: movieId,
				positionSeconds: 0,
				completed: true,
				playCount: 0,
				lastPlayedAt: now,
			})
			.run();
		this.emitWatchChange(userId, movieId, true);
	}

	clearHistory(userId: string) {
		this.database.db
			.delete(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie))
			.run();
	}

	markUnwatched(userId: string, movieId: string) {
		this.database.db
			.delete(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.entityId, movieId)))
			.run();
		this.emitWatchChange(userId, movieId, false);
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
			.delete(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.entityId, movieId)))
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
				movieId: playHistory.entityId,
				positionSeconds: playHistory.positionSeconds,
				watchedAt: playHistory.lastPlayedAt,
				durationSeconds: movieFiles.durationSeconds,
			})
			.from(playHistory)
			.leftJoin(movieFiles, eq(movieFiles.movieId, playHistory.entityId))
			// Only in-progress titles get a resume position — finished ones don't.
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.completed, false)))
			.orderBy(desc(playHistory.lastPlayedAt))
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
		// The dashboard "Continue Watching" rail lists only IN-PROGRESS titles —
		// finished movies (completed=true) are excluded so they don't linger here
		// after you watch them; they remain in the full watch history. Ordered by
		// when you last touched them.
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
				positionSeconds: playHistory.positionSeconds,
				completed: playHistory.completed,
				watchedAt: playHistory.lastPlayedAt,
				durationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
			})
			.from(playHistory)
			.innerJoin(movies, and(isMovie, eq(playHistory.entityId, movies.id)))
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.completed, false)))
			.orderBy(desc(playHistory.lastPlayedAt))
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
			.from(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie))
			.get();
		return result?.count ?? 0;
	}

	/** Most recent watch timestamp for the user, or null. */
	getLastWatchedAt(userId: string): string | null {
		const result = this.database.db
			.select({ watchedAt: playHistory.lastPlayedAt })
			.from(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie))
			.orderBy(desc(playHistory.lastPlayedAt))
			.limit(1)
			.get();
		return result?.watchedAt ?? null;
	}

	getWatchedCount(userId: string): number {
		const result = this.database.db
			.select({ count: count() })
			.from(playHistory)
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.completed, true)))
			.get();
		return result?.count ?? 0;
	}

	clearWatchedFlags(userId: string): number {
		const watchedCount = this.getWatchedCount(userId);
		this.database.db
			.update(playHistory)
			.set({ completed: false })
			.where(and(eq(playHistory.userId, userId), isMovie, eq(playHistory.completed, true)))
			.run();
		return watchedCount;
	}
}
