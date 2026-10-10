import { Injectable, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { LocalImdbSearchService } from '../imdb-datasets/local-imdb-search.service.js';
import { OmdbProvider } from '../metadata/providers/omdb.provider.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { MoviesService } from '../movies/movies.service.js';
import { TraktSearchProvider } from '../providers/sources/trakt/trakt-search.provider.js';
import { mergeMovieHit, movieDedupKey, scoreMovie } from './dedup.js';
import { type FederatedSearchSource, runFederatedSearch } from './federated-search.orchestrator.js';
import { SearchCacheService } from './search-cache.service.js';
import { SearchSourceRegistry } from './search-source.registry.js';
import type { MovieSearchHit, SearchEvent } from './search-types.js';

/**
 * Federated movie search. Sources are declared in {@link builtinSources} and
 * registered in the {@link SearchSourceRegistry} (capability list); the shared
 * {@link runFederatedSearch} orchestrator handles order, timeouts, cache and
 * dedup. Other modules can add movie sources via `registry.register('movie', …)`.
 */
@Injectable()
export class FederatedMovieSearchService {
	private readonly registry: SearchSourceRegistry;

	constructor(
		private readonly movies: MoviesService,
		private readonly tmdb: TmdbProvider,
		private readonly cache: SearchCacheService,
		private readonly omdb: OmdbProvider,
		private readonly trakt: TraktSearchProvider,
		private readonly localImdb: LocalImdbSearchService,
		@Optional() registry?: SearchSourceRegistry,
	) {
		this.registry = registry ?? new SearchSourceRegistry();
		for (const src of this.builtinSources()) this.registry.register('movie', src);
	}

	search$(query: string, userId: string): Observable<SearchEvent<MovieSearchHit>> {
		return runFederatedSearch(query, { userId }, this.registry.list('movie'), {
			dedupKeys: (h) => [movieDedupKey(h)],
			merge: mergeMovieHit,
			cache: this.cache,
		});
	}

	private scored(query: string, hit: MovieSearchHit): MovieSearchHit {
		hit.matchScore = scoreMovie(query, hit);
		return hit;
	}

	private builtinSources(): FederatedSearchSource<MovieSearchHit>[] {
		return [
			{
				// Local DB — fast path, never cached.
				id: 'local',
				phase: 'local',
				run: async (query, ctx) =>
					(await this.movies.searchForFederation(query, ctx.userId ?? 'anonymous')).map(
						(h) => ({ ...h, matchScore: scoreMovie(query, h) }),
					),
			},
			{
				// Local IMDB catalog — instant offline source (if synced).
				id: 'imdb',
				phase: 'local',
				run: (query) =>
					this.localImdb.search(query, 15).map((h) =>
						this.scored(query, {
							imdbId: h.imdbId,
							title: h.title,
							year: h.year ?? undefined,
							imdbRating: h.rating ?? undefined,
							imdbVotes: h.votes ?? undefined,
							sources: ['imdb'],
							isOwned: false,
							matchScore: 0,
						}),
					),
			},
			{
				id: 'tmdb',
				phase: 'external',
				cache: { type: 'movie', source: 'tmdb' },
				keepEmpty: true,
				run: async (query) =>
					(await this.tmdb.searchMovie(query))?.map((r: any) =>
						this.normalizeTmdb(query, r),
					) ?? null,
			},
			{
				id: 'omdb',
				phase: 'external',
				cache: { type: 'movie', source: 'omdb' },
				run: async (query) =>
					((await this.omdb.searchMovies(query)) ?? []).map((r) =>
						this.scored(query, {
							imdbId: r.imdbId,
							title: r.title,
							year: r.year,
							posterUrl: r.posterUrl,
							sources: ['omdb'],
							isOwned: false,
							matchScore: 0,
						}),
					),
			},
			{
				id: 'trakt',
				phase: 'external',
				cache: { type: 'movie', source: 'trakt' },
				run: async (query) =>
					((await this.trakt.searchMovies(query)) ?? []).map((r) =>
						this.scored(query, {
							traktId: r.traktId,
							tmdbId: r.tmdbId,
							imdbId: r.imdbId,
							title: r.title,
							year: r.year,
							sources: ['trakt'],
							isOwned: false,
							matchScore: 0,
						}),
					),
			},
		];
	}

	private normalizeTmdb(query: string, r: any): MovieSearchHit {
		const yearStr = r.release_date ? String(r.release_date).slice(0, 4) : undefined;
		const yearNum = yearStr ? Number.parseInt(yearStr, 10) : undefined;
		const ratingNum = typeof r.vote_average === 'number' ? r.vote_average : undefined;
		const votesNum = typeof r.vote_count === 'number' ? r.vote_count : undefined;
		const hit: MovieSearchHit = {
			tmdbId: r.id,
			title: r.title,
			year: Number.isFinite(yearNum) ? yearNum : undefined,
			posterUrl: r.poster_path
				? `https://image.tmdb.org/t/p/w185${r.poster_path}`
				: undefined,
			overview: r.overview ? String(r.overview).slice(0, 200) : undefined,
			tmdbRating: ratingNum && ratingNum > 0 ? Math.round(ratingNum * 10) / 10 : undefined,
			tmdbVotes: votesNum && votesNum > 0 ? votesNum : undefined,
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0,
		};
		hit.matchScore = scoreMovie(query, hit);
		return hit;
	}
}
