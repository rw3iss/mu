import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RecommendationsService } from './recommendations.service.js';
import { TasteProfileService } from './taste-profile.service.js';
import type { DiscoverFilters } from './types.js';

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

	/**
	 * Unified Discover endpoint. Optionally takes a seed (movieId or
	 * movieIds CSV for a collection) and a filter set. Without a seed,
	 * returns personalised recommendations from the user's taste
	 * profile.
	 */
	@Get('discover')
	async discover(
		@CurrentUser() user: { sub: string },
		@Query('seedMovieId') seedMovieId?: string,
		@Query('seedMovieIds') seedMovieIds?: string,
		@Query('limit') limit?: string,
		@Query('minRating') minRating?: string,
		@Query('minVotes') minVotes?: string,
		@Query('genres') genres?: string,
		@Query('yearFrom') yearFrom?: string,
		@Query('yearTo') yearTo?: string,
		@Query('person') person?: string,
		@Query('language') language?: string,
	) {
		const filters = parseFilters({
			minRating,
			minVotes,
			genres,
			yearFrom,
			yearTo,
			person,
			language,
		});
		const k = parseLimit(limit);

		if (seedMovieIds) {
			const ids = seedMovieIds.split(',').filter(Boolean);
			if (ids.length === 1) {
				return this.recs.getSimilarMovies(ids[0]!, { k, filters });
			}
			if (ids.length > 1) {
				return this.recs.getMultiInput(ids, { k, filters });
			}
		}
		if (seedMovieId) {
			return this.recs.getSimilarMovies(seedMovieId, { k, filters });
		}
		const results = await this.recs.getPersonalized(user.sub, k, filters);
		return {
			results,
			usedSources: ['taste-profile'],
			reason: results.length === 0 ? 'no_signal' : undefined,
		};
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

function parseFilters(raw: {
	minRating?: string;
	minVotes?: string;
	genres?: string;
	yearFrom?: string;
	yearTo?: string;
	person?: string;
	language?: string;
}): DiscoverFilters | undefined {
	const out: DiscoverFilters = {};
	const num = (s: string | undefined) => {
		if (!s) return undefined;
		const n = Number(s);
		return Number.isFinite(n) ? n : undefined;
	};
	const r = num(raw.minRating);
	if (r != null) out.minRating = r;
	const v = num(raw.minVotes);
	if (v != null) out.minVotes = v;
	if (raw.genres) {
		out.genres = raw.genres.split(',').map((g) => g.trim()).filter(Boolean);
	}
	const yf = num(raw.yearFrom);
	if (yf != null) out.yearFrom = yf;
	const yt = num(raw.yearTo);
	if (yt != null) out.yearTo = yt;
	if (raw.person?.trim()) out.person = raw.person.trim();
	if (raw.language?.trim()) out.language = raw.language.trim();
	return Object.keys(out).length > 0 ? out : undefined;
}
