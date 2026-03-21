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

const dbPaths = [
	path.resolve(__dirname, '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'packages', 'server', '..', '..', '..', 'data', 'db', 'mu.db'),
];

const dbPath = dbPaths.find(fs.existsSync);
if (!dbPath) {
	console.log('No database found, skipping migrations');
	process.exit(0);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);
console.log('Database:', dbPath);

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
];

for (const sql of alters) {
	try { db.exec(sql); } catch (e) { /* column already exists */ }
}

// Verify
const tableList = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tableList.map(t => t.name).join(', '));

const cacheCount = db.prepare('SELECT COUNT(*) as c FROM transcode_cache').get();
console.log('Cache entries:', cacheCount.c);

db.close();
console.log('Migrations applied successfully');
