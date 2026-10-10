import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { resolveInside, safeSegments } from './upload-paths.js';

/**
 * Minimal, dependency-free ZIP reader for music uploads. Reads the central
 * directory (ZIP64 aware), then streams each entry out with `zlib` — `stored`
 * (0) and `deflate` (8) only, which is what every common archiver writes.
 * Encrypted entries, multi-disk archives and other methods are rejected.
 *
 * Safety: entry names are validated (no traversal / absolute paths) and
 * resolved inside the destination (zip-slip); entry count and declared total
 * size are capped up front, and every entry's real inflated size is enforced
 * while streaming, so an archive that lies about sizes (zip bomb) is cut off.
 */

export interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
	isDirectory: boolean;
	encrypted: boolean;
	isSymlink: boolean;
}

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

async function readAt(
	fh: Awaited<ReturnType<typeof open>>,
	position: number,
	length: number,
): Promise<Buffer> {
	const buf = Buffer.alloc(length);
	const { bytesRead } = await fh.read(buf, 0, length, position);
	if (bytesRead !== length) throw new ZipError('Truncated zip file');
	return buf;
}

function u64(buf: Buffer, off: number): number {
	const v = buf.readBigUInt64LE(off);
	if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('Zip entry too large');
	return Number(v);
}

/** Read the central directory of a zip file. */
export async function readZipEntries(
	filePath: string,
	opts: { maxEntries?: number } = {},
): Promise<ZipEntry[]> {
	const fh = await open(filePath, 'r');
	try {
		const { size } = await fh.stat();
		if (size < 22) throw new ZipError('Not a zip file');
		const tailLen = Math.min(size, 22 + MAX_COMMENT);
		const tail = await readAt(fh, size - tailLen, tailLen);
		let eocd = -1;
		for (let i = tailLen - 22; i >= 0; i--) {
			if (tail.readUInt32LE(i) === SIG_EOCD) {
				eocd = i;
				break;
			}
		}
		if (eocd < 0) throw new ZipError('Not a zip file (no end-of-central-directory record)');
		const diskNo = tail.readUInt16LE(eocd + 4);
		let count = tail.readUInt16LE(eocd + 10);
		let cdSize = tail.readUInt32LE(eocd + 12);
		let cdOffset = tail.readUInt32LE(eocd + 16);
		if (diskNo !== 0 && diskNo !== 0xffff)
			throw new ZipError('Multi-part zips are not supported');

		if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
			const locPos = size - tailLen + eocd - 20;
			if (locPos < 0) throw new ZipError('Corrupt ZIP64 archive');
			const loc = await readAt(fh, locPos, 20);
			if (loc.readUInt32LE(0) !== SIG_ZIP64_LOCATOR)
				throw new ZipError('Corrupt ZIP64 archive');
			const z64 = await readAt(fh, u64(loc, 8), 56);
			if (z64.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new ZipError('Corrupt ZIP64 archive');
			count = u64(z64, 32);
			cdSize = u64(z64, 40);
			cdOffset = u64(z64, 48);
		}

		if (opts.maxEntries !== undefined && count > opts.maxEntries) {
			throw new ZipError(`Zip has too many entries (${count} > ${opts.maxEntries})`);
		}
		if (cdOffset + cdSize > size) throw new ZipError('Corrupt zip central directory');

		const cd = await readAt(fh, cdOffset, cdSize);
		const entries: ZipEntry[] = [];
		let p = 0;
		for (let n = 0; n < count; n++) {
			if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) {
				throw new ZipError('Corrupt zip central directory');
			}
			const madeBy = cd.readUInt16LE(p + 4) >> 8;
			const flags = cd.readUInt16LE(p + 8);
			const method = cd.readUInt16LE(p + 10);
			let compressedSize = cd.readUInt32LE(p + 20);
			let uncompressedSize = cd.readUInt32LE(p + 24);
			const nameLen = cd.readUInt16LE(p + 28);
			const extraLen = cd.readUInt16LE(p + 30);
			const commentLen = cd.readUInt16LE(p + 32);
			const extAttr = cd.readUInt32LE(p + 38);
			let localHeaderOffset = cd.readUInt32LE(p + 42);
			const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);

			// ZIP64 extended info: only the fields that overflowed are present, in order.
			let e = p + 46 + nameLen;
			const extraEnd = e + extraLen;
			while (e + 4 <= extraEnd) {
				const id = cd.readUInt16LE(e);
				const len = cd.readUInt16LE(e + 2);
				if (id === 0x0001) {
					let q = e + 4;
					if (uncompressedSize === 0xffffffff) {
						uncompressedSize = u64(cd, q);
						q += 8;
					}
					if (compressedSize === 0xffffffff) {
						compressedSize = u64(cd, q);
						q += 8;
					}
					if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, q);
				}
				e += 4 + len;
			}

			const unixMode = madeBy === 3 ? extAttr >>> 16 : 0;
			entries.push({
				name,
				method,
				compressedSize,
				uncompressedSize,
				localHeaderOffset,
				isDirectory: name.endsWith('/') || name.endsWith('\\'),
				encrypted: (flags & 0x1) !== 0,
				isSymlink: (unixMode & 0o170000) === 0o120000,
			});
			p = extraEnd + commentLen;
		}
		return entries;
	} finally {
		await fh.close();
	}
}

