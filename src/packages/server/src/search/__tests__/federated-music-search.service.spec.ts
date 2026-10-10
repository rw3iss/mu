import type { MusicSearchHit } from '@mu/shared';
import { lastValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeMusicHit, musicDedupKeys, normMusic } from '../dedup.js';
import { FederatedMusicSearchService } from '../federated-music-search.service.js';
import type { SearchEvent } from '../search-types.js';

const base = (p: Partial<MusicSearchHit>): MusicSearchHit => ({
	kind: 'album',
	title: 'OK Computer',
	sources: ['local'],
	isOwned: false,
	matchScore: 0.5,
	...p,
});

describe('music dedup', () => {
	it('normalises case, accents, punctuation and a leading "the"', () => {
		expect(normMusic('The Beatles')).toBe('beatles');
		expect(normMusic('Björk!')).toBe('bjork');
	});

	it('keys: MBID first, then local id, then (artist,title,year)', () => {
		expect(
			musicDedupKeys(base({ mbid: 'rg1', localId: 'a1', artist: 'Radiohead', year: 1997 })),
		).toEqual(['album:mb:rg1', 'album:local:a1', 'album:n:radiohead|ok computer|1997']);
	});

	it('tracks drop the year; artists key on the name alone', () => {
		expect(
			musicDedupKeys(
				base({ kind: 'track', title: 'Airbag', artist: 'Radiohead', year: 1997 }),
			),
		).toEqual(['track:n:radiohead|airbag']);
		expect(musicDedupKeys(base({ kind: 'artist', title: 'The Smiths' }))).toEqual([
			'artist:n:smiths',
		]);
	});

	it('merge keeps local id/art, adds MBID, unions sources, max score', () => {
		const local = base({ localId: 'a1', artUrl: '/local.jpg', isOwned: true, matchScore: 0.6 });
		const mb = base({
			mbid: 'rg1',
			artUrl: 'https://caa/x',
			sources: ['musicbrainz'],
			matchScore: 0.9,
		});
		const m = mergeMusicHit(mb, local);
		expect(m.localId).toBe('a1');
		expect(m.mbid).toBe('rg1');
		expect(m.artUrl).toBe('/local.jpg');
		expect(m.isOwned).toBe(true);
		expect(m.sources).toEqual(['musicbrainz', 'local']);
		expect(m.matchScore).toBe(0.9);
	});
});

/** Minimal drizzle-ish chain; `order` = result rows per MBID query, in call order. */
function mkDb(order: any[][] = []) {
	let call = 0;
	return {
		db: {
			select: () => ({
				from: () => ({ where: () => ({ all: () => order[call++] ?? [] }) }),
			}),
		},
	};
}

describe('FederatedMusicSearchService', () => {
	let music: any;
	let mb: any;
	let cache: any;
	let creds: any;

	beforeEach(() => {
		music = {
			search: vi.fn().mockReturnValue({
				artists: [],
				albums: [
					{
						id: 'a1',
						title: 'OK Computer',
						artistCredit: 'Radiohead',
						artists: [],
						year: 1997,
						primaryType: 'album',
						artUrl: '/art',
						trackCount: 12,
						totalSeconds: 1,
						ratingAvg: null,
						addedAt: '',
					},
				],
				tracks: [],
			}),
		};
		mb = {
			get: vi.fn(async (path: string) => {
				if (path.startsWith('/release-group/'))
					return {
						'release-groups': [
							{
								id: 'rg1',
								title: 'OK Computer',
								score: 100,
								'primary-type': 'Album',
								'first-release-date': '1997-05-21',
								'artist-credit': [{ name: 'Radiohead' }],
							},
						],
					};
				if (path.startsWith('/artist/')) return { artists: [] };
				return { recordings: [] };
			}),
		};
		cache = { get: vi.fn().mockReturnValue(null), set: vi.fn() };
		creds = { getRaw: vi.fn().mockReturnValue(null) };
	});

	const collect = async (svc: FederatedMusicSearchService) =>
		(await lastValueFrom(
			svc.search$('ok computer').pipe(toArray()),
		)) as SearchEvent<MusicSearchHit>[];

	it('emits local first, merges the MusicBrainz twin by (artist,title,year), caches MB only', async () => {
		const svc = new FederatedMusicSearchService(music, mkDb() as any, mb, cache, creds);
		const events = await collect(svc);
		const results = events.filter((e) => e.kind === 'results') as any[];
		expect(results[0].source).toBe('local');
		const mbEvent = results.find((r) => r.source === 'musicbrainz' && r.items.length);
		expect(mbEvent.items[0]).toMatchObject({ localId: 'a1', mbid: 'rg1', isOwned: true });
		expect(mbEvent.items[0].sources).toEqual(['local', 'musicbrainz']);
		expect(cache.set).toHaveBeenCalledWith(
			'album',
			'ok computer',
			'musicbrainz',
			expect.any(Array),
		);
		expect(cache.set.mock.calls.every((c: any[]) => c[2] !== 'local')).toBe(true);
	});

	it('merges by MBID when the local album carries mbid_release_group', async () => {
		music.search.mockReturnValue({
			artists: [],
			albums: [{ ...music.search().albums[0], title: 'OK Computer (Remaster)', year: 2017 }],
			tracks: [],
		});
		// Only the albums MBID query runs (no local artists / tracks in the result).
		const db = mkDb([[{ id: 'a1', mbid: 'rg1' }]]);
		const svc = new FederatedMusicSearchService(music, db as any, mb, cache, creds);
		const events = await collect(svc);
		const last = events.filter((e) => e.kind === 'results').pop() as any;
		const album = last.items.find((i: MusicSearchHit) => i.mbid === 'rg1');
		expect(album.localId).toBe('a1');
	});

	it('skips Last.fm / Discogs silently without credentials', async () => {
		const svc = new FederatedMusicSearchService(music, mkDb() as any, mb, cache, creds);
		const events = await collect(svc);
		const done = events.at(-1) as any;
		expect(done.kind).toBe('done');
		expect(done.sourcesQueried).not.toContain('lastfm');
		expect(done.sourcesQueried).not.toContain('discogs');
	});

	it('reports an MB outage as an error event without failing the stream', async () => {
		mb.get.mockResolvedValue(null);
		const svc = new FederatedMusicSearchService(music, mkDb() as any, mb, cache, creds);
		const events = await collect(svc);
		expect(events.some((e) => e.kind === 'error' && e.source === 'musicbrainz')).toBe(true);
		expect(events.at(-1)?.kind).toBe('done');
	});
});
