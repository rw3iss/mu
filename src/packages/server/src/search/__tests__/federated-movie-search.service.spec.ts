import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { FederatedMovieSearchService } from '../federated-movie-search.service.js';
import type { MovieSearchHit, SearchEvent } from '../search-types.js';

function mkLocal(rows: Array<Partial<MovieSearchHit>> = []) {
	return { searchForFederation: vi.fn().mockResolvedValue(rows) };
}
function mkTmdb(rows: any[] = []) {
	return { searchMovie: vi.fn().mockResolvedValue(rows) };
}
function mkCache() {
	return { get: vi.fn().mockReturnValue(null), set: vi.fn() };
}

async function collect(
	svc: FederatedMovieSearchService,
	q: string,
): Promise<SearchEvent<MovieSearchHit>[]> {
	return (await lastValueFrom(svc.search$(q, 'user-1').pipe(toArray()))) as SearchEvent<MovieSearchHit>[];
}

describe('FederatedMovieSearchService', () => {
	let local: any;
	let tmdb: any;
	let cache: any;
	let svc: FederatedMovieSearchService;

	let omdb: any;
	let trakt: any;

	beforeEach(() => {
		local = mkLocal();
		tmdb = mkTmdb();
		cache = mkCache();
		omdb = { searchMovies: vi.fn().mockResolvedValue([]) };
		trakt = { searchMovies: vi.fn().mockResolvedValue([]) };
		svc = new FederatedMovieSearchService(local, tmdb, cache, omdb, trakt);
	});

	it('emits local results first then tmdb then done', async () => {
		local.searchForFederation.mockResolvedValue([
			{
				movieId: 'lib1',
				title: 'Local Hit',
				isOwned: true,
				sources: ['local'],
				matchScore: 0,
			},
		]);
		tmdb.searchMovie.mockResolvedValue([
			{ id: 1, title: 'TMDB Hit', release_date: '1999-03-30' },
		]);
		const events = await collect(svc, 'matrix');
		const sources = events.map((e) => (e.kind === 'results' ? e.source : e.kind));
		expect(sources[0]).toBe('local');
		expect(sources).toContain('tmdb');
		expect(sources[sources.length - 1]).toBe('done');
	});

	it('uses cache when present and skips upstream', async () => {
		cache.get.mockReturnValue([
			{
				tmdbId: 1,
				title: 'Cached',
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.85,
			},
		]);
		const events = await collect(svc, 'matrix');
		expect(tmdb.searchMovie).not.toHaveBeenCalled();
		const resultSources = events
			.filter((e) => e.kind === 'results')
			.map((e: any) => e.source);
		expect(resultSources).toContain('cache');
	});

	it('continues when tmdb errors', async () => {
		tmdb.searchMovie.mockRejectedValue(new Error('rate limited'));
		const events = await collect(svc, 'matrix');
		const errored = events.find((e) => e.kind === 'error');
		const done = events.find((e) => e.kind === 'done');
		expect(errored).toBeTruthy();
		expect(done).toBeTruthy();
	});

	it('persists fresh upstream results to cache', async () => {
		tmdb.searchMovie.mockResolvedValue([
			{ id: 1, title: 'Matrix', release_date: '1999-01-01' },
		]);
		await collect(svc, 'matrix');
		expect(cache.set).toHaveBeenCalledWith('movie', 'matrix', 'tmdb', expect.any(Array));
	});

	it('emits omdb results when omdb.searchMovies returns hits', async () => {
		omdb.searchMovies.mockResolvedValue([
			{ imdbId: 'tt1', title: 'OMDB Hit', year: 1999 },
		]);
		const events = await collect(svc, 'matrix');
		const sources = events
			.filter((e) => e.kind === 'results')
			.map((e: any) => e.source);
		expect(sources).toContain('omdb');
	});

	it('emits trakt results when trakt.searchMovies returns hits', async () => {
		trakt.searchMovies.mockResolvedValue([
			{ traktId: 1, tmdbId: 2, imdbId: 'tt2', title: 'Trakt Hit', year: 2001 },
		]);
		const events = await collect(svc, 'matrix');
		const sources = events
			.filter((e) => e.kind === 'results')
			.map((e: any) => e.source);
		expect(sources).toContain('trakt');
	});

	it('merges hits across sources by tmdbId', async () => {
		local.searchForFederation.mockResolvedValue([
			{
				movieId: 'lib1',
				tmdbId: 603,
				title: 'The Matrix',
				isOwned: true,
				sources: ['local'],
				matchScore: 1,
			},
		]);
		tmdb.searchMovie.mockResolvedValue([
			{ id: 603, title: 'The Matrix', overview: 'Plot', release_date: '1999-03-31' },
		]);
		const events = await collect(svc, 'matrix');
		const last = events.filter((e) => e.kind === 'results').pop() as any;
		// The TMDB emit re-emits the merged item — single hit with both sources.
		expect(last.items[0].sources).toEqual(['local', 'tmdb']);
		expect(last.items[0].isOwned).toBe(true);
		expect(last.items[0].overview).toBe('Plot');
	});
});
