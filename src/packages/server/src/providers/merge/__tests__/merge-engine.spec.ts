import { describe, expect, it } from 'vitest';
import { MergeEngine } from '../merge-engine.js';
import type { FieldRule } from '../merge-rules.js';
import type { SourceContribution } from '../merge-types.js';

const RULES: FieldRule[] = [
	{ field: 'title', precedence: { tmdb: 10, omdb: 6, trakt: 4 }, strategy: 'take-best' },
	{ field: 'imdbRating', precedence: { omdb: 10 }, strategy: 'take-best' },
	{ field: 'tmdbRating', precedence: { tmdb: 10 }, strategy: 'take-best' },
	{ field: 'tmdbVotes', precedence: { tmdb: 10 }, strategy: 'numeric-max' },
	{ field: 'genres', precedence: { tmdb: 10, omdb: 4 }, strategy: 'merge-arrays' },
	{ field: 'cast', precedence: { tmdb: 10, omdb: 4 }, strategy: 'merge-arrays' },
];

function contribution(source: string, fields: Record<string, unknown>): SourceContribution {
	return { source, fields, fetchedAt: '2026-01-01T00:00:00Z' };
}

describe('MergeEngine', () => {
	it('takes the highest-precedence value for take-best fields', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({}, {}, [
			contribution('omdb', { title: 'From OMDB' }),
			contribution('tmdb', { title: 'From TMDB' }),
		]);
		expect(out.merged.title).toBe('From TMDB');
		expect(out.provenance.title).toBe('tmdb');
	});

	it('keeps the existing value when an incoming source has lower precedence', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ title: 'Existing' }, { title: 'tmdb' }, [
			contribution('omdb', { title: 'From OMDB' }),
		]);
		expect(out.merged.title).toBe('Existing');
		expect(out.provenance.title).toBe('tmdb');
		expect(out.diff).toHaveLength(0);
	});

	it('overwrites when a higher-precedence source arrives', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ title: 'Existing' }, { title: 'omdb' }, [
			contribution('tmdb', { title: 'From TMDB' }),
		]);
		expect(out.merged.title).toBe('From TMDB');
		expect(out.provenance.title).toBe('tmdb');
		expect(out.diff).toHaveLength(1);
		expect(out.diff[0]?.reason).toBe('higher-precedence');
	});

	it('first-sets a field when nothing is there yet (even from a low-precedence source)', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({}, {}, [contribution('trakt', { title: 'From Trakt' })]);
		expect(out.merged.title).toBe('From Trakt');
		expect(out.provenance.title).toBe('trakt');
		expect(out.diff[0]?.reason).toBe('first-set');
	});

	it('merges arrays case-insensitively without duplicates', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ genres: ['Action', 'Sci-Fi'] }, { genres: 'tmdb' }, [
			contribution('omdb', { genres: ['action', 'thriller'] }),
		]);
		expect(out.merged.genres).toEqual(['Action', 'Sci-Fi', 'thriller']);
		expect(out.diff[0]?.reason).toBe('merged-collection');
	});

	it('handles numeric-max strategy', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ tmdbVotes: 100 }, { tmdbVotes: 'tmdb' }, [
			contribution('tmdb', { tmdbVotes: 500 }),
		]);
		expect(out.merged.tmdbVotes).toBe(500);
	});

	it('never lets a lower numeric-max value win', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ tmdbVotes: 1000 }, { tmdbVotes: 'tmdb' }, [
			contribution('tmdb', { tmdbVotes: 50 }),
		]);
		expect(out.merged.tmdbVotes).toBe(1000);
		expect(out.diff).toHaveLength(0);
	});

	it('user provenance is immutable to providers', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ title: 'My Custom Title' }, { title: 'user' }, [
			contribution('tmdb', { title: 'Re-fetched From TMDB' }),
		]);
		expect(out.merged.title).toBe('My Custom Title');
		expect(out.provenance.title).toBe('user');
		expect(out.diff).toHaveLength(0);
	});

	it('user override beats any provider', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ title: 'From TMDB' }, { title: 'tmdb' }, [
			contribution('user', { title: 'My Override' }),
		]);
		expect(out.merged.title).toBe('My Override');
		expect(out.provenance.title).toBe('user');
		expect(out.diff[0]?.reason).toBe('user-override');
	});

	it('is idempotent — applying the same contributions twice has no further effect', () => {
		const engine = MergeEngine.withRules(RULES);
		const contribs = [
			contribution('tmdb', { title: 'X', genres: ['Action'] }),
			contribution('omdb', { imdbRating: 8.7, genres: ['Thriller'] }),
		];
		const first = engine.apply({}, {}, contribs);
		const second = engine.apply(first.merged, first.provenance, contribs);
		expect(second.merged).toEqual(first.merged);
		expect(second.provenance).toEqual(first.provenance);
		expect(second.diff).toHaveLength(0);
	});

	it('preserves object shape when merging arrays of named objects (cast field)', () => {
		// Regression: previously the engine stringified objects via
		// String(x) → '[object Object]' before deduping, corrupting
		// the cast list whose TMDB shape is {name, character, …}.
		const engine = MergeEngine.withRules(RULES);
		const tmdbCast = [
			{ name: 'Graham Chapman', character: 'King Arthur', tmdbId: 21 },
			{ name: 'John Cleese', character: 'Sir Lancelot', tmdbId: 22 },
		];
		const omdbCast = 'graham chapman, john cleese, eric idle';
		const out = engine.apply({}, {}, [
			contribution('tmdb', { cast: tmdbCast }),
			contribution('omdb', { cast: omdbCast }),
		]);
		const merged = out.merged.cast as Array<{ name: string }>;
		expect(merged).toHaveLength(3);
		expect(merged[0]).toEqual(tmdbCast[0]); // object preserved
		expect(merged[1]).toEqual(tmdbCast[1]); // object preserved
		expect(merged[2]).toBe('eric idle'); // string-only contributor still merges in
	});

	it('upgrades string entries to objects when a later contribution carries the structured form', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({}, {}, [
			contribution('omdb', { cast: 'Graham Chapman' }),
			contribution('tmdb', { cast: [{ name: 'Graham Chapman', tmdbId: 21 }] }),
		]);
		const merged = out.merged.cast as Array<unknown>;
		expect(merged).toEqual([{ name: 'Graham Chapman', tmdbId: 21 }]);
	});

	it('scrubs leftover "[object Object]" strings from previous corruption on refresh', () => {
		// Regression: when a refresh feeds a previously-corrupted
		// cast list (containing the literal '[object Object]' string)
		// back into the engine, the bad entry's dedupe key has no
		// match in the fresh contribution and would otherwise be
		// preserved forever. valueToList now drops these.
		const engine = MergeEngine.withRules(RULES);
		const corruptedExisting = ['Graham Chapman', '[object Object]', 'John Cleese'];
		const out = engine.apply({ cast: corruptedExisting }, { cast: 'omdb' }, [
			contribution('tmdb', {
				cast: [{ name: 'Graham Chapman' }, { name: 'John Cleese' }],
			}),
		]);
		const merged = out.merged.cast as Array<unknown>;
		expect(merged).toEqual([{ name: 'Graham Chapman' }, { name: 'John Cleese' }]);
	});

	it('drops object items without a `name` field', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({}, {}, [
			contribution('tmdb', {
				cast: [{ name: 'A' }, {}, { character: 'no name' }, { name: '' }],
			}),
		]);
		expect(out.merged.cast).toEqual([{ name: 'A' }]);
	});

	it('ignores null/undefined/empty incoming values', () => {
		const engine = MergeEngine.withRules(RULES);
		const out = engine.apply({ title: 'Existing' }, { title: 'omdb' }, [
			contribution('tmdb', { title: null }),
			contribution('omdb', { title: '' }),
			contribution('trakt', { title: undefined }),
		]);
		expect(out.merged.title).toBe('Existing');
		expect(out.diff).toHaveLength(0);
	});
});
