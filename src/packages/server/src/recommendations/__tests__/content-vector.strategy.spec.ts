import { describe, expect, it } from 'vitest';
import { ContentVectorStrategy } from '../strategies/content-vector.strategy.js';
import type { MovieWithMetadata } from '../types.js';

function m(over: Partial<MovieWithMetadata> & { id: string; title: string }): MovieWithMetadata {
	return {
		id: over.id,
		title: over.title,
		year: over.year ?? null,
		posterUrl: null,
		overview: null,
		runtimeMinutes: over.runtimeMinutes ?? null,
		tmdbId: over.tmdbId ?? null,
		imdbId: over.imdbId ?? null,
		hidden: false,
		groupId: over.groupId ?? null,
		source: 'library' as const,

		addedAt: '2026-01-01T00:00:00.000Z',
		genres: over.genres ?? [],
		cast: over.cast ?? [],
		directors: over.directors ?? [],
		keywords: over.keywords ?? [],
		companies: over.companies ?? [],
		tmdbRating: over.tmdbRating ?? null,
		imdbRating: over.imdbRating ?? null,
		tmdbVotes: null,
	};
}

describe('ContentVectorStrategy', () => {
	const strat = new ContentVectorStrategy();

	it('scores zero when no overlap', async () => {
		const seed = m({ id: 'a', title: 'A', genres: ['Sci-Fi'] });
		const cand = m({ id: 'b', title: 'B', genres: ['Romance'] });
		const out = await strat.score(seed, [cand]);
		expect(out.scores).toHaveLength(0);
	});

	it('scores higher with more overlap', async () => {
		const seed = m({
			id: 'a',
			title: 'A',
			genres: ['Sci-Fi', 'Drama'],
			directors: ['Denis Villeneuve'],
			cast: ['Amy Adams', 'Jeremy Renner'],
		});
		const close = m({
			id: 'b',
			title: 'B',
			genres: ['Sci-Fi', 'Drama'],
			directors: ['Denis Villeneuve'],
			cast: ['Amy Adams'],
		});
		const far = m({
			id: 'c',
			title: 'C',
			genres: ['Sci-Fi'],
			cast: ['Random'],
		});
		const out = await strat.score(seed, [close, far]);
		expect(out.scores.length).toBeGreaterThanOrEqual(2);
		const closeScore = out.scores.find((s) => s.movieId === 'b')!;
		const farScore = out.scores.find((s) => s.movieId === 'c')!;
		expect(closeScore.score).toBeGreaterThan(farScore.score);
	});

	it('excludes the seed from results', async () => {
		const seed = m({ id: 'a', title: 'A', genres: ['Drama'] });
		const same = m({ id: 'a', title: 'A', genres: ['Drama'] });
		const out = await strat.score(seed, [same]);
		expect(out.scores).toHaveLength(0);
	});

	it('produces explanation strings for non-zero overlaps', async () => {
		const seed = m({
			id: 'a',
			title: 'A',
			directors: ['Christopher Nolan'],
			genres: ['Sci-Fi'],
		});
		const cand = m({
			id: 'b',
			title: 'B',
			directors: ['Christopher Nolan'],
			genres: ['Sci-Fi'],
		});
		const out = await strat.score(seed, [cand]);
		expect(out.scores[0]!.reasons!.length).toBeGreaterThan(0);
		expect(out.scores[0]!.reasons!.some((r) => r.includes('Christopher Nolan'))).toBe(true);
	});

	it('keeps score in [0, 1]', async () => {
		const seed = m({
			id: 'a',
			title: 'A',
			genres: ['G1', 'G2'],
			cast: ['C1', 'C2', 'C3'],
			directors: ['D1'],
			keywords: ['K1', 'K2', 'K3'],
			companies: ['Co1'],
			year: 2020,
			runtimeMinutes: 120,
		});
		const cand = m({
			id: 'b',
			title: 'B',
			genres: ['G1', 'G2'],
			cast: ['C1', 'C2', 'C3'],
			directors: ['D1'],
			keywords: ['K1', 'K2', 'K3'],
			companies: ['Co1'],
			year: 2020,
			runtimeMinutes: 120,
		});
		const out = await strat.score(seed, [cand]);
		expect(out.scores[0]!.score).toBeGreaterThan(0);
		expect(out.scores[0]!.score).toBeLessThanOrEqual(1);
	});
});
