#!/usr/bin/env tsx
/**
 * Cache Reconciliation Utility
 *
 * Scans the persistent transcode cache directory and reconciles it with
 * the transcode_cache database table:
 * - Matches completed caches to current movie files
 * - Re-registers orphaned caches by matching file paths from chunk-meta.json
 * - Cleans up truly orphaned caches that can't be matched
 *
 * Usage: pnpm cache:reconcile [--clean]
 *   --clean  Delete orphaned cache directories that can't be matched
 */
import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const shouldClean = process.argv.includes('--clean');

const __dirname = typeof import.meta.dirname === 'string'
	? import.meta.dirname
	: path.dirname(fileURLToPath(import.meta.url));

// Try multiple DB locations
const dbPaths = [
	path.resolve(__dirname, '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'db', 'mu.db'),
];

const dbPath = dbPaths.find(existsSync);
if (!dbPath) {
	console.error('Database not found. Tried:', dbPaths.join(', '));
	process.exit(1);
}

const db = new Database(dbPath);
console.log(`Using database: ${dbPath}`);

// Find cache directory
const cacheDirs = [
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(__dirname, '..', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(__dirname, '..', '..', 'data', 'cache', 'streams', 'persistent'),
];

let cacheDir = '';
for (const dir of cacheDirs) {
	if (existsSync(dir)) {
		cacheDir = dir;
		break;
	}
}

if (!cacheDir) {
	console.log('No persistent cache directory found');
	process.exit(0);
}

console.log(`Scanning cache directory: ${cacheDir}`);

// Ensure transcode_cache table exists
db.exec(`CREATE TABLE IF NOT EXISTS transcode_cache (
	id TEXT PRIMARY KEY,
	movie_file_id TEXT NOT NULL REFERENCES movie_files(id) ON DELETE CASCADE,
	quality TEXT NOT NULL,
	encoding_settings TEXT NOT NULL,
	completed_at TEXT NOT NULL
)`);

// Get all movie file IDs from DB
const dbFiles = db.prepare('SELECT id, file_path FROM movie_files').all() as { id: string; file_path: string }[];
const dbFileIds = new Set(dbFiles.map((r) => r.id));

// Build a lookup map: normalized file_path → file ID
const filePathToId = new Map<string, string>();
for (const f of dbFiles) {
	if (f.file_path) {
		// Normalize path for matching (lowercase, forward slashes)
		const normalized = f.file_path.toLowerCase().replace(/\\/g, '/');
		filePathToId.set(normalized, f.id);
		// Also store just the filename
		const fileName = path.basename(normalized);
		if (!filePathToId.has(fileName)) {
			filePathToId.set(fileName, f.id);
		}
	}
}

// Get existing cache entries
const existingCache = new Set(
	db.prepare("SELECT movie_file_id || ':' || quality as k FROM transcode_cache").all().map((r: any) => r.k),
);

const dirs = readdirSync(cacheDir);
let added = 0;
let orphaned = 0;
let orphanedMatched = 0;
let alreadyTracked = 0;
let incomplete = 0;
let cleaned = 0;

function tryMatchOrphan(dirPath: string): string | null {
	// Try to find a matching movie file by reading chunk-meta.json
	for (const quality of readdirSync(dirPath)) {
		const qPath = path.join(dirPath, quality);
		try { if (!statSync(qPath).isDirectory()) continue; } catch { continue; }

		const metaPath = path.join(qPath, 'chunk-meta.json');
		if (existsSync(metaPath)) {
			try {
				const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
				if (meta.filePath) {
					const normalized = meta.filePath.toLowerCase().replace(/\\/g, '/');
					const matchId = filePathToId.get(normalized);
					if (matchId) return matchId;
					// Try filename only
					const fileName = path.basename(normalized);
					const matchById = filePathToId.get(fileName);
					if (matchById) return matchById;
				}
			} catch {}
		}

		// Try reading stream.m3u8 for any clues (not useful, but check)
	}

	// Try matching the directory name as a partial file ID
	// (some old file IDs might partially overlap with new ones)
	return null;
}

function registerCache(fileId: string, quality: string, qualityPath: string): boolean {
	const key = `${fileId}:${quality}`;
	if (existingCache.has(key)) return false;

	const completePath = path.join(qualityPath, '.complete');
	if (!existsSync(completePath)) return false;

	const files = readdirSync(qualityPath);
	const segments = files.filter((f) => f.startsWith('segment_') && f.endsWith('.ts'));

	let totalSize = 0;
	for (const seg of segments) {
		try { totalSize += statSync(path.join(qualityPath, seg)).size; } catch {}
	}

	const id = crypto.randomUUID();
	try {
		db.prepare(
			'INSERT INTO transcode_cache (id, movie_file_id, quality, encoding_settings, completed_at) VALUES (?, ?, ?, ?, ?)',
		).run(
			id, fileId, quality,
			JSON.stringify({ hwAccel: 'none', preset: 'veryfast', rateControl: 'crf', crf: 23 }),
			new Date().toISOString(),
		);
	} catch (err: any) {
		console.log(`    SKIP: ${fileId}/${quality} — ${err.message}`);
		return false;
	}

	const sizeMB = (totalSize / 1048576).toFixed(1);
	console.log(`  Added: ${fileId}/${quality} (${segments.length} segments, ${sizeMB} MB)`);
	existingCache.add(key);
	return true;
}

for (const dirName of dirs) {
	const dirPath = path.join(cacheDir, dirName);
	try { if (!statSync(dirPath).isDirectory()) continue; } catch { continue; }

	const isKnown = dbFileIds.has(dirName);

	if (!isKnown) {
		// Try to match orphan to a current movie file via chunk-meta
		const matchedId = tryMatchOrphan(dirPath);

		if (matchedId) {
			console.log(`  Orphan matched: ${dirName} → ${matchedId}`);
			orphanedMatched++;

			// Register caches under the matched file ID
			const qualities = readdirSync(dirPath);
			for (const quality of qualities) {
				const qPath = path.join(dirPath, quality);
				try { if (!statSync(qPath).isDirectory()) continue; } catch { continue; }
				if (registerCache(matchedId, quality, qPath)) {
					added++;
				}
			}
		} else {
			orphaned++;
			if (shouldClean) {
				console.log(`  Cleaning orphan: ${dirName}`);
				try {
					rmSync(dirPath, { recursive: true, force: true });
					cleaned++;
				} catch (err: any) {
					console.log(`    Failed to clean: ${err.message}`);
				}
			} else {
				console.log(`  Orphaned: ${dirName} (use --clean to remove)`);
			}
		}
		continue;
	}

	// Known file ID — register any completed quality caches
	const qualities = readdirSync(dirPath);
	for (const quality of qualities) {
		const qPath = path.join(dirPath, quality);
		try { if (!statSync(qPath).isDirectory()) continue; } catch { continue; }

		const key = `${dirName}:${quality}`;
		if (existingCache.has(key)) {
			alreadyTracked++;
			continue;
		}

		if (existsSync(path.join(qPath, '.complete'))) {
			if (registerCache(dirName, quality, qPath)) {
				added++;
			}
		} else {
			const files = readdirSync(qPath);
			const segments = files.filter((f) => f.startsWith('segment_') && f.endsWith('.ts'));
			if (segments.length > 0) {
				incomplete++;
				console.log(`  Incomplete: ${dirName}/${quality} (${segments.length} segments)`);
			}
		}
	}
}

console.log('\n=== Reconciliation Summary ===');
console.log(`  Cache directories scanned: ${dirs.length}`);
console.log(`  Already tracked in DB:     ${alreadyTracked}`);
console.log(`  Newly added to DB:         ${added}`);
console.log(`  Orphans matched by path:   ${orphanedMatched}`);
console.log(`  Orphaned (unmatched):      ${orphaned}`);
if (shouldClean) {
	console.log(`  Orphans cleaned up:        ${cleaned}`);
}
console.log(`  Incomplete (no .complete):  ${incomplete}`);

const totalCache = db.prepare('SELECT COUNT(*) as c FROM transcode_cache').get() as any;
const totalFiles = db.prepare('SELECT COUNT(*) as c FROM movie_files WHERE available=1').get() as any;
console.log(`\n  Total cache entries:       ${totalCache.c}`);
console.log(`  Total available files:     ${totalFiles.c}`);
console.log(`  Cache coverage:            ${((totalCache.c / Math.max(totalFiles.c, 1)) * 100).toFixed(1)}%`);

if (orphaned > 0 && !shouldClean) {
	console.log(`\nRun with --clean to remove ${orphaned} orphaned cache directories`);
}

db.close();
