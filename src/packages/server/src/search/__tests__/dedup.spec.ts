import { describe, expect, it } from 'vitest';
import {
	mergeMovieHit,
	mergePersonHit,
	movieDedupKey,
	normalizeQuery,
	personDedupKey,
	scoreMovie,
	scorePerson,
} from '../dedup.js';
import type { MovieSearchHit, PersonSearchHit } from '../search-types.js';

describe('normalizeQuery', () => {
	it('lowercases, trims, collapses whitespace', () => {
		expect(normalizeQuery('  The   Matrix  ')).toBe('the matrix');
	});
});

describe('movieDedupKey', () => {
	it('prefers imdbId', () => {
		expect(
			movieDedupKey({
				title: 'X',
				imdbId: 'tt1',
				tmdbId: 99,
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.5,
			}),
		).toBe('imdb:tt1');
	});
	it('falls back to tmdbId', () => {
		expect(
			movieDedupKey({
				title: 'X',
				tmdbId: 42,
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.5,
			}),
		).toBe('tmdb:42');
	});
	it('falls back to title+year slug', () => {
		expect(
			movieDedupKey({
				title: 'The Matrix',
				year: 1999,
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.5,
			}),
		).toBe('slug:the-matrix|1999');
	});
});

describe('personDedupKey', () => {
	it('prefers tmdbId', () => {
		expect(
			personDedupKey({
				name: 'X',
				personKey: 'name:x',
				tmdbId: 7,
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.5,
			}),
		).toBe('tmdb:7');
	});
	it('falls back to personKey', () => {
		expect(
			personDedupKey({
				name: 'X',
				personKey: 'name:x',
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.5,
			}),
		).toBe('key:name:x');
	});
});

describe('mergeMovieHit', () => {
	const base: MovieSearchHit = {
		tmdbId: 1,
		title: 'X',
		sources: ['tmdb'],
		isOwned: false,
		matchScore: 0.7,
	};
	it('unions sources, keeps highest score, prefers populated fields', () => {
		const next: MovieSearchHit = {
			tmdbId: 1,
			title: 'X',
			sources: ['omdb'],
			isOwned: false,
			matchScore: 0.9,
			imdbId: 'tt1',
			overview: 'Plot.',
		};
		const merged = mergeMovieHit(base, next);
		expect(merged.sources).toEqual(['tmdb', 'omdb']);
		expect(merged.matchScore).toBe(0.9);
		expect(merged.imdbId).toBe('tt1');
		expect(merged.overview).toBe('Plot.');
	});
});

describe('mergePersonHit', () => {
	it('unions sources, prefers populated fields', () => {
		const a: PersonSearchHit = {
			personKey: 'tmdb:1',
			tmdbId: 1,
			name: 'Bob',
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0.7,
		};
		const b: PersonSearchHit = {
			personKey: 'tmdb:1',
			tmdbId: 1,
			name: 'Bob',
			profileUrl: 'http://p',
			sources: ['trakt'],
			isOwned: false,
			matchScore: 0.6,
		};
		const merged = mergePersonHit(a, b);
		expect(merged.sources).toEqual(['tmdb', 'trakt']);
		expect(merged.profileUrl).toBe('http://p');
	});
});

describe('scoreMovie', () => {
	it('exact title match scores higher than partial', () => {
		const exact = scoreMovie('matrix', {
			title: 'Matrix',
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0,
		});
		const partial = scoreMovie('matrix', {
			title: 'Matrix Reloaded',
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0,
		});
		expect(exact).toBeGreaterThan(partial);
	});
});

describe('scorePerson', () => {
	it('exact name match scores higher than partial', () => {
		const exact = scorePerson('cleese', {
			name: 'Cleese',
			personKey: 'x',
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0,
		});
		const partial = scorePerson('cleese', {
			name: 'John Cleese',
			personKey: 'x',
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0,
		});
		expect(exact).toBeGreaterThan(partial);
	});
});
