import { describe, expect, it } from 'vitest';
import { applyFilters, type FilterContext } from '../scoring/filters.js';
import type { MovieWithMetadata, ScoredMovie } from '../types.js';

function m(over: Partial<MovieWithMetadata> & { id: string }): MovieWithMetadata {
	return {
		id: over.id,
		title: over.id,
		year: 2020,
		posterUrl: null,
		overview: null,
		runtimeMinutes: null,
		tmdbId: null,
		imdbId: null,
		hidden: over.hidden ?? false,
		groupId: over.groupId ?? null,
		addedAt: '2026-01-01',
		genres: [],
		cast: [],
		directors: over.directors ?? [],
		keywords: [],
		companies: [],
		tmdbRating: over.tmdbRating ?? null,
		imdbRating: over.imdbRating ?? null,
	};
}

function s(id: string, score = 0.5): ScoredMovie {
	return {
		movieId: id,
		title: id,
		year: 2020,
		score,
		explanation: [],
		posterUrl: null,
		usedSources: [],
	};
}

function ctx(over: Partial<FilterContext>): FilterContext {
	return {
		seed: m({ id: 'seed' }),
		moviesById: new Map(),
		excludeMovieIds: new Set(),
		watchedMovieIds: new Set(),
		excludeWatched: false,
		excludeSameGroup: true,
		qualityFloor: 0,
		perDirectorCap: 0,
		...over,
	};
}

describe('applyFilters', () => {
	it('excludes hidden movies', () => {
		const c = ctx({
			moviesById: new Map([['a', m({ id: 'a', hidden: true })]]),
		});
		const out = applyFilters([s('a')], c);
		expect(out).toHaveLength(0);
	});

	it('excludes the seed itself', () => {
		const c = ctx({
			seed: m({ id: 'a' }),
			moviesById: new Map([['a', m({ id: 'a' })]]),
		});
		const out = applyFilters([s('a')], c);
		expect(out).toHaveLength(0);
	});

	it('excludes same-group when option set', () => {
		const c = ctx({
			seed: m({ id: 'seed', groupId: 'g1' }),
			moviesById: new Map([['a', m({ id: 'a', groupId: 'g1' })]]),
		});
		const out = applyFilters([s('a')], c);
		expect(out).toHaveLength(0);
	});

	it('keeps same-group when option off', () => {
		const c = ctx({
			seed: m({ id: 'seed', groupId: 'g1' }),
			moviesById: new Map([['a', m({ id: 'a', groupId: 'g1' })]]),
			excludeSameGroup: false,
		});
		const out = applyFilters([s('a')], c);
		expect(out).toHaveLength(1);
	});

	it('excludes already-watched when option set', () => {
		const c = ctx({
			moviesById: new Map([['a', m({ id: 'a' })]]),
			watchedMovieIds: new Set(['a']),
			excludeWatched: true,
		});
		const out = applyFilters([s('a')], c);
		expect(out).toHaveLength(0);
	});

	it('enforces quality floor', () => {
		const c = ctx({
			moviesById: new Map([
				['low', m({ id: 'low', tmdbRating: 4 })],
				['high', m({ id: 'high', tmdbRating: 8 })],
			]),
			qualityFloor: 6,
		});
		const out = applyFilters([s('low'), s('high')], c);
		expect(out.map((x) => x.movieId)).toEqual(['high']);
	});

	it('caps results per director', () => {
		const c = ctx({
			moviesById: new Map([
				['a', m({ id: 'a', directors: ['Wes Anderson'] })],
				['b', m({ id: 'b', directors: ['Wes Anderson'] })],
				['c', m({ id: 'c', directors: ['Wes Anderson'] })],
				['d', m({ id: 'd', directors: ['Other'] })],
			]),
			perDirectorCap: 2,
		});
		const out = applyFilters([s('a', 0.9), s('b', 0.8), s('c', 0.7), s('d', 0.6)], c);
		expect(out.map((x) => x.movieId)).toEqual(['a', 'b', 'd']);
	});

	it('respects explicit excludeMovieIds', () => {
		const c = ctx({
			moviesById: new Map([['a', m({ id: 'a' })]]),
			excludeMovieIds: new Set(['a']),
		});
		expect(applyFilters([s('a')], c)).toHaveLength(0);
	});
});
