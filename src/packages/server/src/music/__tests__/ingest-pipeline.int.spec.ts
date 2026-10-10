import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MUSIC_SETTINGS } from '@mu/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import * as schema from '../../database/schema/index.js';
import { ArtworkService } from '../catalog/artwork.service.js';
import { MusicCatalogService } from '../catalog/catalog.service.js';
import { readTrackTags } from '../ingest/tags.js';
import { MusicQueryService } from '../library/music-query.service.js';

const require = createRequire(import.meta.url);
const hasFfmpeg = (() => {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

function makeTrack(path: string, tags: Record<string, string>, freq = 440) {
	const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
	execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=8`, ...meta, path]);
}

describe.skipIf(!hasFfmpeg)('music ingest pipeline', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mu-ingest-'));
	const sqlite = new Database(join(dir, 'test.db'));
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
		CREATE TABLE playlists (id TEXT PRIMARY KEY);
		CREATE TABLE media_sources (id TEXT PRIMARY KEY, path TEXT, kind TEXT NOT NULL DEFAULT 'video');
		CREATE TABLE stream_sessions (id TEXT PRIMARY KEY);
		INSERT INTO media_sources (id, path, kind) VALUES ('src1', '${dir}', 'audio');`);
	require('../../../../../scripts/migrations/media-kinds.js').apply(sqlite);
	const db = drizzle(sqlite, { schema });
	const database = { db } as never;
	const config = { get: (k: string) => (k === 'cache.dir' ? join(dir, 'cache') : dir) } as never;
	const settings = { get: () => DEFAULT_MUSIC_SETTINGS } as never;
	const artwork = new ArtworkService(config, database);
	const catalog = new MusicCatalogService(database, artwork, settings);
	const query = new MusicQueryService(database);

	const albumDir = join(dir, 'Radiohead', 'OK Computer (1997)');
	const compDir = join(dir, 'Compilations', 'Now 1');
	mkdirSync(albumDir, { recursive: true });
	mkdirSync(compDir, { recursive: true });
	const files = [
		[join(albumDir, '01 - Airbag.flac'), { title: 'Airbag', artist: 'Radiohead', album_artist: 'Radiohead', album: 'OK Computer', track: '1', date: '1997', genre: 'Alternative' }],
		[join(albumDir, '02 - Paranoid Android.flac'), { title: 'Paranoid Android', artist: 'Radiohead', album_artist: 'Radiohead', album: 'OK Computer', track: '2', date: '1997', genre: 'Alternative' }],
		[join(compDir, '01.mp3'), { title: 'Porcelain', artist: 'Moby', album: 'Now 1', compilation: '1', track: '1' }],
		[join(compDir, '02.mp3'), { title: 'Get Lucky', artist: 'Daft Punk feat. Pharrell Williams', album: 'Now 1', compilation: '1', track: '2' }],
	] as const;
	for (const [p, t] of files) makeTrack(p, t as Record<string, string>);

	const ingest = async (p: string) => {
		const s = statSync(p);
		return catalog.ingest('src1', p, await readTrackTags(p), { size: s.size, modifiedAt: s.mtime.toISOString() });
	};

	it('catalogues albums, tracks and artists from tags', async () => {
		for (const [p] of files) expect((await ingest(p)).status).toBe('added');
		const albumsPage = query.listAlbums({ sort: 'title', order: 'asc' });
		expect(albumsPage.items.map((a) => a.title)).toEqual(['Now 1', 'OK Computer']);
		const ok = albumsPage.items.find((a) => a.title === 'OK Computer')!;
		expect(ok).toMatchObject({ year: 1997, trackCount: 2, artistCredit: 'Radiohead' });
		const comp = albumsPage.items.find((a) => a.title === 'Now 1')!;
		expect(comp.artistCredit).toBe('Various Artists');
		const detail = query.getAlbum(ok.id);
		expect(detail.tracks.map((t) => t.title)).toEqual(['Airbag', 'Paranoid Android']);
		expect(detail.genres).toEqual(['Alternative']);
	});

	it('splits featured artists and links them', () => {
		const t = query.listTracks({ q: 'lucky' }).items[0]!;
		expect(t.artists.map((a) => [a.name, a.role])).toEqual([
			['Daft Punk', 'primary'],
			['Pharrell Williams', 'featured'],
		]);
		const pharrell = query.listTracks({ q: 'lucky' }).items[0]!.artists[1]!;
		expect(query.getArtist(pharrell.id).appearsOn.map((a) => a.title)).toEqual(['Now 1']);
	});

	it('finds things by accent-insensitive FTS prefix search', () => {
		expect(query.search('para').tracks.map((t) => t.title)).toEqual(['Paranoid Android']);
		expect(query.search('radio').artists.map((a) => a.name)).toEqual(['Radiohead']);
	});

	it('attaches a second copy of a track instead of duplicating it', async () => {
		const copyDir = join(dir, 'Radiohead', 'OK Computer (1997)');
		const copy = join(copyDir, '01 - Airbag.mp3');
		makeTrack(copy, { title: 'Airbag', artist: 'Radiohead', album_artist: 'Radiohead', album: 'OK Computer', track: '1', date: '1997' });
		expect((await ingest(copy)).status).toBe('attached');
		const airbag = query.listTracks({ q: 'airbag' }).items;
		expect(airbag).toHaveLength(1);
		expect(query.getTrack(airbag[0]!.id).files).toHaveLength(2);
		expect(query.bestFile(airbag[0]!.id)?.lossless).toBe(true);
	});

	it('purges orphans down the chain', () => {
		const ids = sqlite.prepare("SELECT id FROM track_files WHERE file_path LIKE '%Compilations%'").all() as { id: string }[];
		expect(catalog.purgeOrphans(ids.map((r) => r.id))).toBe(2);
		expect(query.listAlbums({}).items.map((a) => a.title)).toEqual(['OK Computer']);
		expect(query.listTracks({ q: 'lucky' }).total).toBe(0);
	});
});
