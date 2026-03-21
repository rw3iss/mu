import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ConfigService } from '../config/config.service.js';
import * as schema from './schema/index.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
	private readonly logger = new Logger('Database');
	private sqlite!: Database.Database;
	private _db!: BetterSQLite3Database<typeof schema>;

	constructor(private config: ConfigService) {}

	get db() {
		return this._db;
	}

	async initialize() {
		const dbPath = resolve(this.config.get<string>('database.path', './data/db/mu.db'));
		const dbDir = dirname(dbPath);

		if (!existsSync(dbDir)) {
			mkdirSync(dbDir, { recursive: true });
		}

		this.sqlite = new Database(dbPath);
		this.sqlite.pragma('journal_mode = WAL');
		this.sqlite.pragma('foreign_keys = ON');
		this.sqlite.pragma('busy_timeout = 5000');

		this._db = drizzle(this.sqlite, { schema });
		this.logger.log(`SQLite database opened: ${dbPath}`);
	}

	async runMigrations() {
		const migrationsPath = resolve(import.meta.dirname, 'migrations');
		if (existsSync(migrationsPath)) {
			migrate(this._db, { migrationsFolder: migrationsPath });
			this.logger.log('Database migrations applied');
		} else {
			this.logger.warn('No migrations directory found - creating tables directly');
			this.createTablesIfNotExist();
		}
	}

	private createTablesIfNotExist() {
		// Create tables directly from SQL when no migrations exist yet
		this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        avatar_url TEXT,
        preferences TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        original_title TEXT,
        year INTEGER,
        overview TEXT,
        tagline TEXT,
        runtime_minutes INTEGER,
        release_date TEXT,
        language TEXT,
        country TEXT,
        poster_url TEXT,
        backdrop_url TEXT,
        trailer_url TEXT,
        thumbnail_url TEXT,
        imdb_id TEXT,
        tmdb_id INTEGER,
        content_rating TEXT,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_movies_imdb_id ON movies(imdb_id);
      CREATE INDEX IF NOT EXISTS idx_movies_tmdb_id ON movies(tmdb_id);
      CREATE TABLE IF NOT EXISTS movie_metadata (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL UNIQUE REFERENCES movies(id) ON DELETE CASCADE,
        genres TEXT DEFAULT '[]',
        cast_members TEXT DEFAULT '[]',
        directors TEXT DEFAULT '[]',
        writers TEXT DEFAULT '[]',
        keywords TEXT DEFAULT '[]',
        production_companies TEXT DEFAULT '[]',
        budget INTEGER,
        revenue INTEGER,
        imdb_rating REAL,
        imdb_votes INTEGER,
        tmdb_rating REAL,
        tmdb_votes INTEGER,
        rotten_tomatoes_score INTEGER,
        metacritic_score INTEGER,
        extended_data TEXT DEFAULT '{}',
        source TEXT,
        fetched_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_sources (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        label TEXT,
        scan_interval_hours INTEGER DEFAULT 6,
        enabled INTEGER DEFAULT 1,
        last_scanned_at TEXT,
        file_count INTEGER DEFAULT 0,
        total_size_bytes INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS movie_files (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES media_sources(id),
        file_path TEXT NOT NULL UNIQUE,
        file_name TEXT,
        file_size INTEGER,
        file_hash TEXT,
        resolution TEXT,
        codec_video TEXT,
        codec_audio TEXT,
        bitrate INTEGER,
        duration_seconds INTEGER,
        subtitle_tracks TEXT DEFAULT '[]',
        audio_tracks TEXT DEFAULT '[]',
        file_metadata TEXT,
        video_width INTEGER,
        video_height INTEGER,
        video_bit_depth INTEGER,
        video_frame_rate TEXT,
        video_profile TEXT,
        video_color_space TEXT,
        hdr INTEGER DEFAULT 0,
        container_format TEXT,
        available INTEGER DEFAULT 1,
        added_at TEXT NOT NULL,
        file_modified_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_ratings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        rating REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ratings_unique ON user_ratings(user_id, movie_id);
      CREATE TABLE IF NOT EXISTS user_watch_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        watched_at TEXT NOT NULL,
        duration_watched_seconds INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        position_seconds INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_watchlist (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_watchlist_unique ON user_watchlist(user_id, movie_id);
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        cover_url TEXT,
        is_smart INTEGER DEFAULT 0,
        smart_rules TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlist_movies (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_movies_unique ON playlist_movies(playlist_id, movie_id);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT,
        version TEXT,
        enabled INTEGER DEFAULT 0,
        settings TEXT DEFAULT '{}',
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT,
        device_type TEXT,
        ip_address TEXT,
        user_agent TEXT,
        last_active_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stream_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        movie_file_id TEXT REFERENCES movie_files(id),
        quality TEXT,
        transcoding INTEGER DEFAULT 0,
        started_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        position_seconds INTEGER DEFAULT 0,
        bandwidth_bytes INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS scan_log (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        files_found INTEGER DEFAULT 0,
        files_added INTEGER DEFAULT 0,
        files_updated INTEGER DEFAULT 0,
        files_removed INTEGER DEFAULT 0,
        errors TEXT DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS transcode_cache (
        id TEXT PRIMARY KEY,
        movie_file_id TEXT NOT NULL REFERENCES movie_files(id) ON DELETE CASCADE,
        quality TEXT NOT NULL,
        encoding_settings TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audio_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        is_default INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_history (
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
      );
    `);
		// Add columns that may not exist in older databases
		try {
			this.sqlite.exec(`ALTER TABLE movies ADD COLUMN thumbnail_url TEXT`);
		} catch {
			// Column already exists
		}
		try {
			this.sqlite.exec(`ALTER TABLE movie_files ADD COLUMN file_metadata TEXT`);
		} catch {
			// Column already exists
		}
		try {
			this.sqlite.exec(`ALTER TABLE movies ADD COLUMN thumbnail_aspect_ratio REAL`);
		} catch {
			// Column already exists
		}
		try {
			this.sqlite.exec(`ALTER TABLE plugins ADD COLUMN status TEXT DEFAULT 'not_installed'`);
		} catch {
			// Column already exists
		}
		try {
			this.sqlite.exec(`ALTER TABLE movies ADD COLUMN hidden INTEGER DEFAULT 0`);
		} catch {
			// Column already exists
		}
		try {
			this.sqlite.exec(`ALTER TABLE movies ADD COLUMN play_settings TEXT`);
		} catch {
			// Column already exists
		}
		// movie_files: enhanced FFprobe metadata columns
		const newFileColumns = [
			'video_width INTEGER',
			'video_height INTEGER',
			'video_bit_depth INTEGER',
			'video_frame_rate TEXT',
			'video_profile TEXT',
			'video_color_space TEXT',
			'hdr INTEGER DEFAULT 0',
			'container_format TEXT',
		];
		for (const col of newFileColumns) {
			try {
				this.sqlite.exec(`ALTER TABLE movie_files ADD COLUMN ${col}`);
			} catch {
				// Column already exists
			}
		}

		// playlist_movies: remove FK on movie_id to allow remote movie IDs,
		// and add columns for remote movie metadata
		try {
			const fkList = this.sqlite.pragma('foreign_key_list(playlist_movies)') as {
				table: string;
			}[];
			const hasMovieFK = fkList.some((fk) => fk.table === 'movies');
			if (hasMovieFK) {
				this.sqlite.pragma('foreign_keys = OFF');
				this.sqlite.exec(`
					CREATE TABLE playlist_movies_new (
						id TEXT PRIMARY KEY,
						playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
						movie_id TEXT NOT NULL,
						position INTEGER NOT NULL,
						added_at TEXT NOT NULL,
						remote_title TEXT,
						remote_poster_url TEXT,
						remote_server_id TEXT
					);
					INSERT INTO playlist_movies_new (id, playlist_id, movie_id, position, added_at)
						SELECT id, playlist_id, movie_id, position, added_at FROM playlist_movies;
					DROP TABLE playlist_movies;
					ALTER TABLE playlist_movies_new RENAME TO playlist_movies;
					CREATE UNIQUE INDEX idx_playlist_movies_unique ON playlist_movies(playlist_id, movie_id);
				`);
				this.sqlite.pragma('foreign_keys = ON');
				this.logger.log('Migrated playlist_movies to support remote movies');
			}
		} catch (err) {
			this.sqlite.pragma('foreign_keys = ON');
			this.logger.warn(`playlist_movies migration skipped: ${err}`);
		}
		// Add remote columns if table was already migrated but missing columns
		for (const col of [
			'remote_title TEXT',
			'remote_poster_url TEXT',
			'remote_server_id TEXT',
		]) {
			try {
				this.sqlite.exec(`ALTER TABLE playlist_movies ADD COLUMN ${col}`);
			} catch {
				// already exists
			}
		}

		this.logger.log('Tables created from inline SQL');
	}

	onModuleDestroy() {
		this.sqlite?.close();
		this.logger.log('Database connection closed');
	}
}
