#!/usr/bin/env node
/**
 * Production cleanup script:
 * 1. FFprobe all movie files with missing codec data
 * 2. Remove stale transcode_cache DB entries (cache dir deleted)
 * 3. Report which files would be direct-play vs transcode
 *
 * Usage: cd src && node scripts/probe-and-cleanup.js
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ═══ Find database ═══
const dbPaths = [
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', '..', 'data', 'db', 'mu.db'),
];
const dbPath = dbPaths.find(fs.existsSync);
if (!dbPath) { console.error('DB not found'); process.exit(1); }

const Database = require('better-sqlite3');
const db = new Database(dbPath);
console.log('DB:', dbPath);

// ═══ Find FFprobe ═══
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

// ═══ Find cache dir ═══
const cacheDirs = [
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'cache', 'streams', 'persistent'),
	path.resolve(__dirname, '..', 'data', 'cache', 'streams', 'persistent'),
];
const cacheDir = cacheDirs.find(fs.existsSync) || '';
console.log('Cache dir:', cacheDir || '(not found)');

// ═══ Step 1: Probe files for codec data ═══
const skipProbe = process.argv.includes('--skip-probe');
console.log('\n═══ Step 1: Probing files for codec data ═══');
if (skipProbe) console.log('  (skipped via --skip-probe)');

const filesNeedingProbe = db.prepare(
	"SELECT id, file_path, file_name FROM movie_files WHERE available=1 AND (codec_video IS NULL OR codec_video='')"
).all();

console.log(`${filesNeedingProbe.length} files need probing`);

if (skipProbe && filesNeedingProbe.length > 0) {
	console.log('  Skipping probe step');
}

let probed = 0;
let probeFailed = 0;
if (skipProbe) { /* skip */ } else {

const updateStmt = db.prepare(`
	UPDATE movie_files SET
		codec_video = ?,
		codec_audio = ?,
		duration_seconds = COALESCE(duration_seconds, ?),
		video_width = COALESCE(video_width, ?),
		video_height = COALESCE(video_height, ?),
		resolution = COALESCE(resolution, ?)
	WHERE id = ?
`);

for (const f of filesNeedingProbe) {
	if (!f.file_path || !fs.existsSync(f.file_path)) {
		probeFailed++;
		continue;
	}
	try {
		const cmd = `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of json "${f.file_path}"`;
		const videoOut = JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 15000 }));
		const videoStream = (videoOut.streams || [])[0] || {};

		const cmd2 = `"${ffprobe}" -v error -select_streams a:0 -show_entries stream=codec_name -of json "${f.file_path}"`;
		const audioOut = JSON.parse(execSync(cmd2, { encoding: 'utf-8', timeout: 15000 }));
		const audioStream = (audioOut.streams || [])[0] || {};

		const cmd3 = `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${f.file_path}"`;
		const durStr = execSync(cmd3, { encoding: 'utf-8', timeout: 15000 }).trim();
		const duration = Math.round(parseFloat(durStr)) || null;

		const codecVideo = videoStream.codec_name || null;
		const codecAudio = audioStream.codec_name || null;
		const width = videoStream.width || null;
		const height = videoStream.height || null;

		// Determine resolution label
		let resolution = null;
		if (height) {
			if (height >= 2160) resolution = '2160p';
			else if (height >= 1440) resolution = '1440p';
			else if (height >= 1080) resolution = '1080p';
			else if (height >= 720) resolution = '720p';
			else if (height >= 480) resolution = '480p';
			else resolution = '360p';
		}

		updateStmt.run(codecVideo, codecAudio, duration, width, height, resolution, f.id);
		probed++;

		if (probed % 25 === 0) {
			console.log(`  Probed ${probed}/${filesNeedingProbe.length}... (last: ${codecVideo}/${codecAudio} ${width}x${height})`);
		}
	} catch (err) {
		probeFailed++;
		if (probeFailed <= 3) console.log(`  Failed: ${f.file_name}: ${err.message?.slice(0, 80)}`);
	}
}
} // end skip-probe guard
console.log(`Probed: ${probed} | Failed: ${probeFailed}`);

// ═══ Step 2: Clean stale transcode_cache entries ═══
console.log('\n═══ Step 2: Cleaning stale transcode_cache entries ═══');

