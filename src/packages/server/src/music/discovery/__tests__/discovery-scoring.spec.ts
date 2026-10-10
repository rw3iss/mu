import { describe, expect, it } from 'vitest';
import { looksLikeSoundtrack, soundtrackBaseTitle } from '../album-films.service.js';
import {
	addGenres,
	blendScores,
	cosine,
	emptyProfile,
	eraSimilarity,
	normaliseByMax,
	scoreAlbum,
} from '../discovery-scoring.js';

describe('discovery scoring', () => {
	it('cosine: identical genre sets score 1, disjoint 0', () => {
		const w = new Map([
			['rock', 1],
			['indie', 1],
		]);
		expect(cosine(w, ['Rock', 'Indie'])).toBeCloseTo(1);
		expect(cosine(w, ['jazz'])).toBe(0);
		expect(cosine(new Map(), ['rock'])).toBe(0);
	});

	it('era similarity decays with distance to the nearest seed year', () => {
		expect(eraSimilarity([1997], 1997)).toBe(1);
		expect(eraSimilarity([1997], 2005)).toBeLessThan(eraSimilarity([1997], 1999));
		expect(eraSimilarity([1970, 1997], 1996)).toBeGreaterThan(0.8);
		expect(eraSimilarity([], 1997)).toBe(0);
		expect(eraSimilarity([1997], null)).toBe(0);
	});

	it('ranks a same-genre same-era album above an off-genre one', () => {
		const p = emptyProfile();
		addGenres(p, ['alternative rock', 'art rock']);
		p.years.push(1997);
		const close = scoreAlbum(p, {
			id: 'x',
			genres: ['Alternative Rock', 'Art Rock'],
			artistIds: [],
			year: 1998,
		});
		const far = scoreAlbum(p, { id: 'y', genres: ['jazz'], artistIds: [], year: 1959 });
		expect(close.score).toBeGreaterThan(far.score);
		expect(close.reasons[0]).toMatch(/Shares genres/);
	});

	it('artist overlap adds weight and a reason', () => {
		const p = emptyProfile();
		p.artistIds.add('ar1');
		const s = scoreAlbum(p, { id: 'x', genres: [], artistIds: ['ar1'], year: null });
		expect(s.score).toBeCloseTo(0.25);
		expect(s.reasons).toContain('Same artist');
	});

	it('noisy-OR blend: agreement lifts the score, stays within 0..1', () => {
		const single = blendScores([{ weight: 1, score: 0.5 }]);
		const both = blendScores([
			{ weight: 1, score: 0.5 },
			{ weight: 0.9, score: 0.5 },
		]);
		expect(single).toBeCloseTo(0.5);
		expect(both).toBeGreaterThan(single);
		expect(blendScores([{ weight: 2, score: 1 }])).toBe(1);
		expect(blendScores([])).toBe(0);
	});

	it('normaliseByMax scales to the top score', () => {
		expect(normaliseByMax([{ score: 50 }, { score: 100 }]).map((x) => x.score)).toEqual([
			0.5, 1,
		]);
	});
});

describe('soundtrack title matching', () => {
	it.each([
		['The Matrix: Original Motion Picture Soundtrack', 'the matrix'],
		['Drive (Original Motion Picture Soundtrack)', 'drive'],
		['Music From the Motion Picture Pulp Fiction', 'pulp fiction'],
		['Interstellar (Original Score)', 'interstellar'],
		['Blade Runner 2049 - Original Motion Picture Soundtrack', 'blade runner 2049'],
		['Tron: Legacy', 'tron: legacy'],
	])('%s → %s', (input, expected) => {
		expect(soundtrackBaseTitle(input)).toBe(expected);
	});

	it('detects soundtracks via MB secondary type or title hint', () => {
		expect(looksLikeSoundtrack('Tron: Legacy', ['Soundtrack'])).toBe(true);
		expect(looksLikeSoundtrack('Drive (Original Motion Picture Soundtrack)', [])).toBe(true);
		expect(looksLikeSoundtrack('OK Computer', [])).toBe(false);
	});
});
