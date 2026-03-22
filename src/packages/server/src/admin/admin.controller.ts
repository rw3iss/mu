import { Controller, Delete, Logger, Param, Post } from '@nestjs/common';
import { isNull } from 'drizzle-orm';
import { Roles } from '../common/decorators/roles.decorator.js';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { StreamService } from '../stream/stream.service.js';

@Controller('admin')
export class AdminController {
	private readonly logger = new Logger('AdminController');

	constructor(
		private readonly database: DatabaseService,
		private readonly streamService: StreamService,
		private readonly thumbnailService: ThumbnailService,
		private readonly guidResolver: GuidResolverService,
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
				this.logger.warn(`Thumbnail failed for movie ${this.guidResolver.resolve(movieId)}: ${err.message}`);
			}
		}

		this.logger.log(
			`Thumbnail batch complete: ${generated} generated, ${failed} failed out of ${movieIds.length}`,
		);
	}
}
