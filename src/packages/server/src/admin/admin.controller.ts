import { existsSync } from 'node:fs';
import { Controller, Delete, Get, Logger, Param, Post } from '@nestjs/common';
import { eq, isNull } from 'drizzle-orm';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
	movieFiles,
	movies,
	streamSessions,
	users,
	userWatchHistory,
} from '../database/schema/index.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { SpriteService } from '../media/sprite.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { MoviesService } from '../movies/movies.service.js';
import { StreamService } from '../stream/stream.service.js';

const JOB_TYPE_THUMBNAIL = 'thumbnail';
const JOB_TYPE_SPRITE = 'sprite-sheet';

@Controller('admin')
export class AdminController {
	private readonly logger = new Logger('AdminController');

	constructor(
		private readonly database: DatabaseService,
		private readonly streamService: StreamService,
		private readonly thumbnailService: ThumbnailService,
		readonly _guidResolver: GuidResolverService,
		private readonly moviesService: MoviesService,
		private readonly jobManager: JobManagerService,
		private readonly spriteService: SpriteService,
	) {}

	/**
	 * Rewrite titles for every movie without remote (TMDB) metadata by
	 * running them through the title sanitiser. Cleans up filename-
	 * derived titles like
	 *   "alien earth s01e01 1080p web h264-successfulcrab[EZTVx to]"
	 * into "Alien Earth - S01E01".
	 */
	@Post('sanitize-titles')
	@Roles('admin')
	@RequireAction('admin:server')
	sanitizeTitles() {
		return this.moviesService.sanitizeUnmatchedTitles();
	}

	/**
	 * Generate thumbnails for all movies that don't have one.
	 */
	@Post('generate-missing-thumbnails')
	@Roles('admin')
	@RequireAction('admin:server')
	async generateMissingThumbnails() {
		const moviesWithoutThumbnails = this.database.db
			.select({ id: movies.id, title: movies.title })
			.from(movies)
			.where(isNull(movies.thumbnailUrl))
			.all();

		const count = moviesWithoutThumbnails.length;
		this.logger.log(`Enqueuing thumbnail generation for ${count} movies`);

		for (const m of moviesWithoutThumbnails) {
			this.jobManager.enqueue({
				type: JOB_TYPE_THUMBNAIL,
				label: `Generate thumbnail: ${m.title ?? m.id.slice(0, 8)}`,
				payload: { movieId: m.id },
				priority: 40,
			});
		}

		return { message: 'Thumbnail generation started', movieCount: count };
	}

	/**
	 * Fix broken thumbnails — movies that have a thumbnail URL in the DB
	 * but the actual image file is missing on disk. Enqueues each as a job.
	 */
	@Post('fix-broken-thumbnails')
	@Roles('admin')
	@RequireAction('admin:server')
	async fixBrokenThumbnails() {
		const brokenIds = this.thumbnailService.getBrokenThumbnailMovieIds();
		const count = brokenIds.length;
		this.logger.log(`Found ${count} movies with broken thumbnails, enqueuing jobs...`);

		if (count > 0) {
			// Look up titles for better job labels
			const movieRows = this.database.db
				.select({ id: movies.id, title: movies.title })
				.from(movies)
				.all();
			const titleMap = new Map(movieRows.map((m) => [m.id, m.title]));

			for (const id of brokenIds) {
				this.jobManager.enqueue({
					type: JOB_TYPE_THUMBNAIL,
					label: `Fix thumbnail: ${titleMap.get(id) ?? id.slice(0, 8)}`,
					payload: { movieId: id },
					priority: 35,
				});
			}
		}

		return {
			message:
				count > 0
					? `Enqueued ${count} thumbnail regeneration job(s)`
					: 'No broken thumbnails found',
			movieCount: count,
		};
	}

	/**
	 * Generate seek-preview sprite sheets for all movies that don't have them yet.
	 */
	@Post('generate-sprites')
	@Roles('admin')
	@RequireAction('admin:server')
	async generateMissingSprites() {
		const allMovies = this.database.db
			.select({ id: movies.id, title: movies.title })
			.from(movies)
			.all();

		const missing = allMovies.filter((m) => !this.spriteService.hasSprites(m.id));
		const count = missing.length;
		this.logger.log(`Enqueuing sprite generation for ${count} movies`);

		// Enqueue in background so the request returns immediately
		if (count > 0) {
			setImmediate(() => {
				for (const m of missing) {
					this.jobManager.enqueue({
						type: JOB_TYPE_SPRITE,
						label: `Generate sprites: ${m.title ?? m.id.slice(0, 8)}`,
						payload: { movieId: m.id },
						priority: 50,
					});
				}
				this.logger.log(`Finished enqueuing ${count} sprite jobs`);
			});
		}

		return {
			message:
				count > 0
					? `Enqueuing ${count} sprite generation job(s)`
					: 'All movies already have sprite sheets',
			movieCount: count,
		};
	}

	/**
	 * End a specific streaming session.
	 */
	@Delete('sessions/:sessionId')
	@Roles('admin')
	@RequireAction('admin:server')
	async endSession(@Param('sessionId') sessionId: string) {
		await this.streamService.endStream(sessionId);
		return { success: true };
	}

