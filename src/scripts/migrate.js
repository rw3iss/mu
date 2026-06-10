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
		details TEXT,
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
	`CREATE TABLE IF NOT EXISTS metadata_match_candidates (
		id TEXT PRIMARY KEY,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		provider TEXT NOT NULL,
		external_id TEXT NOT NULL,
		title TEXT NOT NULL,
		year INTEGER,
		runtime_minutes INTEGER,
		poster_url TEXT,
		overview TEXT,
		confidence REAL NOT NULL,
		rank INTEGER NOT NULL,
		is_best INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS mmc_entity_idx ON metadata_match_candidates(entity_type, entity_id)`,
	`CREATE INDEX IF NOT EXISTS mmc_rank_idx ON metadata_match_candidates(entity_type, entity_id, rank)`,
	`CREATE TABLE IF NOT EXISTS people (
		id TEXT PRIMARY KEY,
		external_id TEXT NOT NULL,
		source TEXT NOT NULL,
		tmdb_id INTEGER,
		imdb_id TEXT,
		name TEXT NOT NULL,
		profile_url TEXT,
		birthday TEXT,
		place_of_birth TEXT,
		deathday TEXT,
		biography TEXT,
		known_for_department TEXT,
		gender INTEGER,
		popularity REAL,
		also_known_as TEXT,
		metadata TEXT,
		fetched_at TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS people_external_id_idx ON people(external_id)`,
	`CREATE INDEX IF NOT EXISTS people_tmdb_id_idx ON people(tmdb_id)`,
	`CREATE INDEX IF NOT EXISTS people_imdb_id_idx ON people(imdb_id)`,
	`CREATE INDEX IF NOT EXISTS people_name_idx ON people(name)`,
	`CREATE TABLE IF NOT EXISTS favorites (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		role TEXT,
		created_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS favorites_unique_idx ON favorites(user_id, entity_type, entity_id)`,
	`CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id)`,
	`CREATE INDEX IF NOT EXISTS favorites_user_type_idx ON favorites(user_id, entity_type)`,
	// User-submitted feedback (any authenticated user); managed by admins.
	`CREATE TABLE IF NOT EXISTS feedback (
		id TEXT PRIMARY KEY,
		name TEXT,
		user_id TEXT,
		email TEXT,
		description TEXT NOT NULL,
		screenshot_data TEXT,
		screenshot_name TEXT,
		page_url TEXT,
		user_agent TEXT,
		status TEXT NOT NULL DEFAULT 'new',
		created_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at)`,
	`CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback(status)`,
	// NVMe "hot" cache index: one row per movie file staged to the fast drive.
	`CREATE TABLE IF NOT EXISTS media_cache (
		movie_file_id TEXT PRIMARY KEY,
		movie_id TEXT NOT NULL,
		source_path TEXT NOT NULL,
		cache_path TEXT NOT NULL,
		size_bytes INTEGER DEFAULT 0,
		staged_at TEXT,
		last_access_at TEXT NOT NULL,
		complete INTEGER DEFAULT 0,
		watched_fully INTEGER DEFAULT 0,
		watched_at TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS media_cache_access_idx ON media_cache(last_access_at)`,
	`CREATE INDEX IF NOT EXISTS media_cache_movie_idx ON media_cache(movie_id)`,
	// Multi-source identity registry: one row per (source, externalId)
	// pointing back at the canonical movie. Adding a new source means
	// inserting rows here — no schema migration needed.
	`CREATE TABLE IF NOT EXISTS movie_identities (
		id TEXT PRIMARY KEY,
		movie_id TEXT REFERENCES movies(id) ON DELETE CASCADE,
		source TEXT NOT NULL,
		external_id TEXT NOT NULL,
		confidence REAL NOT NULL DEFAULT 1.0,
		added_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS movie_identities_source_external ON movie_identities(source, external_id)`,
	`CREATE INDEX IF NOT EXISTS movie_identities_movie_idx ON movie_identities(movie_id)`,
	// Same shape, for cast/crew.
	`CREATE TABLE IF NOT EXISTS person_identities (
		id TEXT PRIMARY KEY,
		person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
		source TEXT NOT NULL,
		external_id TEXT NOT NULL,
		confidence REAL NOT NULL DEFAULT 1.0,
		added_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS person_identities_source_external ON person_identities(source, external_id)`,
	`CREATE INDEX IF NOT EXISTS person_identities_person_idx ON person_identities(person_id)`,
	// Raw per-source payloads kept so the MergeEngine can re-merge
	// without re-fetching when rules / precedence change.
	`CREATE TABLE IF NOT EXISTS movie_source_payloads (
		id TEXT PRIMARY KEY,
		movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
		source TEXT NOT NULL,
		payload TEXT NOT NULL,
		fetched_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS movie_source_payloads_movie_source ON movie_source_payloads(movie_id, source)`,
	`CREATE TABLE IF NOT EXISTS search_cache (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		normalized_query TEXT NOT NULL,
		source TEXT NOT NULL,
		payload TEXT NOT NULL,
		fetched_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS search_cache_type_query ON search_cache(type, normalized_query)`,
	`CREATE TABLE IF NOT EXISTS imdb_ratings (
		tconst TEXT PRIMARY KEY,
		average_rating REAL NOT NULL,
		num_votes INTEGER NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS imdb_ratings_rating_idx ON imdb_ratings(average_rating, num_votes)`,
	`CREATE TABLE IF NOT EXISTS imdb_titles (
		tconst TEXT PRIMARY KEY,
		title_type TEXT NOT NULL,
		primary_title TEXT NOT NULL,
		original_title TEXT,
		year INTEGER,
		runtime_minutes INTEGER,
		genres TEXT,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS imdb_titles_title_idx ON imdb_titles(primary_title COLLATE NOCASE)`,
	`CREATE INDEX IF NOT EXISTS imdb_titles_year_idx ON imdb_titles(year)`,
	// Per-user setting overrides. (user_id, key) -> JSON value.
	// Cascade-deleted with the user. Reads fall back to app-wide
	// `settings` table. Allowlist of keys enforced in code; admins
	// can override any key via `admin:any-user-setting` capability.
	`CREATE TABLE IF NOT EXISTS user_settings (
		user_id TEXT NOT NULL,
		key TEXT NOT NULL,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (user_id, key),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE INDEX IF NOT EXISTS user_settings_user_idx ON user_settings(user_id)`,
];

