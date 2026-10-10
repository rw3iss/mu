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
import { AlbumEditService } from '../catalog/album-edit.service.js';
import { ArtworkService } from '../catalog/artwork.service.js';
import { MusicCatalogService } from '../catalog/catalog.service.js';
import { readTrackTags } from '../ingest/tags.js';

const require = createRequire(import.meta.url);
const hasFfmpeg = (() => {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

function makeTrack(path: string, tags: Record<string, string>) {
	const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
	execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=6', ...meta, path]);
}

describe.skipIf(!hasFfmpeg)('album merge / split', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mu-albumedit-'));
	const sqlite = new Database(join(dir, 'test.db'));
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
		CREATE TABLE playlists (id TEXT PRIMARY KEY);
		CREATE TABLE media_sources (id TEXT PRIMARY KEY, path TEXT, kind TEXT NOT NULL DEFAULT 'video');
		CREATE TABLE stream_sessions (id TEXT PRIMARY KEY);
		CREATE TABLE favorites (id TEXT PRIMARY KEY, user_id TEXT, entity_type TEXT, entity_id TEXT, role TEXT, created_at TEXT,
			UNIQUE (user_id, entity_type, entity_id));
		INSERT INTO users (id) VALUES ('u1');
		INSERT INTO media_sources (id, path, kind) VALUES ('src1', '${dir}', 'audio');`);
	require('../../../../../scripts/migrations/media-kinds.js').apply(sqlite);
	const db = drizzle(sqlite, { schema });
	const database = { db } as never;
	const config = { get: (k: string) => (k === 'cache.dir' ? join(dir, 'cache') : dir) } as never;
	const settings = { get: () => DEFAULT_MUSIC_SETTINGS } as never;
	const lifecycle = {
		purge: (ref: { type: string; id: string }) =>
			sqlite
				.prepare('DELETE FROM favorites WHERE entity_type = ? AND entity_id = ?')
				.run(ref.type, ref.id),
	} as never;
	const catalog = new MusicCatalogService(
		database,
		new ArtworkService(config, database),
		settings,
	);
	const edit = new AlbumEditService(database, catalog, lifecycle);

	// Same album split over two folders (disc folders without a disc tag).
	const a = join(dir, 'Band', 'Album CD1');
	const b = join(dir, 'Band', 'Album CD2');
	mkdirSync(a, { recursive: true });
	mkdirSync(b, { recursive: true });
	const files = [
		[
			join(a, '01.flac'),
			{ title: 'One', artist: 'Band', album_artist: 'Band', album: 'Album', track: '1' },
		],
		[
			join(a, '02.flac'),
			{ title: 'Two', artist: 'Band', album_artist: 'Band', album: 'Album', track: '2' },
		],
		[
			join(b, '01.flac'),
			{ title: 'Three', artist: 'Band', album_artist: 'Band', album: 'Album', track: '3' },
		],
	] as const;
	for (const [p, t] of files) makeTrack(p, t);
	const ingest = async (p: string) => {
		const s = statSync(p);
		return catalog.ingest('src1', p, await readTrackTags(p), {
			size: s.size,
			modifiedAt: s.mtime.toISOString(),
		});
	};
	for (const [p] of files) await ingest(p);

	const albumIds = () =>
		sqlite.prepare('SELECT id, track_count AS n FROM albums ORDER BY added_at').all() as {
			id: string;
			n: number;
		}[];

	it('folder grouping created two albums', () => {
		expect(albumIds().map((x) => x.n)).toEqual([2, 1]);
	});

	it('merge moves tracks, favourites, and aliases the folder', async () => {
		const [target, source] = albumIds();
		sqlite
			.prepare("INSERT INTO favorites VALUES ('f1','u1','album',?,NULL,'2026-01-01')")
			.run(source!.id);
		const res = edit.merge(source!.id, target!.id);
		expect(res.movedTracks).toBe(1);
		expect(albumIds()).toEqual([{ id: target!.id, n: 3 }]);
		expect(sqlite.prepare("SELECT entity_id FROM favorites WHERE id = 'f1'").get()).toEqual({
			entity_id: target!.id,
		});
		// A new file in the merged-away folder joins the surviving album.
		const extra = join(b, '02.flac');
		makeTrack(extra, {
			title: 'Four',
			artist: 'Band',
			album_artist: 'Band',
			album: 'Album',
			track: '4',
		});
		const r = await ingest(extra);
		expect(r.status === 'added' && r.albumId).toBe(target!.id);
		expect(albumIds()).toEqual([{ id: target!.id, n: 4 }]);
	});

	it('split moves chosen tracks into a new album', () => {
		const [album] = albumIds();
		const ids = (
			sqlite
				.prepare('SELECT id FROM tracks WHERE album_id = ? ORDER BY track_no LIMIT 2')
				.all(album!.id) as { id: string }[]
		).map((r) => r.id);
		const res = edit.split(album!.id, ids, 'Album (Disc 1)');
		expect(res.movedTracks).toBe(2);
		expect(
			albumIds()
				.map((x) => x.n)
				.sort(),
		).toEqual([2, 2]);
		expect(() => edit.split(res.albumId, ids, 'x')).toThrow(/Leave at least one/);
	});
});
