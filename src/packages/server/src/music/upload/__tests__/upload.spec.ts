import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	isAllowedMusicFile,
	looseTrackSegments,
	resolveInside,
	safeSegments,
	sanitizeSegment,
} from '../upload-paths.js';
import { commonRoot, extractZip, readZipEntries } from '../zip-reader.js';

interface FakeEntry {
	name: string;
	data: Buffer | string;
	deflate?: boolean;
	/** Override the declared uncompressed size (zip-bomb liar). */
	declaredSize?: number;
	symlink?: boolean;
	encrypted?: boolean;
}

/** Minimal zip writer for tests (no ZIP64). */
function makeZip(entries: FakeEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const e of entries) {
		const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
		const body = e.deflate ? deflateRawSync(raw) : raw;
		const name = Buffer.from(e.name, 'utf8');
		const size = e.declaredSize ?? raw.length;
		const flags = 0x800 | (e.encrypted ? 1 : 0);
		const method = e.deflate ? 8 : 0;
		const crc = crc32(raw);

		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(20, 4);
		lh.writeUInt16LE(flags, 6);
		lh.writeUInt16LE(method, 8);
		lh.writeUInt32LE(crc, 14);
		lh.writeUInt32LE(body.length, 18);
		lh.writeUInt32LE(size, 22);
		lh.writeUInt16LE(name.length, 26);
		locals.push(lh, name, body);

		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE((3 << 8) | 20, 4);
		ch.writeUInt16LE(20, 6);
		ch.writeUInt16LE(flags, 8);
		ch.writeUInt16LE(method, 10);
		ch.writeUInt32LE(crc, 16);
		ch.writeUInt32LE(body.length, 20);
		ch.writeUInt32LE(size, 24);
		ch.writeUInt16LE(name.length, 28);
		ch.writeUInt32LE(((e.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
		ch.writeUInt32LE(offset, 42);
		centrals.push(ch, name);
		offset += 30 + name.length + body.length;
	}
	const cd = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, eocd]);
}

const OPTS = { maxEntries: 100, maxTotalBytes: 1_000_000, allow: isAllowedMusicFile };

let dir: string;
let dest: string;
let zipPath: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'mu-zip-'));
	dest = path.join(dir, 'library');
	zipPath = path.join(dir, 'up.zip');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeZip(entries: FakeEntry[]) {
	writeFileSync(zipPath, makeZip(entries));
}

describe('zip reader', () => {
	it('lists entries and extracts stored + deflated files', async () => {
		const audio = Buffer.alloc(5000, 7);
		writeZip([
			{ name: 'Artist/Album/01 One.flac', data: audio, deflate: true },
			{ name: 'Artist/Album/cover.jpg', data: 'jpg-bytes' },
			{ name: 'Artist/Album/notes.txt', data: 'skip me' },
			{ name: '__MACOSX/Artist/._01 One.flac', data: 'junk' },
		]);
		const entries = await readZipEntries(zipPath);
		expect(entries.map((e) => e.name)).toContain('Artist/Album/01 One.flac');
		expect(commonRoot(entries)).toBe('Artist');

		const r = await extractZip(zipPath, dest, OPTS);
		expect(r.written).toHaveLength(2);
		expect(r.skipped).toEqual(['Artist/Album/notes.txt']);
		expect(readFileSync(path.join(dest, 'Artist/Album/01 One.flac'))).toEqual(audio);
		expect(readFileSync(path.join(dest, 'Artist/Album/cover.jpg'), 'utf8')).toBe('jpg-bytes');
	});

	it('rejects zip-slip entries before writing anything', async () => {
		writeZip([
			{ name: 'ok/track.mp3', data: 'a' },
			{ name: '../../evil.mp3', data: 'b' },
		]);
		await expect(extractZip(zipPath, dest, OPTS)).rejects.toThrow(/Unsafe entry/);
		expect(existsSync(path.join(dest, 'ok/track.mp3'))).toBe(false);
		expect(existsSync(path.join(dir, 'evil.mp3'))).toBe(false);
	});

	it('rejects absolute and backslash traversal names', async () => {
		writeZip([{ name: '/etc/x.mp3', data: 'a' }]);
		await expect(extractZip(zipPath, dest, OPTS)).rejects.toThrow(/Unsafe entry/);
		writeZip([{ name: 'a\\..\\..\\x.mp3', data: 'a' }]);
		await expect(extractZip(zipPath, dest, OPTS)).rejects.toThrow(/Unsafe entry/);
	});

	it('enforces the entry-count cap', async () => {
		writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `a/${i}.mp3`, data: 'x' })));
		await expect(extractZip(zipPath, dest, { ...OPTS, maxEntries: 4 })).rejects.toThrow(
			/too many entries/,
		);
	});

	it('enforces the declared total-size cap', async () => {
		writeZip([
			{ name: 'a/1.mp3', data: Buffer.alloc(600) },
			{ name: 'a/2.mp3', data: Buffer.alloc(600) },
		]);
		await expect(extractZip(zipPath, dest, { ...OPTS, maxTotalBytes: 1000 })).rejects.toThrow(
			/maximum uncompressed size/,
		);
	});

	it('cuts off an entry that inflates past its declared size (zip bomb)', async () => {
		writeZip([
			{ name: 'a/bomb.flac', data: Buffer.alloc(200_000), deflate: true, declaredSize: 100 },
		]);
		await expect(extractZip(zipPath, dest, OPTS)).rejects.toThrow(/larger than declared/);
		expect(existsSync(path.join(dest, 'a/bomb.flac'))).toBe(false);
		expect(existsSync(path.join(dest, 'a/bomb.flac.uploading'))).toBe(false);
	});

	it('skips symlinks and never overwrites existing files', async () => {
		writeZip([
			{ name: 'a/link.mp3', data: '/etc/passwd', symlink: true },
			{ name: 'a/1.mp3', data: 'new' },
		]);
		const first = await extractZip(zipPath, dest, OPTS);
		expect(first.written).toHaveLength(1);
		expect(first.skipped).toContain('a/link.mp3');
		writeFileSync(path.join(dest, 'a/1.mp3'), 'mine');
		const again = await extractZip(zipPath, dest, OPTS);
		expect(again.written).toHaveLength(0);
		expect(readFileSync(path.join(dest, 'a/1.mp3'), 'utf8')).toBe('mine');
	});

	it('rejects encrypted entries and non-zips', async () => {
		writeZip([{ name: 'a/1.mp3', data: 'x', encrypted: true }]);
		await expect(extractZip(zipPath, dest, OPTS)).rejects.toThrow(/Encrypted/);
		writeFileSync(zipPath, 'definitely not a zip file at all');
		await expect(readZipEntries(zipPath)).rejects.toThrow(/Not a zip/);
	});

	it('reports no common root for loose archives', async () => {
		writeZip([
			{ name: '1.mp3', data: 'x' },
			{ name: '2.mp3', data: 'y' },
		]);
		expect(commonRoot(await readZipEntries(zipPath))).toBeNull();
	});
});

