import { describe, expect, it } from 'vitest';
import { composite } from '../scoring/composite-scorer.js';
import type { MovieWithMetadata, StrategyResult } from '../types.js';

function m(id: string, title: string): MovieWithMetadata {
	return {
		id,
		title,
		year: 2020,
		posterUrl: null,
		overview: null,
		runtimeMinutes: null,
		tmdbId: null,
		imdbId: null,
		hidden: false,
		groupId: null,
		addedAt: '2026-01-01',
		genres: [],
		cast: [],
		directors: [],
		keywords: [],
		companies: [],
		tmdbRating: null,
		imdbRating: null,
	};
}

describe('composite scorer', () => {
	it('blends two strategies with weighted normalisation', () => {
		const a: StrategyResult = {
			strategy: 's1',
			scores: [
				{ movieId: '1', score: 0.6 },
				{ movieId: '2', score: 0.3 },
			],
		};
		const b: StrategyResult = {
			strategy: 's2',
			scores: [
				{ movieId: '1', score: 0.5 },
				{ movieId: '3', score: 0.7 },
			],
		};
		const movies = new Map([
			['1', m('1', 'One')],
			['2', m('2', 'Two')],
			['3', m('3', 'Three')],
		]);
		const result = composite([a, b], { s1: 0.5, s2: 0.5 }, movies);
		// Movie 1 contributes from both (normalised: 0.6/0.6=1.0 × 0.5 + 0.5/0.7=0.71 × 0.5 ≈ 0.86)
		expect(result[0]!.movieId).toBe('1');
		expect(result[0]!.usedSources.sort()).toEqual(['s1', 's2']);
	});

	it('drops movies not present in the lookup map', () => {
		const r: StrategyResult = {
			strategy: 's1',
			scores: [{ movieId: 'missing', score: 0.9 }],
		};
		const result = composite([r], { s1: 1 }, new Map());
		expect(result).toHaveLength(0);
	});

	it('ignores strategies with zero weight', () => {
		const r: StrategyResult = {
			strategy: 's1',
			scores: [{ movieId: '1', score: 0.9 }],
		};
		const result = composite([r], { s1: 0 }, new Map([['1', m('1', 'One')]]));
		expect(result).toHaveLength(0);
	});

	it('preserves explanation strings from strategies', () => {
		const r: StrategyResult = {
			strategy: 's1',
			scores: [{ movieId: '1', score: 0.5, reasons: ['shared director'] }],
		};
		const result = composite([r], { s1: 1 }, new Map([['1', m('1', 'One')]]));
		expect(result[0]!.explanation).toContain('shared director');
	});

	it('de-duplicates explanation strings across strategies', () => {
		const a: StrategyResult = {
			strategy: 's1',
			scores: [{ movieId: '1', score: 0.5, reasons: ['shared genres'] }],
		};
		const b: StrategyResult = {
			strategy: 's2',
			scores: [{ movieId: '1', score: 0.5, reasons: ['shared genres'] }],
		};
		const result = composite([a, b], { s1: 0.5, s2: 0.5 }, new Map([['1', m('1', 'One')]]));
		expect(result[0]!.explanation).toEqual(['shared genres']);
	});
});