for (const sql of tables) {
	db.exec(sql);
}

// Add columns that may not exist
const alters = [
	// Sources Phase 0: per-field provenance map (JSON). Tracks which
	// provider set each field on a movie_metadata row so the
	// MergeEngine can decide whether a new source has authority to
	// overwrite. See packages/server/src/providers/merge/.
	'ALTER TABLE movie_metadata ADD COLUMN provenance TEXT',
	'ALTER TABLE media_sources ADD COLUMN is_default INTEGER DEFAULT 0',
	'ALTER TABLE playlists ADD COLUMN is_public INTEGER DEFAULT 0',
	'ALTER TABLE playlists ADD COLUMN public_edit INTEGER DEFAULT 0',
	'ALTER TABLE playlist_movies ADD COLUMN added_by TEXT',
	'ALTER TABLE stream_sessions ADD COLUMN ip_address TEXT',
	// Social profile fields (Members + profile pages).
	'ALTER TABLE users ADD COLUMN description TEXT',
	'ALTER TABLE users ADD COLUMN profile_public INTEGER DEFAULT 0',
	'ALTER TABLE users ADD COLUMN last_login_at TEXT',
	'ALTER TABLE users ADD COLUMN last_logout_at TEXT',
	'ALTER TABLE users ADD COLUMN previous_login_at TEXT',
	'ALTER TABLE users ADD COLUMN last_seen_at TEXT',
	'ALTER TABLE users ADD COLUMN display_name TEXT',
	'ALTER TABLE stream_sessions ADD COLUMN last_progress_at TEXT',
	'ALTER TABLE feedback ADD COLUMN attachment_url TEXT',
	'ALTER TABLE feedback ADD COLUMN attachment_type TEXT',
	'ALTER TABLE movies ADD COLUMN thumbnail_url TEXT',
	'ALTER TABLE movies ADD COLUMN uploaded_by TEXT',
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
	'ALTER TABLE job_history ADD COLUMN details TEXT',
];

