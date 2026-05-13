#!/usr/bin/env node
/**
 * Inline database migration script.
 * Creates missing tables and adds missing columns.
 * Safe to run multiple times (uses IF NOT EXISTS / try-catch).
 *
 * Usage: node scripts/migrate.js
 */
const path = require('path');
const fs = require('fs');

// Load .env file if present
for (const envPath of [
	path.resolve(__dirname, '..', '.env'),
	path.resolve(__dirname, '..', '..', '.env'),
]) {
	if (fs.existsSync(envPath)) {
		const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx < 1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let val = trimmed.slice(eqIdx + 1).trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (!(key in process.env)) process.env[key] = val;
		}
		break;
	}
}

// Project root — this file lives at <root>/src/scripts/migrate.js,
// so two levels up is the project root. Anchor all path resolution
// here so `MU_DATA_DIR=./data` resolves to `<root>/data` regardless
// of which cwd ran us.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const explicitDbPath = process.env.MU_DATABASE_SQLITE_PATH
	? (path.isAbsolute(process.env.MU_DATABASE_SQLITE_PATH)
		? process.env.MU_DATABASE_SQLITE_PATH
		: path.resolve(PROJECT_ROOT, process.env.MU_DATABASE_SQLITE_PATH))
	: null;

const dataDirRaw = process.env.MU_DATA_DIR || process.env.MU_DATADIR;
const dataDir = dataDirRaw
	? (path.isAbsolute(dataDirRaw) ? dataDirRaw : path.resolve(PROJECT_ROOT, dataDirRaw))
	: path.resolve(PROJECT_ROOT, 'data');

const dbPath = explicitDbPath || path.resolve(dataDir, 'db', 'mu.db');

// Defensive: detect strays from the old, cwd-dependent setup. We
// won't auto-delete them (data loss risk) but we'll warn loudly so
// the developer can reconcile and remove them.
const knownStrayPaths = [
	path.resolve(PROJECT_ROOT, 'src', 'data', 'db', 'mu.db'),
	path.resolve(PROJECT_ROOT, 'src', 'packages', 'server', 'data', 'db', 'mu.db'),
].filter((p) => p !== dbPath && fs.existsSync(p));

// One-shot consolidation: if the canonical DB doesn't exist yet but
// a stray does, copy the *largest* stray (most likely the one with
// real data) to canonical. WAL/SHM go along for the ride so any
// pending writes survive. Strays are NEVER auto-deleted — the dev
// reviews and removes them once they've confirmed canonical works.
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
	fs.mkdirSync(dbDir, { recursive: true });
}

const canonicalExists = fs.existsSync(dbPath);
const canonicalSize = canonicalExists ? fs.statSync(dbPath).size : 0;
const SUSPICIOUSLY_SMALL = 64 * 1024; // < 64 KB → likely a fresh empty DB

if ((!canonicalExists || canonicalSize < SUSPICIOUSLY_SMALL) && knownStrayPaths.length > 0) {
	const sortedStrays = knownStrayPaths
		.map((p) => ({ path: p, size: fs.statSync(p).size }))
		.sort((a, b) => b.size - a.size);
	const winner = sortedStrays[0];
	if (winner.size > canonicalSize) {
		console.log('\n🔁 One-shot DB consolidation:');
		console.log(`   Source : ${winner.path} (${(winner.size / 1024).toFixed(1)} KB)`);
		console.log(`   Target : ${dbPath}`);
		// Wipe any stub canonical first.
		for (const ext of ['', '-shm', '-wal']) {
			try {
				fs.unlinkSync(dbPath + ext);
			} catch {}
		}
		fs.copyFileSync(winner.path, dbPath);
		for (const ext of ['-shm', '-wal']) {
			if (fs.existsSync(winner.path + ext)) {
				fs.copyFileSync(winner.path + ext, dbPath + ext);
			}
		}
		console.log(`   Copied. Original kept at source — remove manually once verified.\n`);
		// Refresh stray list for the warning below.
		knownStrayPaths.splice(0, knownStrayPaths.length, ...knownStrayPaths.filter((p) => p !== winner.path));
	}
}

if (knownStrayPaths.length > 0) {
	console.warn('\n⚠️  STRAY DATABASE FILES DETECTED — these are leftovers from the old');
	console.warn('   cwd-dependent path resolution and may contain real data:');
	for (const p of knownStrayPaths) {
		const stat = fs.statSync(p);
		console.warn(`     ${p}  (${(stat.size / 1024).toFixed(1)} KB)`);
	}
	console.warn(`   Canonical DB: ${dbPath}`);
	console.warn('   Verify the canonical file has your data, then remove the strays.\n');
}