	/**
	 * End all streaming sessions except the current user's sessions.
	 */
	@Delete('sessions')
	@Roles('admin')
	@RequireAction('admin:server')
	async endAllSessions() {
		const ended = await this.streamService.endAllSessions();
		return { success: true, endedCount: ended };
	}

	/**
	 * Get session history — past watch records across all users.
	 */
	@Get('session-history')
	@Roles('admin')
	@RequireAction('admin:server')
	getSessionHistory() {
		// Get current active session movie+user pairs to mark them
		const activeSessionPairs = new Set(
			this.database.db
				.select({
					movieId: streamSessions.movieId,
					userId: streamSessions.userId,
				})
				.from(streamSessions)
				.all()
				.map((s) => `${s.userId}:${s.movieId}`),
		);

		const rows = this.database.db
			.select({
				id: userWatchHistory.id,
				userId: userWatchHistory.userId,
				username: users.username,
				displayName: users.displayName,
				movieId: userWatchHistory.movieId,
				movieTitle: movies.title,
				movieYear: movies.year,
				watchedAt: userWatchHistory.watchedAt,
				durationWatchedSeconds: userWatchHistory.durationWatchedSeconds,
				completed: userWatchHistory.completed,
				positionSeconds: userWatchHistory.positionSeconds,
			})
			.from(userWatchHistory)
			.leftJoin(users, eq(userWatchHistory.userId, users.id))
			.leftJoin(movies, eq(userWatchHistory.movieId, movies.id))
			.orderBy(userWatchHistory.watchedAt)
			.all();

		return rows.map((row) => ({
			...row,
			isActive: activeSessionPairs.has(`${row.userId}:${row.movieId}`),
		}));
	}

	/**
	 * Clear all session history (watch records) except entries for currently active streams.
	 */
	@Delete('session-history')
	@Roles('admin')
	@RequireAction('admin:server')
	clearSessionHistory() {
		// Find history IDs belonging to active streams — preserve those
		const activeStreams = this.database.db
			.select({ userId: streamSessions.userId, movieId: streamSessions.movieId })
			.from(streamSessions)
			.all();

		const activePairs = new Set(activeStreams.map((s) => `${s.userId}:${s.movieId}`));

		// Get all history entries
		const allHistory = this.database.db
			.select({
				id: userWatchHistory.id,
				userId: userWatchHistory.userId,
				movieId: userWatchHistory.movieId,
			})
			.from(userWatchHistory)
			.all();

		// Delete non-active entries
		let cleared = 0;
		for (const entry of allHistory) {
			if (!activePairs.has(`${entry.userId}:${entry.movieId}`)) {
				this.database.db
					.delete(userWatchHistory)
					.where(eq(userWatchHistory.id, entry.id))
					.run();
				cleared++;
			}
		}

		this.moviesService.invalidateListCache();
		this.logger.log(
			`Cleared ${cleared} session history entries (preserved ${allHistory.length - cleared} active)`,
		);
		return {
			success: true,
			clearedCount: cleared,
			preservedCount: allHistory.length - cleared,
		};
	}

	/**
	 * Remove movies whose files no longer exist on disk.
	 * Movies with zero file records are also removed.
	 */
	@Post('remove-broken-movies')
	@Roles('admin')
	@RequireAction('admin:server')
	async removeBrokenMovies() {
		const allMovies = this.database.db
			.select({ id: movies.id, title: movies.title })
			.from(movies)
			.all();

		const broken: { id: string; title: string }[] = [];

		for (const movie of allMovies) {
			const files = this.database.db
				.select({ id: movieFiles.id, filePath: movieFiles.filePath })
				.from(movieFiles)
				.where(eq(movieFiles.movieId, movie.id))
				.all();

			// No files at all → broken
			if (files.length === 0) {
				broken.push(movie);
				continue;
			}

			// All files missing from disk → broken
			const anyExists = files.some((f) => existsSync(f.filePath));
			if (!anyExists) {
				broken.push(movie);
			}
		}

		this.logger.log(`Found ${broken.length} broken movie(s) out of ${allMovies.length} total`);

		// Purge in background so the request returns quickly
		this.purgeBrokenBatch(broken).catch((err) =>
			this.logger.error(`Broken movie cleanup failed: ${err.message}`),
		);

		return {
			message:
				broken.length > 0
					? `Removing ${broken.length} broken movie(s)`
					: 'No broken movies found',
			removedCount: broken.length,
			removed: broken.map((m) => ({ id: m.id, title: m.title })),
		};
	}

	private async purgeBrokenBatch(brokenMovies: { id: string; title: string }[]) {
		let purged = 0;
		for (const movie of brokenMovies) {
			try {
				await this.moviesService.purgeMovie(movie.id);
				purged++;
				this.logger.log(`Purged broken movie: ${movie.title}`);
			} catch (err: any) {
				this.logger.warn(`Failed to purge ${movie.title}: ${err.message}`);
			}
		}
		this.logger.log(`Broken movie cleanup complete: ${purged}/${brokenMovies.length} purged`);
	}
}
