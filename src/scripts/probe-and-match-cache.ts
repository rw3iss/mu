#!/usr/bin/env tsx
/**
 * Probe movie files for duration, then match orphaned caches by duration.
 *
 * Step 1: FFprobe all movie files missing duration_seconds
 * Step 2: Match orphaned cache dirs to current files by manifest duration
 * Step 3: Register matched caches in transcode_cache DB
 *
 * Usage: pnpm probe-match-cache
 */
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = typeof import.meta.dirname === 'string'
	? import.meta.dirname
	: path.dirname(fileURLToPath(import.meta.url));

const dbPaths = [
	path.resolve(__dirname, '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'db', 'mu.db'),
];
const dbPath = dbPaths.find(existsSync);
if (!dbPath) { console.error('DB not found'); process.exit(1); }

const db = new Database(dbPath);
console.log('DB:', dbPath);

// Find ffprobe
const ffprobePaths = ['ffprobe', 'C:/ffmpeg/ffprobe.exe', '/usr/bin/ffprobe', '/usr/local/bin/ffprobe'];
let ffprobe = 'ffprobe';
for (const fp of ffprobePaths) {
	try {
		execSync(`"${fp}" -version`, { stdio: 'ignore', timeout: 3000 });
		ffprobe = fp;
		break;
	} catch {}
}
console.log('FFprobe:', ffprobe);

// Find cache dir
const cacheDirs = [
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(__dirname, '..', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(__dirname, '..', '..', 'data', 'cache', 'streams', 'persistent'),
];
const cacheDir = cacheDirs.find(existsSync) || '';
if (!cacheDir) { console.log('No cache dir found'); process.exit(0); }
console.log('Cache:', cacheDir);

// Ensure table
db.exec(`CREATE TABLE IF NOT EXISTS transcode_cache (
	id TEXT PRIMARY KEY, movie_file_id TEXT NOT NULL REFERENCES movie_files(id) ON DELETE CASCADE,
	quality TEXT NOT NULL, encoding_settings TEXT NOT NULL, completed_at TEXT NOT NULL,
	file_path TEXT, cache_path TEXT, size_bytes INTEGER, segment_count INTEGER
)`);

// ═══ Step 1: Probe files for duration ═══
console.log('\n═══ Step 1: Probing files for duration ═══');

const filesNeedingDuration = db.prepare(
	'SELECT id, file_path FROM movie_files WHERE available=1 AND (duration_seconds IS NULL OR duration_seconds=0)',
).all() as { id: string; file_path: string }[];

console.log(`${filesNeedingDuration.length} files need probing`);
let probed = 0;
let probeFailed = 0;

for (const f of filesNeedingDuration) {
	if (!f.file_path || !existsSync(f.file_path)) { probeFailed++; continue; }
	try {
		const cmd = `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${f.file_path}"`;
		const out = execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim();
		const dur = Math.round(parseFloat(out));
		if (dur > 0) {
			db.prepare('UPDATE movie_files SET duration_seconds=? WHERE id=?').run(dur, f.id);
			probed++;
			if (probed % 20 === 0) console.log(`  Probed ${probed}/${filesNeedingDuration.length}...`);
		}
	} catch {
		probeFailed++;
	}
}
console.log(`Probed: ${probed} | Failed: ${probeFailed}`);

// ═══ Step 2: Match orphans by duration ═══
console.log('\n═══ Step 2: Matching orphaned caches ═══');

const allFiles = db.prepare(
	'SELECT id, file_path, file_name, duration_seconds FROM movie_files WHERE available=1 AND duration_seconds > 0',
).all() as { id: string; file_path: string; file_name: string; duration_seconds: number }[];

const dbFileIds = new Set(allFiles.map((f) => f.id));

// Build duration → file map (group by duration ± tolerance)
const durToFiles = new Map<number, typeof allFiles>();
for (const f of allFiles) {
	for (let d = f.duration_seconds - 10; d <= f.duration_seconds + 10; d++) {
		if (!durToFiles.has(d)) durToFiles.set(d, []);
		durToFiles.get(d)!.push(f);
	}
}

const existingCache = new Set(
	db.prepare("SELECT movie_file_id || ':' || quality as k FROM transcode_cache")
		.all()
		.map((r: any) => r.k),
);

const dirs = readdirSync(cacheDir);
let matched = 0;
let unmatched = 0;
let alreadyValid = 0;

for (const dn of dirs) {
	const dp = path.join(cacheDir, dn);
	try { if (!statSync(dp).isDirectory()) continue; } catch { continue; }

	if (dbFileIds.has(dn)) { alreadyValid++; continue; }

	for (const q of readdirSync(dp)) {
		const qp = path.join(dp, q);
		try { if (!statSync(qp).isDirectory()) continue; } catch { continue; }
		if (!existsSync(path.join(qp, '.complete'))) continue;

		const mPath = path.join(qp, 'stream.m3u8');
		if (!existsSync(mPath)) continue;

		const m3u8 = readFileSync(mPath, 'utf-8');
		const extinfs = m3u8.match(/#EXTINF:([\d.]+)/g);
		if (!extinfs) continue;

		let dur = 0;
		for (const e of extinfs) dur += parseFloat(e.replace('#EXTINF:', ''));
		dur = Math.round(dur);
		const segCount = extinfs.length;

		const candidates = durToFiles.get(dur) || [];
		// Filter to unique matches (only 1 candidate at this duration)
		const uniqueMatches = [...new Set(candidates.map((c) => c.id))];

		if (uniqueMatches.length === 1) {
			const matchId = uniqueMatches[0]!;
			const key = `${matchId}:${q}`;
			if (existingCache.has(key)) continue;

			const matchFile = candidates[0]!;
			let sizeBytes = 0;
			const segs = readdirSync(qp).filter((f) => f.startsWith('segment_') && f.endsWith('.ts'));
			for (const seg of segs) {
				try { sizeBytes += statSync(path.join(qp, seg)).size; } catch {}
			}

			try {
				db.prepare(
					'INSERT INTO transcode_cache (id, movie_file_id, quality, encoding_settings, completed_at, file_path, cache_path, size_bytes, segment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
				).run(
					crypto.randomUUID(), matchId, q,
					JSON.stringify({ hwAccel: 'none', preset: 'veryfast', rateControl: 'crf', crf: 23 }),
					new Date().toISOString(),
					matchFile.file_path,
					`persistent/${matchId}/${q}`,
					sizeBytes,
					segCount,
				);
				matched++;
				const sizeMB = (sizeBytes / 1048576).toFixed(0);
				console.log(`  ✓ ${path.basename(matchFile.file_path || '')} → ${q} (${segCount} segs, ${sizeMB} MB)`);
			} catch (err: any) {
				console.log(`  ✗ ${matchId}/${q}: ${err.message}`);
			}
		} else if (uniqueMatches.length > 1) {
			// Ambiguous — multiple movies have similar duration
			unmatched++;
		} else {
			unmatched++;
		}
		break; // Only first quality per dir
	}
}

// ═══ Summary ═══
const totalCache = db.prepare('SELECT COUNT(*) as c FROM transcode_cache').get() as any;
const totalFiles = db.prepare('SELECT COUNT(*) as c FROM movie_files WHERE available=1').get() as any;

console.log('\n═══ Summary ═══');
console.log(`  Already valid:     ${alreadyValid}`);
console.log(`  Matched by dur:    ${matched}`);
console.log(`  Unmatched:         ${unmatched}`);
console.log(`  Cache entries:     ${totalCache.c}`);
console.log(`  Total files:       ${totalFiles.c}`);
console.log(`  Coverage:          ${((totalCache.c / Math.max(totalFiles.c, 1)) * 100).toFixed(1)}%`);

db.close();