// Ensure columns exist
try { db.exec('ALTER TABLE transcode_cache ADD COLUMN cache_path TEXT'); } catch {}
try { db.exec('ALTER TABLE transcode_cache ADD COLUMN file_path TEXT'); } catch {}
try { db.exec('ALTER TABLE transcode_cache ADD COLUMN size_bytes INTEGER'); } catch {}
try { db.exec('ALTER TABLE transcode_cache ADD COLUMN segment_count INTEGER'); } catch {}

let staleRemoved = 0;
let validEntries = 0;

if (cacheDir) {
	const cacheEntries = db.prepare('SELECT id, movie_file_id, quality FROM transcode_cache').all();
	console.log(`${cacheEntries.length} cache entries in DB`);

	const deleteStmt = db.prepare('DELETE FROM transcode_cache WHERE id = ?');

	for (const entry of cacheEntries) {
		const dirPath = path.join(cacheDir, entry.movie_file_id, entry.quality);
		const completeExists = fs.existsSync(path.join(dirPath, '.complete'));

		if (!completeExists) {
			deleteStmt.run(entry.id);
			staleRemoved++;
		} else {
			validEntries++;
		}
	}
}

console.log(`Valid cache entries: ${validEntries}`);
console.log(`Stale entries removed: ${staleRemoved}`);

// ═══ Step 3: Analyze stream modes with new codec data ═══
console.log('\n═══ Step 3: Stream mode analysis ═══');

const allFiles = db.prepare(
	'SELECT id, file_path, codec_video, codec_audio, resolution FROM movie_files WHERE available=1'
).all();

let directPlay = 0;
let directStream = 0;
let transcode = 0;
let unknownCodec = 0;

const BROWSER_AUDIO = ['aac', 'mp3', 'opus', 'flac', 'vorbis', 'mp4a', 'pcm_s16le'];
const TRANSCODE_AUDIO = ['dts', 'truehd', 'ac3', 'eac3', 'dca', 'mlp'];

for (const f of allFiles) {
	const videoCodec = (f.codec_video || '').toLowerCase();
	const audioCodec = (f.codec_audio || '').toLowerCase();
	const ext = (f.file_path || '').toLowerCase().slice(f.file_path.lastIndexOf('.'));

	if (!videoCodec) { unknownCodec++; transcode++; continue; }

	const isH264 = videoCodec === 'h264' || videoCodec === 'avc';
	const isMp4 = ext === '.mp4' || ext === '.m4v';
	const isMkv = ext === '.mkv';
	const isWebm = ext === '.webm';
	const isBrowserContainer = isMp4 || isWebm;
	const isBrowserAudio = !audioCodec || BROWSER_AUDIO.some(c => audioCodec.includes(c));
	const needsAudioTranscode = TRANSCODE_AUDIO.some(c => audioCodec.includes(c));

	if (isH264 && isBrowserContainer && isBrowserAudio && !needsAudioTranscode) {
		directPlay++;
	} else if (isH264 && isMkv && isBrowserAudio && !needsAudioTranscode) {
		directStream++;
	} else {
		transcode++;
	}
}

// Count actual caches on disk
let diskCaches = 0;
if (cacheDir) {
	try {
		const dirs = fs.readdirSync(cacheDir);
		for (const d of dirs) {
			const dp = path.join(cacheDir, d);
			try {
				if (!fs.statSync(dp).isDirectory()) continue;
				const quals = fs.readdirSync(dp);
				for (const q of quals) {
					if (fs.existsSync(path.join(dp, q, '.complete'))) diskCaches++;
				}
			} catch {}
		}
	} catch {}
}

const needsTranscoding = transcode + directStream; // directStream still needs remux
const alreadyCached = validEntries;
const jobsNeeded = needsTranscoding - alreadyCached;

console.log(`  Direct play (no work needed): ${directPlay}`);
console.log(`  Direct stream (remux only):   ${directStream}`);
console.log(`  Full transcode:               ${transcode}`);
console.log(`  Still unknown codec:          ${unknownCodec}`);
console.log(`  Caches on disk:               ${diskCaches}`);
console.log(`  Valid DB cache entries:        ${validEntries}`);
console.log(`  Estimated jobs after restart:  ~${Math.max(0, jobsNeeded)}`);
console.log(`  Savings vs current 415:       ~${415 - Math.max(0, jobsNeeded)} fewer jobs`);

db.close();
console.log('\nDone. Restart the server to apply changes.');
