import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RecommendationsService } from './recommendations.service.js';
import { TasteProfileService } from './taste-profile.service.js';

/**
 * URLs preserved from the previous implementation for backwards
 * compat with the existing client. New endpoint `/multi` is stubbed
 * here and powered by the same orchestrator for multi-seed input.
 */
@Controller('recommendations')
export class RecommendationsController {
	constructor(
		private readonly recs: RecommendationsService,
		private readonly tasteProfile: TasteProfileService,
	) {}

	@Get()
	async personalized(
		@CurrentUser() user: { sub: string },
		@Query('limit') limit?: string,
	) {
		return this.recs.getPersonalized(user.sub, parseLimit(limit));
	}

	@Get('similar/:movieId')
	async similar(@Param('movieId') movieId: string, @Query('limit') limit?: string) {
		const response = await this.recs.getSimilarMovies(movieId, { k: parseLimit(limit) });
		// Preserve the historical response shape (a plain array of
		// scored movies) so existing clients keep working.
		return response.results;
	}

	@Get('similar/:movieId/detail')
	async similarDetailed(
		@Param('movieId') movieId: string,
		@Query('limit') limit?: string,
	) {
		return this.recs.getSimilarMovies(movieId, { k: parseLimit(limit) });
	}

	@Post('multi')
	async multi(
		@Body() body: { movieIds: string[]; limit?: number; mmrLambda?: number },
	) {
		if (!body?.movieIds || !Array.isArray(body.movieIds) || body.movieIds.length === 0) {
			return { results: [], usedSources: [], reason: 'no_seeds_provided' };
		}
		return this.recs.getMultiInput(body.movieIds, {
			k: body.limit ? Math.min(Math.max(1, body.limit), 100) : 24,
			mmrLambda: body.mmrLambda,
		});
	}

	@Get('genre/:genre')
	async byGenre(
		@CurrentUser() user: { sub: string },
		@Param('genre') genre: string,
		@Query('limit') limit?: string,
	) {
		return this.recs.getByGenre(genre, user.sub, parseLimit(limit));
	}

	@Get('trending')
	async trending(@Query('limit') limit?: string) {
		return this.recs.getTrending(parseLimit(limit));
	}

	@Get('recently-added')
	async recentlyAdded(@Query('limit') limit?: string) {
		return this.recs.getRecentlyAdded(parseLimit(limit));
	}

	@Get('profile')
	async profile(@CurrentUser() user: { sub: string }) {
		return this.tasteProfile.buildProfile(user.sub);
	}
}

function parseLimit(input?: string): number {
	if (!input) return 24;
	const n = parseInt(input, 10);
	if (Number.isNaN(n) || n < 1) return 24;
	return Math.min(n, 100);
}
