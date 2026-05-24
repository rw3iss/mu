import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import { PeopleService } from '../people/people.service.js';
import { RecommendationsService } from './recommendations.service.js';
import { TasteProfileService } from './taste-profile.service.js';
import type { DiscoverFilters, IncludeMode } from './types.js';

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
		private readonly people: PeopleService,
		private readonly favorites: FavoritesService,
	) {}

	@RequireAction('view:library')
	@Get()
	async personalized(@CurrentUser() user: { sub: string }, @Query('limit') limit?: string) {
		return this.recs.getPersonalized(user.sub, parseLimit(limit));
	}

	@RequireAction('view:library')
	@Get('similar/:movieId')
	async similar(@Param('movieId') movieId: string, @Query('limit') limit?: string) {
		const response = await this.recs.getSimilarMovies(movieId, { k: parseLimit(limit) });
		// Preserve the historical response shape (a plain array of
		// scored movies) so existing clients keep working.
		return response.results;
	}

	@RequireAction('view:library')
	@Get('similar/:movieId/detail')
	async similarDetailed(@Param('movieId') movieId: string, @Query('limit') limit?: string) {
		return this.recs.getSimilarMovies(movieId, { k: parseLimit(limit) });
	}

	/**
	 * Unified Discover endpoint. Optionally takes a seed (movieId or
	 * movieIds CSV for a collection) and a filter set. Without a seed,
	 * returns personalised recommendations from the user's taste
	 * profile.
	 */
	@RequireAction('view:library')
	@Get('discover')
	async discover(
		@CurrentUser() user: { sub: string },
		@Query('seedMovieId') seedMovieId?: string,
		@Query('seedMovieIds') seedMovieIds?: string,
		@Query('personKeys') personKeys?: string,
		@Query('limit') limit?: string,
		@Query('include') include?: string,
		@Query('useProfile') useProfile?: string,
		@Query('minRating') minRating?: string,
		@Query('minVotes') minVotes?: string,
		@Query('genres') genres?: string,
		@Query('yearFrom') yearFrom?: string,
		@Query('yearTo') yearTo?: string,
		@Query('person') person?: string,
		@Query('language') language?: string,
		@Query('minRuntime') minRuntime?: string,
		@Query('maxRuntime') maxRuntime?: string,
	) {
		const filters = parseFilters({
			minRating,
			minVotes,
			genres,
			yearFrom,
			yearTo,
			person,
			language,
			minRuntime,
			maxRuntime,
		});
		const k = parseLimit(limit);
		const inc = parseInclude(include);
		// Default true (preserves existing behavior). Anything other than
		// the literal string 'false' is treated as truthy.
		const profile = useProfile !== 'false';

		// Resolve `personKeys` to movie ids via the people↔library
		// bridge. Merged with any explicit seedMovieIds so callers
		// can combine "use these people" + "and also this seed film"
		// in a single request.
		const personDerivedIds: string[] = [];
		const unresolvedPersonKeys: string[] = [];
		if (personKeys) {
			const keys = personKeys
				.split(',')
				.map((k) => k.trim())
				.filter(Boolean);
			if (keys.length > 0) {
				const r = await this.people.resolveOwnedMovieIds(keys);
				personDerivedIds.push(...r.movieIds);
				unresolvedPersonKeys.push(...r.unresolvedKeys);
			}
		}

		const explicitIds = seedMovieIds
			? seedMovieIds.split(',').filter(Boolean)
			: seedMovieId
				? [seedMovieId]
				: [];

		const allSeedIds = Array.from(new Set([...explicitIds, ...personDerivedIds]));

		if (allSeedIds.length === 1) {
			const out = await this.recs.getSimilarMovies(allSeedIds[0]!, {
				k,
				filters,
				include: inc,
			});
			return this.augmentWithPersonMeta(out, unresolvedPersonKeys, personDerivedIds);
		}
		if (allSeedIds.length > 1) {
			const out = await this.recs.getMultiInput(allSeedIds, { k, filters, include: inc });
			return this.augmentWithPersonMeta(out, unresolvedPersonKeys, personDerivedIds);
		}

		// `personKeys` provided but resolved to nothing in-library —
		// surface that so the client can prompt the user.
		if (personKeys && allSeedIds.length === 0) {
			return {
				results: [],
				usedSources: [],
				reason: 'no_owned_credits_for_person_keys',
				unresolvedPersonKeys,
			};
		}

		// No seeds. If the user has opted out of taste-profile,
		// fall through to a filter-only "cold" browse instead.
		if (!profile) {
			const cold = await this.recs.getColdDiscover(k, filters, inc);
			return {
				results: cold,
				usedSources: ['cold-discover'],
				reason: cold.length === 0 ? 'no_seeds_no_profile' : undefined,
			};
		}

		// No seeds + useProfile enabled. The legacy path scores library
		// candidates against the user's taste profile, which doesn't
		// work well for `include=notOwned` (external stubs lack the
		// cast / director metadata the profile scorer wants). Promote
		// the user's favorited movies + people into implicit seeds so
		// the standard seed-based pipeline (with external harvest) runs.
		const implicitSeedIds = await this.deriveImplicitSeeds(user.sub);
		if (implicitSeedIds.length > 0) {
			const out =
				implicitSeedIds.length === 1
					? await this.recs.getSimilarMovies(implicitSeedIds[0]!, {
							k,
							filters,
							include: inc,
						})
					: await this.recs.getMultiInput(implicitSeedIds, {
							k,
							filters,
							include: inc,
						});
			return this.augmentWithPersonMeta(
				{
					...out,
					usedSources: ['profile-favorites', ...(out.usedSources ?? [])],
				},
				unresolvedPersonKeys,
				implicitSeedIds,
			);
		}

		// No favorites either — fall back to the original taste-profile
		// scoring path. Works for owned/library; usually empty for
		// notOwned because external stubs lack rich metadata.
		const results = await this.recs.getPersonalized(user.sub, k, filters, inc);
		return {
			results,
			usedSources: ['taste-profile'],
			reason: results.length === 0 ? 'no_signal' : undefined,
		};
	}

	/**
	 * Build implicit seed ids from the signed-in user's favorites so
	 * the no-explicit-seed Discover call still has something to feed
	 * the recommender. Favorited movies count directly; favorited
	 * people resolve to their owned in-library credits.
	 *
	 * Capped at 5 ids — the multi-input scorer's centroid path gets
	 * noisy past that, and we want representativeness, not breadth.
	 */
	private async deriveImplicitSeeds(userId: string): Promise<string[]> {
		const { movieIds, personKeys: favPersonKeys } = this.favorites.listKeys(userId);
		const seeds: string[] = [...movieIds];
		if (favPersonKeys.length > 0 && seeds.length < 5) {
			const { movieIds: peopleIds } =
				await this.people.resolveOwnedMovieIds(favPersonKeys);
			for (const id of peopleIds) {
				if (seeds.includes(id)) continue;
				seeds.push(id);
				if (seeds.length >= 5) break;
			}
		}
		return seeds.slice(0, 5);
	}

	private augmentWithPersonMeta<T>(
		out: T,
		unresolvedPersonKeys: string[],
		personDerivedIds: string[],
	): T & { unresolvedPersonKeys?: string[]; personDerivedSeedIds?: string[] } {
		if (unresolvedPersonKeys.length === 0 && personDerivedIds.length === 0) {
			return out as T & {
				unresolvedPersonKeys?: string[];
				personDerivedSeedIds?: string[];
			};
		}
		return {
			...(out as object),
			...(personDerivedIds.length > 0 ? { personDerivedSeedIds: personDerivedIds } : {}),
			...(unresolvedPersonKeys.length > 0 ? { unresolvedPersonKeys } : {}),
		} as T & { unresolvedPersonKeys?: string[]; personDerivedSeedIds?: string[] };
	}

	@RequireAction('view:library')
	@Post('multi')
	async multi(@Body() body: { movieIds: string[]; limit?: number; mmrLambda?: number }) {
		if (!body?.movieIds || !Array.isArray(body.movieIds) || body.movieIds.length === 0) {
			return { results: [], usedSources: [], reason: 'no_seeds_provided' };
		}
		return this.recs.getMultiInput(body.movieIds, {
			k: body.limit ? Math.min(Math.max(1, body.limit), 100) : 24,
			mmrLambda: body.mmrLambda,
		});
	}

	@RequireAction('view:library')
	@Get('genre/:genre')
	async byGenre(
		@CurrentUser() user: { sub: string },
		@Param('genre') genre: string,
		@Query('limit') limit?: string,
	) {
		return this.recs.getByGenre(genre, user.sub, parseLimit(limit));
	}

	@RequireAction('view:library')
	@Get('trending')
	async trending(@Query('limit') limit?: string) {
		return this.recs.getTrending(parseLimit(limit));
	}

	@RequireAction('view:library')
	@Get('recently-added')
	async recentlyAdded(@Query('limit') limit?: string) {
		return this.recs.getRecentlyAdded(parseLimit(limit));
	}

	@RequireAction('view:own-data')
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

function parseInclude(input?: string): IncludeMode {
	if (input === 'notOwned' || input === 'all') return input;
	return 'owned';
}

function parseFilters(raw: {
	minRating?: string;
	minVotes?: string;
	genres?: string;
	yearFrom?: string;
	yearTo?: string;
	person?: string;
	language?: string;
	minRuntime?: string;
	maxRuntime?: string;
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
		out.genres = raw.genres
			.split(',')
			.map((g) => g.trim())
			.filter(Boolean);
	}
	const yf = num(raw.yearFrom);
	if (yf != null) out.yearFrom = yf;
	const yt = num(raw.yearTo);
	if (yt != null) out.yearTo = yt;
	if (raw.person?.trim()) out.person = raw.person.trim();
	if (raw.language?.trim()) out.language = raw.language.trim();
	const mn = num(raw.minRuntime);
	if (mn != null) out.minRuntime = mn;
	const mx = num(raw.maxRuntime);
	if (mx != null) out.maxRuntime = mx;
	return Object.keys(out).length > 0 ? out : undefined;
}