/** Offset of an entry's data (past its local header, whose extra field can differ). */
async function dataOffset(filePath: string, entry: ZipEntry): Promise<number> {
	const fh = await open(filePath, 'r');
	try {
		const h = await readAt(fh, entry.localHeaderOffset, 30);
		if (h.readUInt32LE(0) !== SIG_LOCAL) throw new ZipError('Corrupt zip local header');
		return entry.localHeaderOffset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
	} finally {
		await fh.close();
	}
}

export interface ExtractOptions {
	maxEntries: number;
	/** Cap on the sum of uncompressed sizes (declared and actual). */
	maxTotalBytes: number;
	/** Entry filter by name (e.g. allowed extensions). Rejected entries are skipped. */
	allow: (name: string) => boolean;
	/** Strip this leading folder from every entry (single-root archives). */
	stripPrefix?: string | null;
}

export interface ExtractResult {
	/** Absolute paths written. */
	written: string[];
	/** Entry names skipped (filtered, directories excluded, or already present). */
	skipped: string[];
	totalBytes: number;
}

/** Junk archivers add (macOS resource forks, Finder / Windows metadata). */
function isJunk(name: string): boolean {
	const segs = name.split(/[\\/]+/);
	const base = segs[segs.length - 1] ?? '';
	return segs.includes('__MACOSX') || base === '.DS_Store' || base === 'Thumbs.db';
}

/** The single top-level folder all entries share, if any. */
export function commonRoot(entries: ZipEntry[]): string | null {
	let root: string | null = null;
	for (const e of entries) {
		if (isJunk(e.name)) continue;
		const segs = e.name.split(/[\\/]+/).filter(Boolean);
		if (segs.length < 2 && !e.isDirectory) return null;
		const first = segs[0] ?? '';
		if (root === null) root = first;
		else if (root !== first) return null;
	}
	return root;
}

/**
 * Validate every entry (throws on the first unsafe one — a hostile archive is
 * rejected whole rather than partly extracted), then extract allowed entries
 * under `destDir`. Existing files are never overwritten (reported as skipped).
 */
export async function extractZip(
	zipPath: string,
	destDir: string,
	opts: ExtractOptions,
): Promise<ExtractResult> {
	const entries = await readZipEntries(zipPath, { maxEntries: opts.maxEntries });
	const plan: { entry: ZipEntry; target: string }[] = [];
	const skipped: string[] = [];
	let declared = 0;

	for (const entry of entries) {
		if (entry.isDirectory || isJunk(entry.name)) continue;
		let segs: string[];
		try {
			segs = safeSegments(entry.name);
		} catch (err) {
			throw new ZipError(`Unsafe entry "${entry.name}": ${(err as Error).message}`);
		}
		if (opts.stripPrefix && segs[0] === opts.stripPrefix && segs.length > 1)
			segs = segs.slice(1);
		let target: string;
		try {
			target = resolveInside(destDir, segs);
		} catch (err) {
			throw new ZipError(`Unsafe entry "${entry.name}": ${(err as Error).message}`);
		}
		if (entry.isSymlink) {
			skipped.push(entry.name);
			continue;
		}
		if (!opts.allow(entry.name)) {
			skipped.push(entry.name);
			continue;
		}
		if (entry.encrypted) throw new ZipError('Encrypted zips are not supported');
		if (entry.method !== 0 && entry.method !== 8) {
			throw new ZipError(
				`Unsupported compression in "${entry.name}" (method ${entry.method})`,
			);
		}
		declared += entry.uncompressedSize;
		if (declared > opts.maxTotalBytes) {
			throw new ZipError('Zip contents exceed the maximum uncompressed size');
		}
		plan.push({ entry, target });
	}

	const written: string[] = [];
	let total = 0;
	for (const { entry, target } of plan) {
		if (
			await stat(target)
				.then(() => true)
				.catch(() => false)
		) {
			skipped.push(entry.name);
			continue;
		}
		await mkdir(path.dirname(target), { recursive: true });
		const start = await dataOffset(zipPath, entry);
		const tmp = `${target}.uploading`;
		let entryBytes = 0;
		const limit = entry.uncompressedSize;
		const guard = new Transform({
			transform(chunk: Buffer, _enc, cb) {
				entryBytes += chunk.length;
				total += chunk.length;
				if (entryBytes > limit)
					return cb(new ZipError(`"${entry.name}" is larger than declared`));
				if (total > opts.maxTotalBytes) {
					return cb(new ZipError('Zip contents exceed the maximum uncompressed size'));
				}
				cb(null, chunk);
			},
		});
		const source =
			entry.compressedSize > 0
				? createReadStream(zipPath, { start, end: start + entry.compressedSize - 1 })
				: Readable.from([]);
		try {
			if (entry.method === 8) {
				await pipeline(source, createInflateRaw(), guard, createWriteStream(tmp));
			} else {
				await pipeline(source, guard, createWriteStream(tmp));
			}
			if (entryBytes !== limit) throw new ZipError(`"${entry.name}" is truncated`);
			await rename(tmp, target);
		} catch (err) {
			await unlink(tmp).catch(() => {});
			throw err;
		}
		written.push(target);
	}
	return { written, skipped, totalBytes: total };
}