const Database = require('better-sqlite3');
console.log(`=== Migrating: ${dbPath} ===`);
migrateOne(dbPath);
process.exit(0);

function migrateOne(dbPath) {
	const db = new Database(dbPath);

// Create missing tables
const tables = [
	`CREATE TABLE IF NOT EXISTS transcode_cache (
		id TEXT PRIMARY KEY,
		movie_file_id TEXT NOT NULL REFERENCES movie_files(id) ON DELETE CASCADE,
		quality TEXT NOT NULL,
		encoding_settings TEXT NOT NULL,
		completed_at TEXT NOT NULL,
		file_path TEXT,
		cache_path TEXT,
		size_bytes INTEGER,
		segment_count INTEGER
	)`,
	`CREATE TABLE IF NOT EXISTS audio_profiles (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		config TEXT NOT NULL DEFAULT '{}',
		is_default INTEGER DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS themes (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		mode TEXT NOT NULL,
		config TEXT NOT NULL,
		is_default INTEGER DEFAULT 0,
		created_by TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS job_history (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		label TEXT NOT NULL,
		status TEXT NOT NULL,
		payload TEXT,
		priority INTEGER DEFAULT 10,
		progress REAL DEFAULT 0,
		result TEXT,
		error TEXT,
		created_at TEXT NOT NULL,
		started_at TEXT,
		completed_at TEXT,
		duration_ms INTEGER,
		movie_id TEXT,
		movie_title TEXT,
		file_path TEXT,
		quality TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS movie_groups (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		group_type TEXT NOT NULL DEFAULT 'series',
		name TEXT NOT NULL,
		parent_group_id TEXT,
		ordinal INTEGER,
		tmdb_tv_id INTEGER,
		imdb_id TEXT,
		poster_url TEXT,
		backdrop_url TEXT,
		overview TEXT,
		status TEXT NOT NULL DEFAULT 'auto',
		confidence REAL,
		alt_parents TEXT,
		detection_source TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS movie_groups_parent_idx ON movie_groups(parent_group_id)`,
	`CREATE INDEX IF NOT EXISTS movie_groups_type_idx ON movie_groups(type)`,
	`CREATE INDEX IF NOT EXISTS movie_groups_status_idx ON movie_groups(status)`,
	`CREATE TABLE IF NOT EXISTS provider_credentials (
		provider_id TEXT PRIMARY KEY,
		config TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		encrypted INTEGER NOT NULL DEFAULT 0,
		added_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS provider_usage (
		provider_id TEXT NOT NULL,
		window TEXT NOT NULL,
		bucket_key TEXT NOT NULL,
		count INTEGER NOT NULL DEFAULT 0,
		cost_usd REAL DEFAULT 0,
		PRIMARY KEY (provider_id, window, bucket_key)
	)`,
	`CREATE TABLE IF NOT EXISTS provider_events (
		id TEXT PRIMARY KEY,
		provider_id TEXT NOT NULL,
		event_type TEXT NOT NULL,
		status_code INTEGER,
		duration_ms INTEGER,
		cost_usd REAL,
		payload TEXT,
		occurred_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS provider_events_provider_idx ON provider_events(provider_id, occurred_at)`,
	`CREATE TABLE IF NOT EXISTS movie_external_recs (
		movie_id TEXT NOT NULL,
		source TEXT NOT NULL,
		rank INTEGER NOT NULL,
		target_movie_id TEXT,
		target_tmdb INTEGER,
		target_imdb TEXT,
		target_title TEXT NOT NULL,
		target_year INTEGER,
		raw TEXT,
		fetched_at TEXT NOT NULL,
		PRIMARY KEY (movie_id, source, rank)
	)`,
	`CREATE INDEX IF NOT EXISTS movie_external_recs_target_idx ON movie_external_recs(target_movie_id)`,
	`CREATE INDEX IF NOT EXISTS movie_external_recs_target_tmdb_idx ON movie_external_recs(target_tmdb)`,
	`CREATE TABLE IF NOT EXISTS movie_embeddings (
		movie_id TEXT NOT NULL,
		model TEXT NOT NULL,
		dim INTEGER NOT NULL,
		vector BLOB NOT NULL,
		source_text_hash TEXT,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (movie_id, model)
	)`,
	`CREATE TABLE IF NOT EXISTS movie_llm_features (
		movie_id TEXT NOT NULL,
		model TEXT NOT NULL,
		features TEXT NOT NULL,
		cost_usd REAL,
		generated_at TEXT NOT NULL,
		PRIMARY KEY (movie_id, model)
	)`,
	`CREATE TABLE IF NOT EXISTS movie_rec_explanations (
		seed_id TEXT NOT NULL,
		target_id TEXT NOT NULL,
		model TEXT NOT NULL,
		explanation TEXT NOT NULL,
		cost_usd REAL,
		generated_at TEXT NOT NULL,
		PRIMARY KEY (seed_id, target_id, model)
	)`,
];

for (const sql of tables) {
	db.exec(sql);
}

// Add columns that may not exist
const alters = [
	'ALTER TABLE movies ADD COLUMN thumbnail_url TEXT',
	'ALTER TABLE movies ADD COLUMN thumbnail_aspect_ratio REAL',
	'ALTER TABLE movies ADD COLUMN hidden INTEGER DEFAULT 0',
	'ALTER TABLE movies ADD COLUMN play_settings TEXT',
	'ALTER TABLE movie_files ADD COLUMN file_metadata TEXT',
	'ALTER TABLE movie_files ADD COLUMN video_width INTEGER',
	'ALTER TABLE movie_files ADD COLUMN video_height INTEGER',
	'ALTER TABLE movie_files ADD COLUMN video_bit_depth INTEGER',
	'ALTER TABLE movie_files ADD COLUMN video_frame_rate TEXT',
	'ALTER TABLE movie_files ADD COLUMN video_profile TEXT',
	'ALTER TABLE movie_files ADD COLUMN video_color_space TEXT',
	'ALTER TABLE movie_files ADD COLUMN hdr INTEGER DEFAULT 0',
	'ALTER TABLE movie_files ADD COLUMN container_format TEXT',
	"ALTER TABLE plugins ADD COLUMN status TEXT DEFAULT 'not_installed'",
	'ALTER TABLE transcode_cache ADD COLUMN file_path TEXT',
	'ALTER TABLE transcode_cache ADD COLUMN cache_path TEXT',
	'ALTER TABLE transcode_cache ADD COLUMN size_bytes INTEGER',
	'ALTER TABLE transcode_cache ADD COLUMN segment_count INTEGER',
	'ALTER TABLE playlist_movies ADD COLUMN remote_title TEXT',
	'ALTER TABLE playlist_movies ADD COLUMN remote_poster_url TEXT',
	'ALTER TABLE playlist_movies ADD COLUMN remote_server_id TEXT',
	'ALTER TABLE movies ADD COLUMN group_id TEXT',
	'ALTER TABLE movies ADD COLUMN group_episode_ordinal INTEGER',
	'CREATE INDEX IF NOT EXISTS movies_group_id_idx ON movies(group_id)',
	"ALTER TABLE movies ADD COLUMN source TEXT NOT NULL DEFAULT 'library'",
	'CREATE INDEX IF NOT EXISTS movies_source_idx ON movies(source)',
];

for (const sql of alters) {
	try { db.exec(sql); } catch (e) { /* column already exists */ }
}

// Seed default themes if none exist
const themeCount = db.prepare('SELECT COUNT(*) as c FROM themes WHERE is_default = 1').get();
if (themeCount.c === 0) {
	const crypto = require('crypto');
	const now = new Date().toISOString();
	const darkConfig = JSON.stringify({
		accentColor: '#06b6d4',
		pageBg: '#050709',
		panelBg: '#090b12',
		itemSpacing: 'normal',
		itemRadius: 3,
		cardBorder: { width: 1, color: '#788cb4', opacity: 0.07 },
		disableHover: false,
		textScale: 1.0,
	});
	const lightConfig = JSON.stringify({
		accentColor: '#0891b2',
		pageBg: '#f8fafc',
		panelBg: '#ffffff',
		itemSpacing: 'normal',
		itemRadius: 3,
		cardBorder: { width: 1, color: '#94a3b8', opacity: 0.15 },
		disableHover: false,
		textScale: 1.0,
	});
	db.prepare(
		'INSERT INTO themes (id, name, mode, config, is_default, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
	).run(crypto.randomUUID(), 'Default (Dark)', 'dark', darkConfig, 1, null, now, now);
	db.prepare(
		'INSERT INTO themes (id, name, mode, config, is_default, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
	).run(crypto.randomUUID(), 'Default (Light)', 'light', lightConfig, 1, null, now, now);
	console.log('Seeded default themes');
}

	// Verify
	const tableList = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
		.all();
	console.log('Tables:', tableList.map((t) => t.name).join(', '));

	const cacheCount = db.prepare('SELECT COUNT(*) as c FROM transcode_cache').get();
	console.log('Cache entries:', cacheCount.c);

	db.close();
	console.log('Migrations applied successfully');
}