describe('upload paths', () => {
	it('validates relative segments', () => {
		expect(safeSegments('Artist/Album/01.flac')).toEqual(['Artist', 'Album', '01.flac']);
		expect(safeSegments('a\\b.mp3')).toEqual(['a', 'b.mp3']);
		expect(() => safeSegments('../x.mp3')).toThrow();
		expect(() => safeSegments('/abs.mp3')).toThrow();
		expect(() => safeSegments('C:/x.mp3')).toThrow();
		expect(() => safeSegments('a/\0.mp3')).toThrow();
		expect(() => safeSegments('')).toThrow();
	});

	it('keeps resolved paths inside the root', () => {
		const root = path.resolve('/music');
		expect(resolveInside(root, ['a', 'b.mp3'])).toBe(path.join(root, 'a', 'b.mp3'));
		expect(() => resolveInside(root, ['..', 'x'])).toThrow();
		expect(() => resolveInside(root, [])).toThrow();
	});

	it('builds <Artist>/<Album>/<file> for loose tracks', () => {
		expect(looseTrackSegments({ artist: 'Björk', album: 'Post' }, '01 Army.flac')).toEqual([
			'Björk',
			'Post',
			'01 Army.flac',
		]);
		expect(
			looseTrackSegments({ albumArtist: 'Various', artist: 'X', album: 'Hits' }, 'a.mp3'),
		).toEqual(['Various', 'Hits', 'a.mp3']);
		expect(looseTrackSegments({ artist: 'AC/DC', album: null }, 'x.mp3')).toEqual([
			'AC DC',
			'Unknown Album',
			'x.mp3',
		]);
		expect(looseTrackSegments({}, 'untagged.mp3')).toEqual(['untagged.mp3']);
	});

	it('sanitizes folder names', () => {
		expect(sanitizeSegment('..', 'x')).toBe('x');
		expect(sanitizeSegment('  a:b?  ', 'x')).toBe('a b');
		expect(sanitizeSegment('Dots...', 'x')).toBe('Dots');
		expect(sanitizeSegment('', 'Fallback')).toBe('Fallback');
	});

	it('allows audio, art, cue and lrc only', () => {
		expect(isAllowedMusicFile('a.flac')).toBe(true);
		expect(isAllowedMusicFile('cover.JPG')).toBe(true);
		expect(isAllowedMusicFile('a.cue')).toBe(true);
		expect(isAllowedMusicFile('a.lrc')).toBe(true);
		expect(isAllowedMusicFile('a.exe')).toBe(false);
		expect(isAllowedMusicFile('a.txt')).toBe(false);
	});
});
