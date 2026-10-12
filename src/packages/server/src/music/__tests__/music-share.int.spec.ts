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
import { MusicShareService } from '../share/music-share.service.js';

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

describe.skipIf(!hasFfmpeg)('music share links', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mu-share-'));
	const sqlite = new Database(join(dir, 'test.db'));
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
		CREATE TABLE playlists (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, description TEXT, cover_url TEXT,
			is_smart INTEGER, is_public INTEGER DEFAULT 0, public_edit INTEGER, smart_rules TEXT, created_at TEXT, updated_at TEXT);
		CREATE TABLE media_sources (id TEXT PRIMARY KEY, path TEXT, kind TEXT NOT NULL DEFAULT 'video');
		CREATE TABLE stream_sessions (id TEXT PRIMARY KEY);
		INSERT INTO users (id) VALUES ('owner'), ('other');
		INSERT INTO media_sources (id, path, kind) VALUES ('src1', '${dir}', 'audio');`);
	require('../../../../../scripts/migrations/media-kinds.js').apply(sqlite);
	const db = drizzle(sqlite, { schema });
	const database = { db } as never;
	const config = { get: (k: string) => (k === 'cache.dir' ? join(dir, 'cache') : dir) } as never;
	const musicSettings = { get: () => DEFAULT_MUSIC_SETTINGS } as never;
	let expiryDays: number | null = 30;
	const appSettings = { get: () => expiryDays } as never;
	const catalog = new MusicCatalogService(
		database,
		new ArtworkService(config, database),
		musicSettings,
	);
	const query = new MusicQueryService(database);
	const stream = {
		start: (trackId: string) => ({
			streamUrl: `/api/v1/music/files/f-${trackId}?p=original&c=`,
			waveformUrl: `/api/v1/music/waveform/f-${trackId}`,
		}),
	} as never;
	const shares = new MusicShareService(database, appSettings, query, stream);

	const a = join(dir, 'A', 'Album A');
	const b = join(dir, 'B', 'Album B');
	mkdirSync(a, { recursive: true });
	mkdirSync(b, { recursive: true });
	const files = [
		[join(a, '1.mp3'), { title: 'A1', artist: 'A', album: 'Album A', track: '1' }],
		[join(a, '2.mp3'), { title: 'A2', artist: 'A', album: 'Album A', track: '2' }],
		[join(b, '1.mp3'), { title: 'B1', artist: 'B', album: 'Album B', track: '1' }],
	] as const;
	for (const [p, t] of files) makeTrack(p, t);
	const ids: Record<string, { trackId: string; albumId: string }> = {};
	for (const [p, t] of files) {
		const s = statSync(p);
		const r = await catalog.ingest('src1', p, await readTrackTags(p), {
			size: s.size,
			modifiedAt: s.mtime.toISOString(),
		});
		if (r.status === 'added') ids[t.title] = { trackId: r.trackId, albumId: r.albumId };
	}
	const owner = { id: 'owner', role: 'viewer' };

	it('album share plays only that album, with public stream/art URLs', () => {
		const s = shares.create(owner, { kind: 'album', id: ids.A1!.albumId });
		expect(s.path).toBe(`/listen/${s.token}`);
		const p = shares.payload(s.token);
		expect(p.tracks.map((t) => t.title)).toEqual(['A1', 'A2']);
		const session = shares.startStream(s.token, ids.A2!.trackId, {});
		expect(session.streamUrl).toContain(`/api/v1/music/public/${s.token}/files/`);
		expect(session.waveformUrl).toContain(`/api/v1/music/public/${s.token}/waveform/`);
		expect(() => shares.startStream(s.token, ids.B1!.trackId, {})).toThrow(
			/not part of this share/,
		);
		expect(() => shares.assertLyrics(s.token, ids.B1!.trackId)).toThrow();
	});

	it('queue share is a snapshot of existing tracks', () => {
		const s = shares.create(owner, {
			kind: 'queue',
			trackIds: [ids.B1!.trackId, ids.A1!.trackId, 'missing'],
		});
		expect(shares.payload(s.token).tracks.map((t) => t.title)).toEqual(['B1', 'A1']);
		expect(s.title).toBe('2 tracks');
	});

	it('playlists: owner or public only, music playlists only', () => {
		sqlite.exec(`INSERT INTO playlists (id, user_id, name, is_public, kind, created_at, updated_at)
			VALUES ('p1', 'other', 'Theirs', 0, 'audio', 'x', 'x'), ('p2', 'other', 'Public', 1, 'audio', 'x', 'x');
			INSERT INTO playlist_items (id, playlist_id, item_type, item_id, position, added_at)
			VALUES ('i1', 'p2', 'track', '${ids.B1!.trackId}', 1, 'x');`);
		expect(() => shares.create(owner, { kind: 'playlist', id: 'p1' })).toThrow(/own or public/);
		const s = shares.create(owner, { kind: 'playlist', id: 'p2' });
		expect(shares.payload(s.token).tracks.map((t) => t.title)).toEqual(['B1']);
	});

	it('expired links are gone; revoke is owner-only', () => {
		const s = shares.create(owner, { kind: 'track', id: ids.A1!.trackId });
		expect(() => shares.revoke({ id: 'other', role: 'viewer' }, s.token)).toThrow(/Not your/);
		sqlite
			.prepare('UPDATE music_shares SET expires_at = ? WHERE id = ?')
			.run('2000-01-01T00:00:00Z', s.token);
		expect(() => shares.payload(s.token)).toThrow(/expired/);
		expect(shares.listMine('owner').some((x) => x.token === s.token)).toBe(false);
		shares.revoke(owner, s.token);
		expect(() => shares.payload(s.token)).toThrow(/does not exist/);
		expect(() => shares.payload('nope')).toThrow(/does not exist/);
	});

	it('never-expiring links when the expiry setting is 0', () => {
		expiryDays = 0;
		expect(shares.create(owner, { kind: 'track', id: ids.A1!.trackId }).expiresAt).toBeNull();
	});
});
