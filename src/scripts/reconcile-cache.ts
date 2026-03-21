#!/usr/bin/env tsx
/**
 * Cache Reconciliation Utility
 *
 * Scans the persistent transcode cache directory and reconciles it with
 * the transcode_cache database table. Finds completed caches on disk
 * that aren't tracked in the DB and adds them.
 *
 * Usage: pnpm cache:reconcile
 */
import crypto from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = path.resolve(import.meta.dirname, '..', 'data', 'db', 'mu.db');
if (!existsSync(dbPath)) {
	// Try alternative path
	const altPath = path.resolve(import.meta.dirname, '..', '..', 'data', 'db', 'mu.db');
	if (!existsSync(altPath)) {
		console.error('Database not found at', dbPath, 'or', altPath);
		process.exit(1);
	}
}

const db = new Database(existsSync(dbPath) ? dbPath : path.resolve(import.meta.dirname, '..', '..', 'data', 'db', 'mu.db'));

// Find cache directory
const cacheDirs = [
	path.resolve(import.meta.dirname, '..', 'packages', 'server', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(import.meta.dirname, '..', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(import.meta.dirname, '..', '..', 'data', 'cache', 'streams', 'persistent'),
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

// Get all movie file IDs from DB
const dbFileIds = new Set(
	db.prepare('SELECT id FROM movie_files').all().map((r: any) => r.id),
);

// Get existing cache entries
const existingCache = new Set(
	db.prepare('SELECT movie_file_id || \':\' || quality FROM transcode_cache').all().map((r: any) => Object.values(r)[0]),
);

const dirs = readdirSync(cacheDir);
let added = 0;
let orphaned = 0;
let alreadyTracked = 0;
let incomplete = 0;

for (const fileId of dirs) {
	const filePath = path.join(cacheDir, fileId);
	try {
		if (!statSync(filePath).isDirectory()) continue;
	} catch {
		continue;
	}

	// Check if file ID exists in DB
	if (!dbFileIds.has(fileId)) {
		orphaned++;
		continue;
	}

	const qualities = readdirSync(filePath);
	for (const quality of qualities) {
		const qualityPath = path.join(filePath, quality);
		try {
			if (!statSync(qualityPath).isDirectory()) continue;
		} catch {
			continue;
		}

		const completePath = path.join(qualityPath, '.complete');
		const key = `${fileId}:${quality}`;

		if (existingCache.has(key)) {
			alreadyTracked++;
			continue;
		}

		if (!existsSync(completePath)) {
			// Check if there are segments (partial cache)
			const files = readdirSync(qualityPath);
			const segments = files.filter((f) => f.startsWith('segment_') && f.endsWith('.ts'));
			if (segments.length > 0) {
				incomplete++;
				console.log(`  Incomplete: ${fileId}/${quality} (${segments.length} segments)`);
			}
			continue;
		}

		// Count segments for info
		const files = readdirSync(qualityPath);
		const segments = files.filter((f) => f.startsWith('segment_') && f.endsWith('.ts'));

		// Calculate total size
		let totalSize = 0;
		for (const seg of segments) {
			try {
				totalSize += statSync(path.join(qualityPath, seg)).size;
			} catch {}
		}

		// Insert into transcode_cache
		const id = crypto.randomUUID();
		db.prepare(
			'INSERT INTO transcode_cache (id, movie_file_id, quality, encoding_settings, completed_at) VALUES (?, ?, ?, ?, ?)',
		).run(
			id,
			fileId,
			quality,
			JSON.stringify({ hwAccel: 'none', preset: 'veryfast', rateControl: 'crf', crf: 23 }),
			new Date().toISOString(),
		);

		added++;
		const sizeMB = (totalSize / 1048576).toFixed(1);
		console.log(`  Added: ${fileId}/${quality} (${segments.length} segments, ${sizeMB} MB)`);
	}
}

console.log('\n=== Reconciliation Summary ===');
console.log(`  Cache directories scanned: ${dirs.length}`);
console.log(`  Already tracked in DB:     ${alreadyTracked}`);
console.log(`  Newly added to DB:         ${added}`);
console.log(`  Orphaned (no DB record):   ${orphaned}`);
console.log(`  Incomplete (no .complete):  ${incomplete}`);

const totalCache = db.prepare('SELECT COUNT(*) as c FROM transcode_cache').get() as any;
console.log(`  Total cache entries:       ${totalCache.c}`);

db.close();
