import { describe, expect, it } from 'vitest';
import { mmr } from '../scoring/mmr.js';
import type { MovieWithMetadata, ScoredMovie } from '../types.js';

function m(id: string, genres: string[]): MovieWithMetadata {
	return {
		id,
		title: id,
		year: 2020,
		posterUrl: null,
		overview: null,
		runtimeMinutes: null,
		tmdbId: null,
		imdbId: null,
		hidden: false,
		groupId: null,
		source: "library" as const,

		addedAt: '2026-01-01',
		genres,
		cast: [],
		directors: [],
		keywords: [],
		companies: [],
		tmdbRating: null,
		imdbRating: null,
		tmdbVotes: null,
	};
}

function s(id: string, score: number): ScoredMovie {
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

describe('mmr', () => {
	it('reproduces input order when lambda = 1', () => {
		const movies = new Map([
			['a', m('a', ['X'])],
			['b', m('b', ['X'])],
			['c', m('c', ['Y'])],
		]);
		const scored = [s('a', 0.9), s('b', 0.8), s('c', 0.5)];
		const out = mmr(scored, movies, 1, 3);
		expect(out.map((x) => x.movieId)).toEqual(['a', 'b', 'c']);
	});

	it('introduces diversity when lambda is lower', () => {
		// a and b are near-identical; c is different.
		const movies = new Map([
			['a', m('a', ['X', 'Y'])],
			['b', m('b', ['X', 'Y'])],
			['c', m('c', ['Z'])],
		]);
		const scored = [s('a', 0.9), s('b', 0.85), s('c', 0.5)];
		const out = mmr(scored, movies, 0.3, 3);
		expect(out[0]!.movieId).toBe('a');
		// With diversity weight, c should beat b for slot 2
		expect(out[1]!.movieId).toBe('c');
		expect(out[2]!.movieId).toBe('b');
	});

	it('returns k items when fewer than k are available', () => {
		const movies = new Map([['a', m('a', ['X'])]]);
		const out = mmr([s('a', 1)], movies, 0.7, 5);
		expect(out).toHaveLength(1);
	});

	it('returns empty for empty input', () => {
		expect(mmr([], new Map(), 0.7, 5)).toEqual([]);
	});
});