for (const sql of alters) {
	try { db.exec(sql); } catch (e) { /* column already exists */ }
}

// Role-enum migration: 'admin' | 'user' -> 'admin' | 'contributor' | 'viewer'.
// Existing 'user' rows become 'viewer'. Idempotent — once renamed, no rows
// match the WHERE clause on re-runs.
try {
	const renamed = db.prepare(`UPDATE users SET role = 'viewer' WHERE role = 'user'`).run();
	if (renamed.changes > 0) {
		console.log(`Migrated ${renamed.changes} user(s) from role 'user' to 'viewer'`);
	}
} catch (e) {
	console.warn(`Role migration skipped: ${e.message}`);
}

// One-time: make all existing profiles public (the new default). Guarded by a
// settings marker so a user who later chooses "private" isn't forced back to
// public on every subsequent migrate run.
try {
	const marker = db
		.prepare(`SELECT value FROM settings WHERE key = 'migration_profiles_public_v1'`)
		.get();
	if (!marker) {
		const res = db.prepare(`UPDATE users SET profile_public = 1`).run();
		db.prepare(
			`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_profiles_public_v1', 'done', ?)`,
		).run(new Date().toISOString());
		console.log(`Made ${res.changes} existing profile(s) public (one-time)`);
	}
} catch (e) {
	console.warn(`Profile-public migration skipped: ${e.message}`);
}

// Seed built-in curated themes from the canonical catalogue.
// Idempotent: inserts only entries whose `name` doesn't already exist,
// so re-runs never duplicate and existing user customisations to a
// built-in theme of the same name are preserved.
// Catalogue path: src/packages/client/src/styles/themes/catalogue.json
{
	const cataloguePath = path.resolve(
		__dirname,
		'..',
		'packages',
		'client',
		'src',
		'styles',
		'themes',
		'catalogue.json',
	);
	let cat = null;
	try {
		cat = JSON.parse(fs.readFileSync(cataloguePath, 'utf-8'));
	} catch (e) {
		console.warn(`Theme catalogue not readable at ${cataloguePath}: ${e.message}`);
	}

	// Back-compat: rename the old "Default (Dark)" / "Default (Light)"
	// rows to the new catalogue names ("Midnight Reel" / "Daylight") so
	// users keep their saved selection across the rename. Skip if a row
	// with the new name already exists (idempotent re-run safety).
	const renames = [
		{ old: 'Default (Dark)', next: 'Midnight Reel' },
		{ old: 'Default Dark', next: 'Midnight Reel' },
		{ old: 'Default (Light)', next: 'Daylight' },
		{ old: 'Default Light', next: 'Daylight' },
	];
	for (const r of renames) {
		const existsNew = db.prepare('SELECT id FROM themes WHERE name = ?').get(r.next);
		const existsOld = db.prepare('SELECT id FROM themes WHERE name = ?').get(r.old);
		if (existsOld && !existsNew) {
			db.prepare('UPDATE themes SET name = ?, updated_at = ? WHERE name = ?').run(
				r.next,
				new Date().toISOString(),
				r.old,
			);
		}
	}

	if (cat && Array.isArray(cat.themes)) {
		const crypto = require('crypto');
		const selectByName = db.prepare('SELECT id FROM themes WHERE name = ?');
		const insertTheme = db.prepare(
			'INSERT INTO themes (id, name, mode, config, is_default, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		);
		let inserted = 0;
		for (const t of cat.themes) {
			if (!t || !t.name || !t.mode || !t.config) continue;
			if (selectByName.get(t.name)) continue;
			const now = new Date().toISOString();
			insertTheme.run(
				crypto.randomUUID(),
				t.name,
				t.mode,
				JSON.stringify(t.config),
				t.isDefault ? 1 : 0,
				null,
				now,
				now,
			);
			inserted++;
		}
		if (inserted > 0) console.log(`Seeded ${inserted} curated theme(s)`);
	}
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
