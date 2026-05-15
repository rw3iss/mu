import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCHER_CONFIG, findBestMatch, type MatchCandidate } from '../matcher.js';

function cand(over: Partial<MatchCandidate>): MatchCandidate {
	return {
		provider: 'tmdb',
		externalId: 1,
		title: '',
		year: null,
		runtimeMinutes: null,
		popularity: null,
		posterUrl: null,
		...over,
	};
}

describe('findBestMatch', () => {
	it('flags noMatch when there are zero candidates', () => {
		const res = findBestMatch({ title: 'Anything' }, []);
		expect(res.noMatch).toBe(true);
		expect(res.best).toBeNull();
		expect(res.ranked).toEqual([]);
	});

	it('auto-applies an exact title + year match', () => {
		const res = findBestMatch(
			{ title: 'The Matrix', year: 1999, durationMinutes: 136 },
			[
				cand({ title: 'The Matrix', year: 1999, runtimeMinutes: 136, externalId: 603 }),
			],
		);
		expect(res.best?.candidate.externalId).toBe(603);
		expect(res.noMatch).toBe(false);
		expect(res.ambiguous).toBe(false);
		expect(res.best?.confidence).toBeGreaterThanOrEqual(
			DEFAULT_MATCHER_CONFIG.autoApplyMin,
		);
	});

	it('prefers the candidate whose year actually matches', () => {
		const res = findBestMatch(
			{ title: 'Dune', year: 2021 },
			[
				cand({ title: 'Dune', year: 1984, externalId: 'a' }),
				cand({ title: 'Dune', year: 2021, externalId: 'b' }),
			],
		);
		expect(res.best?.candidate.externalId).toBe('b');
	});

	it('treats roman numerals as their arabic equivalents', () => {
		const res = findBestMatch(
			{ title: 'The Godfather Part II', year: 1974 },
			[
				cand({ title: 'The Godfather Part 2', year: 1974, externalId: 'g2' }),
			],
		);
		// Title normalises II → 2 → exact match.
		expect(res.best?.titleScoreRaw).toBe(1);
	});

	it('ignores year when neither side has one (drops year weight)', () => {
		const res = findBestMatch(
			{ title: 'Inception' },
			[cand({ title: 'Inception', externalId: 'inc' })],
		);
		// With no year on either side, the composite is built from title alone
		// (still >= autoApplyMin since title is a perfect match).
		expect(res.best?.confidence).toBeGreaterThanOrEqual(
			DEFAULT_MATCHER_CONFIG.autoApplyMin,
		);
		expect(res.best?.yearScore).toBe(-1);
	});

	it('penalises year-off-by-2 less than year-off-by-1', () => {
		const off1 = findBestMatch(
			{ title: 'Movie', year: 2020 },
			[cand({ title: 'Movie', year: 2019, externalId: 'a' })],
		).best!.confidence;
		const off2 = findBestMatch(
			{ title: 'Movie', year: 2020 },
			[cand({ title: 'Movie', year: 2018, externalId: 'b' })],
		).best!.confidence;
		const off3 = findBestMatch(
			{ title: 'Movie', year: 2020 },
			[cand({ title: 'Movie', year: 2017, externalId: 'c' })],
		).best!.confidence;
		expect(off1).toBeGreaterThan(off2);
		expect(off2).toBeGreaterThan(off3);
	});

	it('marks the result ambiguous when nothing clears autoApplyMin but something clears noMatchMax', () => {
		const res = findBestMatch(
			{ title: 'Heat', year: 1995 },
			[
				// Title partial overlap + year off → mid confidence
				cand({ title: 'Heat Wave', year: 2010, externalId: 'a' }),
				// Different title, year right → mid confidence
				cand({ title: 'Hello', year: 1995, externalId: 'b' }),
			],
		);
		// Best should clear noMatchMax (something is plausible) but not
		// autoApplyMin (none is a clear winner).
		expect(res.noMatch).toBe(false);
		expect(res.best!.confidence).toBeLessThan(DEFAULT_MATCHER_CONFIG.autoApplyMin);
		expect(res.best!.confidence).toBeGreaterThanOrEqual(
			DEFAULT_MATCHER_CONFIG.noMatchMax,
		);
		expect(res.ambiguous).toBe(true);
	});

	it('uses popularity only as a tiebreaker, never to flip strong ranks', () => {
		// Two candidates with identical title + year-off-by-1 so composite
		// is below the clamp ceiling — popularity then breaks the tie.
		const res = findBestMatch(
			{ title: 'Movie', year: 2020 },
			[
				cand({ title: 'Movie', year: 2019, popularity: 1, externalId: 'low' }),
				cand({ title: 'Movie', year: 2019, popularity: 1000, externalId: 'high' }),
			],
		);
		expect(res.best?.candidate.externalId).toBe('high');

		// But popularity must NOT promote a worse title above a better one.
		const flip = findBestMatch(
			{ title: 'The Matrix', year: 1999 },
			[
				cand({ title: 'The Matrix', year: 1999, popularity: 0.1, externalId: 'true' }),
				cand({ title: 'The Mascot', year: 1999, popularity: 9999, externalId: 'noise' }),
			],
		);
		expect(flip.best?.candidate.externalId).toBe('true');
	});

	it('rewards duration matches when both sides have a runtime', () => {
		const withDur = findBestMatch(
			{ title: 'Movie', year: 2020, durationMinutes: 120 },
			[cand({ title: 'Movie', year: 2020, runtimeMinutes: 122, externalId: 'a' })],
		).best!;
		const withoutDur = findBestMatch(
			{ title: 'Movie', year: 2020 },
			[cand({ title: 'Movie', year: 2020, externalId: 'a' })],
		).best!;
		expect(withDur.durationScore).toBe(1);
		expect(withoutDur.durationScore).toBe(-1);
	});

	it('sorts the ranked array by confidence descending', () => {
		const res = findBestMatch(
			{ title: 'Heat', year: 1995 },
			[
				cand({ title: 'Heat Wave', year: 2010, externalId: 'wave' }),
				cand({ title: 'Heat', year: 1995, externalId: 'heat' }),
				cand({ title: 'The Heat', year: 2013, externalId: 'theheat' }),
			],
		);
		expect(res.ranked.map((s) => s.candidate.externalId)).toEqual(
			[...res.ranked].sort((a, b) => b.confidence - a.confidence).map((s) => s.candidate.externalId),
		);
		expect(res.best?.candidate.externalId).toBe('heat');
	});
});
