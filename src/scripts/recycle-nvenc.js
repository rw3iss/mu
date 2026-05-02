#!/usr/bin/env node
/**
 * recycle-nvenc.js — kickstart-fix the hardware encoder (nvenc/qsv/vaapi).
 *
 * Mirrors the in-server `TranscoderService.recycleHwAccel()` routine for
 * use from the command line, even when the server is down.
 *
 *   1. Kill orphan FFmpeg/FFprobe processes (Windows: taskkill, Unix: pkill).
 *   2. Settle briefly for the OS to release handles.
 *   3. Clear the broken-state flags in the SQLite settings table
 *      (hwAccelBroken / hwAccelBrokenSince / hwAccelBrokenReason).
 *   4. Probe the configured encoder with a 0.1s null-source transcode.
 *   5. Report success/failure with the FFmpeg stderr tail on failure.
 *
 * If the routine succeeds while the server is running, the in-memory
 * `hwAccelBroken` flag inside the live process is NOT cleared by this
 * script — restart the server (or use the UI Recycle button) to refresh
 * its in-memory state.
 *
 * Usage:
 *   node scripts/recycle-nvenc.js
 *   pnpm fix:nvenc
 */
const path = require('node:path');
const fs = require('node:fs');
const { execSync, spawn } = require('node:child_process');

const isWindows = process.platform === 'win32';

// ─── locate database ───
const dataDir = process.env.MU_DATA_DIR || process.env.MU_DATADIR;
const dbPaths = [
	...(dataDir ? [path.resolve(dataDir, 'db', 'mu.db')] : []),
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', '..', 'data', 'db', 'mu.db'),
];
const dbPath = dbPaths.find(fs.existsSync);
if (!dbPath) {
	console.error('Database not found');
	process.exit(1);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);

// ─── locate ffmpeg ───
const ffmpegCandidates = [
	process.env.FFMPEG_PATH,
	'ffmpeg',
	'C:/ffmpeg/ffmpeg.exe',
	'/usr/bin/ffmpeg',
	'/usr/local/bin/ffmpeg',
].filter(Boolean);

let ffmpegBin = null;
for (const candidate of ffmpegCandidates) {
	try {
		execSync(`"${candidate}" -version`, { stdio: 'ignore', timeout: 3000 });
		ffmpegBin = candidate;
		break;
	} catch {}
}
if (!ffmpegBin) {
	console.error('FFmpeg not found on PATH or at expected locations');
	db.close();
	process.exit(1);
}

// ─── read configured hwAccel ───
function readEncoding() {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('encoding');
	if (!row) return {};
	try {
		return JSON.parse(row.value) || {};
	} catch {
		return {};
	}
}

const enc = readEncoding();
const hwAccel = enc.hwAccel || 'none';

console.log('=== Hardware Encoder Recycle ===');
console.log(`Platform:  ${process.platform}`);
console.log(`DB:        ${dbPath}`);
console.log(`FFmpeg:    ${ffmpegBin}`);
console.log(`HW accel:  ${hwAccel}`);

if (hwAccel === 'none') {
	console.log('No hardware encoder configured (encoding.hwAccel is "none"). Nothing to recycle.');
	db.close();
	process.exit(0);
}

// ─── encoder name lookup ───
function encoderForHwAccel(name) {
	switch (name) {
		case 'nvenc':
			return 'h264_nvenc';
		case 'qsv':
			return 'h264_qsv';
		case 'vaapi':
			return 'h264_vaapi';
		default:
			return 'libx264';
	}
}

// ─── 1. kill orphan ffmpeg processes ───
console.log('\n--- Killing orphan FFmpeg processes ---');
let killed = 0;
try {
	if (isWindows) {
		for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
			try {
				const out = execSync(`taskkill /F /IM ${name} /T`, { timeout: 5000, encoding: 'utf-8' });
				const matches = out.match(/SUCCESS/g);
				if (matches) killed += matches.length;
			} catch {
				// taskkill returns non-zero when no matching processes
			}
		}
	} else {
		try {
			execSync('pkill -9 -x ffmpeg', { timeout: 5000 });
			killed++;
		} catch {}
		try {
			execSync('pkill -9 -x ffprobe', { timeout: 5000 });
			killed++;
		} catch {}
	}
} catch (err) {
	console.warn('  Warning: kill attempt failed:', err.message);
}
console.log(killed > 0 ? `  Killed ${killed} orphan process(es)` : '  No orphan processes found');

// ─── 2. settle ───
console.log('--- Waiting for handles to release ---');
execSync(isWindows ? 'ping -n 3 127.0.0.1 > NUL' : 'sleep 1');

// ─── 3. clear broken-state flags ───
console.log('--- Clearing broken-state flags ---');
let clearedRows = 0;
for (const key of ['hwAccelBroken', 'hwAccelBrokenSince', 'hwAccelBrokenReason']) {
	const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key);
	if (result.changes) {
		clearedRows += result.changes;
		console.log(`  - cleared ${key}`);
	}
}
if (!clearedRows) console.log('  (no flags were set)');

// ─── 4. probe ───
const encoder = encoderForHwAccel(hwAccel);
console.log(`\n--- Probing ${encoder} with a 0.1s null-source transcode ---`);

const probeArgs = [
	'-y',
	'-f',
	'lavfi',
	'-i',
	'nullsrc=size=320x240:rate=24:duration=0.1',
	'-c:v',
	encoder,
	'-t',
	'0.1',
	'-f',
	'null',
	'-',
];

const probe = spawn(ffmpegBin, probeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
probe.stderr.on('data', (d) => {
	stderr += d.toString();
});

const timeoutMs = 10_000;
let timedOut = false;
const timer = setTimeout(() => {
	timedOut = true;
	probe.kill('SIGKILL');
}, timeoutMs);

probe.on('exit', (code) => {
	clearTimeout(timer);
	const tail = stderr.split('\n').filter(Boolean).slice(-6).join('\n');

	if (timedOut) {
		console.log(`  ✗ Probe timed out after ${timeoutMs}ms`);
		writeBrokenFlag(`Probe timed out after ${timeoutMs}ms`, hwAccel);
		console.log('\nResult: FAILED — encoder still broken');
		db.close();
		process.exit(1);
	}

	if (code === 0) {
		console.log(`  ✓ Probe succeeded — ${hwAccel} is operational`);
		console.log('\nResult: SUCCESS');
		console.log(
			'Note: if the server was running while you ran this, restart it to refresh its in-memory hwAccelBroken flag (or click the Recycle button in Admin > Server).',
		);
		db.close();
		process.exit(0);
	}

	const lastLine = tail.split('\n').pop()?.trim() || `exit code ${code}`;
	console.log(`  ✗ Probe failed (exit ${code}):`);
	console.log(tail.replace(/^/gm, '    '));
	writeBrokenFlag(`Probe still failing after recycle: ${lastLine}`, hwAccel);
	console.log('\nResult: FAILED — encoder still broken');
	db.close();
	process.exit(1);
});

function writeBrokenFlag(reason, accel) {
	const now = new Date().toISOString();
	const setRow = db.prepare(
		'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?',
	);
	setRow.run('hwAccelBroken', 'true', now, 'true', now);
	setRow.run('hwAccelBrokenSince', JSON.stringify(now), now, JSON.stringify(now), now);
	setRow.run(
		'hwAccelBrokenReason',
		JSON.stringify(`[${accel}] ${reason}`),
		now,
		JSON.stringify(`[${accel}] ${reason}`),
		now,
	);
}
