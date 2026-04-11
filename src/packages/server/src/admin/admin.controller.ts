import { existsSync } from 'node:fs';
import { Controller, Delete, Logger, Param, Post } from '@nestjs/common';
import { eq, isNull } from 'drizzle-orm';
import { Roles } from '../common/decorators/roles.decorator.js';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies } from '../database/schema/index.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { MoviesService } from '../movies/movies.service.js';
import { StreamService } from '../stream/stream.service.js';

@Controller('admin')
export class AdminController {
	private readonly logger = new Logger('AdminController');

	constructor(
		private readonly database: DatabaseService,
		private readonly streamService: StreamService,
		private readonly thumbnailService: ThumbnailService,
		private readonly guidResolver: GuidResolverService,
		private readonly moviesService: MoviesService,
	) {}

	/**
	 * Generate thumbnails for all movies that don't have one.
	 */
	@Post('generate-missing-thumbnails')
	@Roles('admin')
	async generateMissingThumbnails() {
		const moviesWithoutThumbnails = this.database.db
			.select({ id: movies.id })
			.from(movies)
			.where(isNull(movies.thumbnailUrl))
			.all();

		const count = moviesWithoutThumbnails.length;
		this.logger.log(`Starting thumbnail generation for ${count} movies`);

		// Run in background so the request returns immediately
		this.generateThumbnailsBatch(moviesWithoutThumbnails.map((m) => m.id)).catch((err) =>
			this.logger.error(`Thumbnail batch failed: ${err.message}`),
		);

		return { message: 'Thumbnail generation started', movieCount: count };
	}

	/**
	 * Fix broken thumbnails — movies that have a thumbnail URL in the DB
	 * but the actual image file is missing on disk.
	 */
	@Post('fix-broken-thumbnails')
	@Roles('admin')
	async fixBrokenThumbnails() {
		const brokenIds = this.thumbnailService.getBrokenThumbnailMovieIds();
		const count = brokenIds.length;
		this.logger.log(`Found ${count} movies with broken thumbnails, regenerating...`);

		if (count > 0) {
			this.generateThumbnailsBatch(brokenIds).catch((err) =>
				this.logger.error(`Broken thumbnail fix failed: ${err.message}`),
			);
		}

		return {
			message:
				count > 0
					? `Regenerating ${count} broken thumbnail(s)`
					: 'No broken thumbnails found',
			movieCount: count,
		};
	}

	/**
	 * End a specific streaming session.
	 */
	@Delete('sessions/:sessionId')
	@Roles('admin')
	async endSession(@Param('sessionId') sessionId: string) {
		await this.streamService.endStream(sessionId);
		return { success: true };
	}

	/**
	 * End all streaming sessions except the current user's sessions.
	 */
	@Delete('sessions')
	@Roles('admin')
	async endAllSessions() {
		const ended = await this.streamService.endAllSessions();
		return { success: true, endedCount: ended };
	}

	/**
	 * Remove movies whose files no longer exist on disk.
	 * Movies with zero file records are also removed.
	 */
	@Post('remove-broken-movies')
	@Roles('admin')
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

	private async generateThumbnailsBatch(movieIds: string[]) {
		let generated = 0;
		let failed = 0;

		for (const movieId of movieIds) {
			try {
				const result = await this.thumbnailService.generateForMovie(movieId);
				if (result) {
					generated++;
				} else {
					failed++;
				}
			} catch (err: any) {
				failed++;
				this.logger.warn(
					`Thumbnail failed for movie ${this.guidResolver.resolve(movieId)}: ${err.message}`,
				);
			}
		}

		this.logger.log(
			`Thumbnail batch complete: ${generated} generated, ${failed} failed out of ${movieIds.length}`,
		);
	}
}
