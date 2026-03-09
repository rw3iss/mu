import { Controller, Get, Param, Query } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service.js';
import { TasteProfileService } from './taste-profile.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('recommendations')
export class RecommendationsController {
	constructor(
		private readonly recommendations: RecommendationsService,
		private readonly tasteProfile: TasteProfileService,
	) {}

	/**
	 * GET /recommendations
	 * Personalized recommendations for the current user.
	 */
	@Get()
	async getRecommendations(
		@CurrentUser() user: { sub: string; role: string },
		@Query('limit') limit?: string,
	) {
		const parsedLimit = this.parseLimit(limit);
		return this.recommendations.getRecommendations(user.sub, parsedLimit);
	}

	/**
	 * GET /recommendations/similar/:movieId
	 * Find movies similar to the given movie.
	 */
	@Get('similar/:movieId')
	async getSimilarMovies(@Param('movieId') movieId: string, @Query('limit') limit?: string) {
		const parsedLimit = this.parseLimit(limit);
		return this.recommendations.getSimilarMovies(movieId, parsedLimit);
	}

	/**
	 * GET /recommendations/genre/:genre
	 * Top movies in a genre the user hasn't seen.
	 */
	@Get('genre/:genre')
	async getGenreRecommendations(
		@CurrentUser() user: { sub: string; role: string },
		@Param('genre') genre: string,
		@Query('limit') limit?: string,
	) {
		const parsedLimit = this.parseLimit(limit);
		return this.recommendations.getGenreRecommendations(genre, user.sub, parsedLimit);
	}

	/**
	 * GET /recommendations/trending
	 * Trending movies (most watched/rated in last 30 days).
	 */
	@Get('trending')
	async getTrendingMovies(@Query('limit') limit?: string) {
		const parsedLimit = this.parseLimit(limit);
		return this.recommendations.getTrendingMovies(parsedLimit);
	}

	/**
	 * GET /recommendations/recently-added
	 * Recently added movies.
	 */
	@Get('recently-added')
	async getRecentlyAdded(@Query('limit') limit?: string) {
		const parsedLimit = this.parseLimit(limit);
		return this.recommendations.getRecentlyAdded(parsedLimit);
	}

	/**
	 * GET /recommendations/profile
	 * The current user's taste profile.
	 */
	@Get('profile')
	async getTasteProfile(@CurrentUser() user: { sub: string; role: string }) {
		return this.tasteProfile.buildProfile(user.sub);
	}

	/**
	 * Parse the limit query parameter with a default of 24 and
	 * a maximum of 100.
	 */
	private parseLimit(limit?: string): number {
		if (!limit) return 24;
		const parsed = parseInt(limit, 10);
		if (Number.isNaN(parsed) || parsed < 1) return 24;
		return Math.min(parsed, 100);
	}
}
