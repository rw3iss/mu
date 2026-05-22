import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { OmdbProvider } from '../metadata/providers/omdb.provider.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { MoviesService } from '../movies/movies.service.js';
import { TraktSearchProvider } from '../providers/sources/trakt/trakt-search.provider.js';
import { mergeMovieHit, movieDedupKey, scoreMovie } from './dedup.js';
import { SearchCacheService } from './search-cache.service.js';
import type {
	MovieSearchHit,
	SearchEvent,
	SearchSource,
} from './search-types.js';

const SOURCE_TIMEOUT_MS = 5000;

/**
 * Federated movie search orchestrator. Phase 1 wires local + TMDB.
 * Phase 3 will add OMDB + Trakt at the additional-source seam below.
 */
@Injectable()
export class FederatedMovieSearchService {
	private readonly logger = new Logger('FederatedMovieSearch');

	constructor(
		private readonly movies: MoviesService,
		private readonly tmdb: TmdbProvider,
		private readonly cache: SearchCacheService,
		private readonly omdb: OmdbProvider,
		private readonly trakt: TraktSearchProvider,
	) {}

	search$(query: string, userId: string): Observable<SearchEvent<MovieSearchHit>> {
		return new Observable((subscriber) => {
			const hitsByKey = new Map<string, MovieSearchHit>();
			const sourcesQueried: SearchSource[] = [];
			let cancelled = false;

			const emitResults = (source: SearchSource, items: MovieSearchHit[]) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				const merged: MovieSearchHit[] = [];
				for (const item of items) {
					const key = movieDedupKey(item);
					const existing = hitsByKey.get(key);
					const next = existing ? mergeMovieHit(existing, item) : item;
					hitsByKey.set(key, next);
					merged.push(next);
				}
				subscriber.next({ kind: 'results', source, items: merged });
			};

			const emitError = (source: SearchSource, message: string) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				subscriber.next({ kind: 'error', source, message });
			};

			const withTimeout = <T>(p: Promise<T>, source: SearchSource): Promise<T | null> =>
				Promise.race([
					p,
					new Promise<T>((_, reject) =>
						setTimeout(
							() => reject(new Error(`${source} timed out after ${SOURCE_TIMEOUT_MS}ms`)),
							SOURCE_TIMEOUT_MS,
						),
					),
				]).catch((err) => {
					emitError(source, err instanceof Error ? err.message : String(err));
					return null;
				});

			(async () => {
				// 1) Local DB — synchronous-ish, fast path
				try {
					const local = await this.movies.searchForFederation(query, userId);
					if (local.length) {
						const scored = local.map((h) => ({ ...h, matchScore: scoreMovie(query, h) }));
						emitResults('local', scored);
					}
				} catch (e: any) {
					emitError('local', e?.message ?? String(e));
				}

				// 2) External sources in parallel
				await Promise.all([
					this.runTmdb(query, withTimeout, emitResults),
					this.runOmdb(query, withTimeout, emitResults),
					this.runTrakt(query, withTimeout, emitResults),
				]);

				if (!cancelled) {
					subscriber.next({ kind: 'done', sourcesQueried });
					subscriber.complete();
				}
			})();

			return () => {
				cancelled = true;
			};
		});
	}

	private async runTmdb(
		query: string,
		withTimeout: <T>(p: Promise<T>, s: SearchSource) => Promise<T | null>,
		emit: (s: SearchSource, items: MovieSearchHit[]) => void,
	) {
		const cached = this.cache.get<MovieSearchHit>('movie', query, 'tmdb');
		if (cached) {
			emit('cache', cached);
			return;
		}
		const raw = await withTimeout(this.tmdb.searchMovie(query), 'tmdb');
		if (!raw) return;
		const hits = raw.map((r) => this.normalizeTmdb(query, r));
		emit('tmdb', hits);
		this.cache.set('movie', query, 'tmdb', hits);
	}

	private async runOmdb(
		query: string,
		withTimeout: <T>(p: Promise<T>, s: SearchSource) => Promise<T | null>,
		emit: (s: SearchSource, items: MovieSearchHit[]) => void,
	) {
		const cached = this.cache.get<MovieSearchHit>('movie', query, 'omdb');
		if (cached) {
			emit('cache', cached);
			return;
		}
		const raw = await withTimeout(this.omdb.searchMovies(query), 'omdb');
		if (!raw || raw.length === 0) return;
		const hits = raw.map((r): MovieSearchHit => {
			const hit: MovieSearchHit = {
				imdbId: r.imdbId,
				title: r.title,
				year: r.year,
				posterUrl: r.posterUrl,
				sources: ['omdb'],
				isOwned: false,
				matchScore: 0,
			};
			hit.matchScore = scoreMovie(query, hit);
			return hit;
		});
		emit('omdb', hits);
		this.cache.set('movie', query, 'omdb', hits);
	}

	private async runTrakt(
		query: string,
		withTimeout: <T>(p: Promise<T>, s: SearchSource) => Promise<T | null>,
		emit: (s: SearchSource, items: MovieSearchHit[]) => void,
	) {
		const cached = this.cache.get<MovieSearchHit>('movie', query, 'trakt');
		if (cached) {
			emit('cache', cached);
			return;
		}
		const raw = await withTimeout(this.trakt.searchMovies(query), 'trakt');
		if (!raw || raw.length === 0) return;
		const hits = raw.map((r): MovieSearchHit => {
			const hit: MovieSearchHit = {
				traktId: r.traktId,
				tmdbId: r.tmdbId,
				imdbId: r.imdbId,
				title: r.title,
				year: r.year,
				sources: ['trakt'],
				isOwned: false,
				matchScore: 0,
			};
			hit.matchScore = scoreMovie(query, hit);
			return hit;
		});
		emit('trakt', hits);
		this.cache.set('movie', query, 'trakt', hits);
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
