import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '@mu/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../database/schema/index.js';
import { MusicBrainzClient } from '../../../providers/sources/musicbrainz/musicbrainz.client.js';
import { ArtworkService } from '../../catalog/artwork.service.js';
import { MusicCatalogService } from '../../catalog/catalog.service.js';
import { MusicQueryService } from '../../library/music-query.service.js';
import { CoverArtClient, LrclibClient, WikiClient } from '../clients.js';
import { LYRICS_MISS_TTL_MS, MusicMetadataService } from '../music-metadata.service.js';

const require = createRequire(import.meta.url);
const NOW = '2026-10-10T00:00:00.000Z';
const RG = '11111111-1111-1111-1111-111111111111';
const REL = '22222222-2222-2222-2222-222222222222';
const ART_MB = '33333333-3333-3333-3333-333333333333';
const REC1 = '44444444-4444-4444-4444-444444444444';
const REC2 = '55555555-5555-5555-5555-555555555555';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

type Route = (url: URL) => Response | null;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'mu-meta-'));
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
		CREATE TABLE playlists (id TEXT PRIMARY KEY);
		CREATE TABLE media_sources (id TEXT PRIMARY KEY, path TEXT, kind TEXT NOT NULL DEFAULT 'video');
		CREATE TABLE stream_sessions (id TEXT PRIMARY KEY);`);
	require('../../../../../../scripts/migrations/media-kinds.js').apply(sqlite);
	const db = drizzle(sqlite, { schema });
	const database = { db } as never;
	const config = { get: (k: string) => (k === 'cache.dir' ? join(dir, 'cache') : dir) } as never;
	let settings: MusicSettings = { ...DEFAULT_MUSIC_SETTINGS };
	const musicSettings = { get: () => settings } as never;
	const artwork = new ArtworkService(config, database);
	const catalog = new MusicCatalogService(database, artwork, musicSettings);
	const mb = new MusicBrainzClient();
	mb.throttle.minIntervalMs = 0;
	const coverArt = new CoverArtClient();
	const wiki = new WikiClient();
	const lrclib = new LrclibClient();
	for (const c of [coverArt, wiki, lrclib]) c.throttle.minIntervalMs = 0;
	const svc = new MusicMetadataService(
		database,
		mb,
		coverArt,
		wiki,
		lrclib,
		artwork,
		catalog,
		musicSettings,
	);

	// One album, two tracks, one artist.
	sqlite.exec(`
		INSERT INTO artists (id, name, sort_name, norm_name, created_at, updated_at)
			VALUES ('ar1', 'Radiohead', 'Radiohead', 'radiohead', '${NOW}', '${NOW}');
		INSERT INTO albums (id, title, sort_title, norm_title, artist_credit, year, track_count, added_at, updated_at)
			VALUES ('al1', 'OK Computer', 'OK Computer', 'ok computer', 'Radiohead', 1997, 2, '${NOW}', '${NOW}');
		INSERT INTO album_artists (album_id, artist_id, role, position) VALUES ('al1', 'ar1', 'primary', 0);
		INSERT INTO tracks (id, album_id, title, norm_title, disc_no, track_no, duration_seconds, artist_credit, added_at, updated_at)
			VALUES ('t1', 'al1', 'Airbag', 'airbag', 1, 1, 284, 'Radiohead', '${NOW}', '${NOW}'),
			       ('t2', 'al1', 'Paranoid Android', 'paranoid android', 1, 2, 383, 'Radiohead', '${NOW}', '${NOW}');
	`);
	return {
		db,
		svc,
		query: new MusicQueryService(database),
		setSettings: (p: Partial<MusicSettings>) => {
			settings = { ...settings, ...p };
		},
	};
}

const releaseHit = (over: Record<string, unknown> = {}) => ({
	id: REL,
	title: 'OK Computer',
	score: 100,
	date: '1997-05-21',
	status: 'Official',
	country: 'GB',
	'track-count': 2,
	'artist-credit': [{ name: 'Radiohead', artist: { id: ART_MB, name: 'Radiohead' } }],
	'release-group': { id: RG, 'primary-type': 'Album', 'secondary-types': [] },
	...over,
});

const releaseDetail = {
	...releaseHit(),
	'label-info': [{ 'catalog-number': 'NODATA 02', label: { name: 'Parlophone' } }],
	media: [
		{
			format: 'CD',
			position: 1,
			tracks: [
				{ position: 1, title: 'Airbag', length: 284_500, recording: { id: REC1 } },
				{
					position: 2,
					title: 'Paranoid Android',
					length: 383_000,
					recording: { id: REC2 },
				},
			],
		},
	],
};

const mbRoutes: Route = (u) => {
	if (u.host !== 'musicbrainz.org') return null;
	if (u.pathname === '/ws/2/release/') return json({ releases: [releaseHit()] });
	if (u.pathname === `/ws/2/release/${REL}`) return json(releaseDetail);
	if (u.pathname === `/ws/2/release-group/${RG}`) {
		return json({
			id: RG,
			'primary-type': 'Album',
			'first-release-date': '1997-05-21',
			genres: [
				{ name: 'alternative rock', count: 10 },
				{ name: 'art rock', count: 5 },
			],
		});
	}
	if (u.pathname === `/ws/2/artist/${ART_MB}`) {
		return json({
			id: ART_MB,
			name: 'Radiohead',
			type: 'Group',
			country: 'GB',
			'life-span': { begin: '1985' },
			relations: [
				{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q44190' } },
			],
		});
	}
	return json({}, 404);
};

const otherRoutes: Route = (u) => {
	if (u.host === 'coverartarchive.org') {
		return u.pathname.endsWith('/front-1200')
			? new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })
			: new Response('', { status: 404 });
	}
	if (u.host === 'www.wikidata.org') {
		return json({
			entities: {
				Q44190: {
					sitelinks: { enwiki: { title: 'Radiohead' } },
					claims: { P18: [{ mainsnak: { datavalue: { value: 'Radiohead.jpg' } } }] },
				},
			},
		});
	}
	if (u.host === 'en.wikipedia.org')
		return json({ type: 'standard', extract: 'Radiohead are an English rock band.' });
	if (u.host === 'commons.wikimedia.org') {
		return new Response(new Uint8Array([0xff, 0xd8, 9, 9]), {
			headers: { 'content-type': 'image/jpeg' },
		});
	}
	return null;
};

let routes: Route[] = [];
const calls: string[] = [];

beforeEach(() => {
	routes = [mbRoutes, otherRoutes];
	calls.length = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init?: RequestInit) => {
			calls.push(input);
			expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/^Mu\//);
			const u = new URL(input);
			for (const r of routes) {
				const res = r(u);
				if (res) return res;
			}
			return new Response('', { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('album matching', () => {
	it('auto-applies a confident match: MBIDs, release, genres, recordings, artist', async () => {
		const { db, svc } = setup();
		const out = await svc.matchAlbum('al1');
		expect(out).toMatchObject({ status: 'matched', releaseGroupMbid: RG, releaseMbid: REL });
		const al = db.select().from(schema.albums).where(eq(schema.albums.id, 'al1')).get();
		expect(al?.mbidReleaseGroup).toBe(RG);
		expect(al?.originalYear).toBe(1997);
		const rel = db.select().from(schema.albumReleases).all();
		expect(rel).toMatchObject([{ mbidRelease: REL, label: 'Parlophone', mediaFormat: 'CD' }]);
		const genres = db
			.select()
			.from(schema.musicGenres)
			.all()
			.map((g) => g.name);
		expect(genres.sort()).toEqual(['Alternative Rock', 'Art Rock']);
		const t = db.select().from(schema.tracks).all();
		expect(t.map((x) => x.mbidRecording).sort()).toEqual([REC1, REC2].sort());
		const ar = db.select().from(schema.artists).where(eq(schema.artists.id, 'ar1')).get();
		expect(ar?.mbid).toBe(ART_MB);
		expect(svc.matchState('al1')).toMatchObject({ status: 'matched', releaseMbid: REL });
	});

	it('stores candidates when two different groups are equally good', async () => {
		const { svc } = setup();
		const RG2 = '66666666-6666-6666-6666-666666666666';
		routes.unshift((u) =>
			u.pathname === '/ws/2/release/'
				? json({
						releases: [
							releaseHit(),
							releaseHit({
								id: '77777777-7777-7777-7777-777777777777',
								'release-group': { id: RG2, 'primary-type': 'Album' },
							}),
						],
					})
				: null,
		);
		const out = await svc.matchAlbum('al1');
		expect(out.status).toBe('candidates');
		const state = svc.matchState('al1');
		expect(state.status).toBe('candidates');
		expect(state.candidates.map((c) => c.releaseGroupMbid).sort()).toEqual([RG, RG2].sort());
	});

	it('records "none" when MusicBrainz has nothing', async () => {
		const { svc } = setup();
		routes.unshift((u) => (u.pathname === '/ws/2/release/' ? json({ releases: [] }) : null));
		expect((await svc.matchAlbum('al1')).status).toBe('none');
		expect(svc.matchState('al1').status).toBe('none');
	});

	it('survives MusicBrainz errors without throwing', async () => {
		const { svc } = setup();
		routes.unshift((u) => (u.host === 'musicbrainz.org' ? json({}, 503) : null));
		expect((await svc.matchAlbum('al1')).status).toBe('none');
	});

	it('manual match by release group picks a release; auto refresh never replaces it', async () => {
		const { svc } = setup();
		routes.unshift((u) =>
			u.pathname === '/ws/2/release' && u.searchParams.get('release-group') === RG
				? json({ releases: [releaseHit()] })
				: null,
		);
		const state = await svc.applyManualMatch('al1', { releaseGroupMbid: RG });
		expect(state).toMatchObject({ status: 'matched', releaseGroupMbid: RG, releaseMbid: REL });
		expect(await svc.matchAlbum('al1', { force: true })).toEqual({
			status: 'skipped',
			reason: 'matched',
		});
	});
});

describe('cover art + artist info', () => {
	it('fetches CAA art only when missing, honours the art preference', async () => {
		const { db, svc, setSettings } = setup();
		expect(await svc.fetchAlbumArt('al1')).toEqual({ skipped: 'unmatched' });
		await svc.matchAlbum('al1');
		setSettings({ artPreference: ['embedded', 'folder'] });
		expect(await svc.fetchAlbumArt('al1')).toEqual({ skipped: 'disabled' });
		setSettings({ artPreference: ['embedded', 'folder', 'coverartarchive'] });
		const res = await svc.fetchAlbumArt('al1');
		expect(res).toHaveProperty('artId');
		const al = db.select().from(schema.albums).where(eq(schema.albums.id, 'al1')).get();
		expect(al?.artId).toBe((res as { artId: string }).artId);
		expect(await svc.fetchAlbumArt('al1')).toEqual({ skipped: 'has-art' });
	});

	it('enriches an artist with bio, image and facts', async () => {
		const { db, svc } = setup();
		await svc.matchAlbum('al1');
		const res = await svc.enrichArtist('ar1');
		expect(res).toEqual({ ok: true, bio: true, image: true });
		const ar = db.select().from(schema.artists).where(eq(schema.artists.id, 'ar1')).get();
		expect(ar?.bio).toBe('Radiohead are an English rock band.');
		expect(ar?.imageId).toBeTruthy();
		expect(ar?.type).toBe('group');
		expect(ar?.beginYear).toBe(1985);
		expect(ar?.metadataFetchedAt).toBeTruthy();
		expect(await svc.enrichArtist('ar1')).toEqual({ skipped: 'fetched' });
	});

	it('enrichAlbum runs the whole pass', async () => {
		const { db, svc } = setup();
		const res = await svc.enrichAlbum('al1');
		expect(res.match.status).toBe('matched');
		expect(res.art).toHaveProperty('artId');
		expect(res.artistsEnriched).toBe(1);
		const al = db.select().from(schema.albums).where(eq(schema.albums.id, 'al1')).get();
		expect(al?.metadataFetchedAt).toBeTruthy();
	});
});

describe('lyrics', () => {
	const synced = '[00:01.00]In the next world war\n[00:04.00]In a jackknifed juggernaut';

	it('stores LRCLIB synced + plain lyrics', async () => {
		const { svc, query } = setup();
		routes.unshift((u) => {
			if (u.host !== 'lrclib.net') return null;
			expect(u.pathname).toBe('/api/get');
			expect(u.searchParams.get('duration')).toBe('284');
			expect(u.searchParams.get('artist_name')).toBe('Radiohead');
			return json({ syncedLyrics: synced, plainLyrics: null });
		});
		expect(await svc.fetchLyrics('t1')).toEqual({ status: 'found' });
		expect(query.getLyrics('t1')).toEqual({
			plain: 'In the next world war\nIn a jackknifed juggernaut',
			syncedLrc: synced,
			source: 'lrclib',
		});
		expect(await svc.fetchLyrics('t1')).toEqual({ skipped: 'has-lyrics' });
	});

	it('caches misses and does not re-query until the TTL passes', async () => {
		const { db, svc, query } = setup();
		routes.unshift((u) =>
			u.host === 'lrclib.net'
				? u.pathname === '/api/search'
					? json([])
					: json({ message: 'not found' }, 404)
				: null,
		);
		expect(await svc.fetchLyrics('t1')).toEqual({ status: 'miss' });
		expect(query.getLyrics('t1')).toBeNull();
		const n = calls.length;
		expect(await svc.fetchLyrics('t1')).toEqual({ skipped: 'recent-miss' });
		expect(calls.length).toBe(n);
		const old = new Date(Date.now() - LYRICS_MISS_TTL_MS - 1000).toISOString();
		db.update(schema.lyrics).set({ fetchedAt: old }).run();
		expect(await svc.fetchLyrics('t1')).toEqual({ status: 'miss' });
	});

	it('never overwrites user-edited lyrics, even forced', async () => {
		const { svc, query } = setup();
		query.saveLyrics('t1', { plain: 'mine', syncedLrc: null }, 'u1');
		routes.unshift((u) => (u.host === 'lrclib.net' ? json({ plainLyrics: 'theirs' }) : null));
		expect(await svc.fetchLyrics('t1', { force: true })).toEqual({ skipped: 'user-edited' });
		expect(query.getLyrics('t1')?.plain).toBe('mine');
	});

	it('is gated on the fetchLyrics setting and fails soft on network errors', async () => {
		const { svc, setSettings } = setup();
		setSettings({ fetchLyrics: false });
		expect(await svc.fetchLyrics('t1')).toEqual({ skipped: 'disabled' });
		setSettings({ fetchLyrics: true });
		routes.unshift((u) => (u.host === 'lrclib.net' ? json({}, 500) : null));
		await expect(svc.fetchLyrics('t1')).rejects.toThrow(/HTTP 500/);
	});
});
