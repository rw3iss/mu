import { lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
	type FederatedSearchSource,
	runFederatedSearch,
} from '../federated-search.orchestrator.js';
import type { SearchEvent } from '../search-types.js';

interface Hit {
	keys: string[];
	label: string;
	sources: string[];
}

const opts = (cache?: any) => ({
	dedupKeys: (h: Hit) => h.keys,
	merge: (a: Hit, b: Hit): Hit => ({
		keys: [...new Set([...a.keys, ...b.keys])],
		label: a.label,
		sources: [...a.sources, ...b.sources],
	}),
	cache,
	timeoutMs: 50,
});

async function collect(sources: FederatedSearchSource<Hit>[], cache?: any) {
	return (await lastValueFrom(
		runFederatedSearch('q', {}, sources, opts(cache)).pipe(toArray()),
	)) as SearchEvent<Hit>[];
}

const hit = (label: string, keys: string[], source: string): Hit => ({
	label,
	keys,
	sources: [source],
});

describe('runFederatedSearch', () => {
	it('runs local sources first (in order) then externals, then done', async () => {
		const events = await collect([
			{ id: 'tmdb', phase: 'external', run: async () => [hit('e', ['x'], 'tmdb')] },
			{ id: 'local', phase: 'local', run: () => [hit('l', ['a'], 'local')] },
			{ id: 'imdb', phase: 'local', run: () => [hit('i', ['b'], 'imdb')] },
		]);
		const order = events.map((e) => (e.kind === 'results' ? e.source : e.kind));
		expect(order).toEqual(['local', 'imdb', 'tmdb', 'done']);
	});

	it('merges hits that share ANY dedup key, and indexes merged keys', async () => {
		const events = await collect([
			{ id: 'local', phase: 'local', run: () => [hit('Album', ['n:album'], 'local')] },
			// MB contributes both keys → merges with local via the name key
			{
				id: 'musicbrainz',
				phase: 'external',
				run: async () => [hit('Album', ['mb:1', 'n:album'], 'musicbrainz')],
			},
		]);
		const last = events.filter((e) => e.kind === 'results').pop() as any;
		expect(last.items).toHaveLength(1);
		expect(last.items[0].sources).toEqual(['local', 'musicbrainz']);
	});

	it('emits an error for a source that exceeds the timeout but still completes', async () => {
		const events = await collect([
			{
				id: 'trakt',
				phase: 'external',
				run: () =>
					new Promise((r) => setTimeout(() => r([hit('slow', ['s'], 'trakt')]), 200)),
			},
		]);
		expect(events.find((e) => e.kind === 'error')).toMatchObject({ source: 'trakt' });
		expect(events.at(-1)?.kind).toBe('done');
	});

	it('skips disabled sources silently and drops null / empty results', async () => {
		const run = vi.fn();
		const events = await collect([
			{ id: 'lastfm', phase: 'external', enabled: () => false, run },
			{ id: 'omdb', phase: 'external', run: async () => null },
			{ id: 'trakt', phase: 'external', run: async () => [] },
		]);
		expect(run).not.toHaveBeenCalled();
		expect(events).toEqual([{ kind: 'done', sourcesQueried: [] }]);
	});

	it('emits empty results only for keepEmpty sources', async () => {
		const events = await collect([
			{ id: 'tmdb', phase: 'external', keepEmpty: true, run: async () => [] },
		]);
		expect(events[0]).toEqual({ kind: 'results', source: 'tmdb', items: [] });
	});

	it('serves cache hits as source "cache" and writes fresh results back', async () => {
		const cache = {
			get: vi.fn((type: string) =>
				type === 'album' ? [hit('c', ['c'], 'musicbrainz')] : null,
			),
			set: vi.fn(),
		};
		const upstreamAlbum = vi.fn();
		const events = await collect(
			[
				{
					id: 'musicbrainz',
					phase: 'external',
					cache: { type: 'album', source: 'musicbrainz' },
					run: upstreamAlbum,
				},
				{
					id: 'musicbrainz',
					phase: 'external',
					cache: { type: 'artist', source: 'musicbrainz' },
					run: async () => [hit('a', ['a'], 'musicbrainz')],
				},
			],
			cache,
		);
		expect(upstreamAlbum).not.toHaveBeenCalled();
		const sources = events.filter((e) => e.kind === 'results').map((e: any) => e.source);
		expect(sources).toEqual(expect.arrayContaining(['cache', 'musicbrainz']));
		expect(cache.set).toHaveBeenCalledWith('artist', 'q', 'musicbrainz', expect.any(Array));
	});

	it('never caches local sources', async () => {
		const cache = { get: vi.fn(() => null), set: vi.fn() };
		await collect(
			[{ id: 'local', phase: 'local', run: () => [hit('l', ['l'], 'local')] }],
			cache,
		);
		expect(cache.get).not.toHaveBeenCalled();
		expect(cache.set).not.toHaveBeenCalled();
	});
});
