/**
 * Media kinds (movies + music) — see docs/music-support-plan.md §4.
 *
 * 1. Polymorphic user-data tables (entity_ratings, entity_comments,
 *    entity_comment_reactions, play_history, entity_watchlist, playlist_items)
 *    + a ONE-TIME backfill from the movie-only tables. The backfill is guarded
 *    by a row in _migrations: re-copying on every run would resurrect rows the
 *    user deleted from the new tables.
 * 2. media_sources.kind, stream_sessions.entity_type.
 * 3. Music catalogue tables + FTS5 search indexes kept in sync by triggers.
 *
 * Idempotent: CREATE IF NOT EXISTS / guarded ALTERs / marker-gated backfill.
 */

const TABLES = [
	`CREATE TABLE IF NOT EXISTS _migrations (
		name TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`,

	// ── Polymorphic user data ─────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS entity_ratings (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		rating REAL NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS entity_ratings_uniq ON entity_ratings(user_id, entity_type, entity_id)`,
	`CREATE INDEX IF NOT EXISTS entity_ratings_entity_idx ON entity_ratings(entity_type, entity_id)`,

	`CREATE TABLE IF NOT EXISTS entity_comments (
		id TEXT PRIMARY KEY,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		parent_id TEXT,
		time_seconds REAL,
		text TEXT NOT NULL,
		edited INTEGER DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS entity_comments_entity_idx ON entity_comments(entity_type, entity_id)`,
	`CREATE INDEX IF NOT EXISTS entity_comments_parent_idx ON entity_comments(parent_id)`,

	`CREATE TABLE IF NOT EXISTS entity_comment_reactions (
		id TEXT PRIMARY KEY,
		comment_id TEXT NOT NULL REFERENCES entity_comments(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		emoji TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS entity_comment_reactions_uniq ON entity_comment_reactions(comment_id, user_id, emoji)`,
	`CREATE INDEX IF NOT EXISTS entity_comment_reactions_comment_idx ON entity_comment_reactions(comment_id)`,

	`CREATE TABLE IF NOT EXISTS play_history (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		position_seconds INTEGER DEFAULT 0,
		duration_watched_seconds INTEGER DEFAULT 0,
		completed INTEGER DEFAULT 0,
		play_count INTEGER DEFAULT 0,
		last_played_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS play_history_user_entity_idx ON play_history(user_id, entity_type, entity_id)`,
	`CREATE INDEX IF NOT EXISTS play_history_user_recent_idx ON play_history(user_id, last_played_at)`,
	`CREATE INDEX IF NOT EXISTS play_history_entity_idx ON play_history(entity_type, entity_id)`,

	`CREATE TABLE IF NOT EXISTS entity_watchlist (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		added_at TEXT NOT NULL,
		notes TEXT
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS entity_watchlist_uniq ON entity_watchlist(user_id, entity_type, entity_id)`,

	`CREATE TABLE IF NOT EXISTS playlist_items (
		id TEXT PRIMARY KEY,
		playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
		item_type TEXT NOT NULL,
		item_id TEXT NOT NULL,
		position INTEGER NOT NULL DEFAULT 0,
		added_at TEXT NOT NULL,
		added_by TEXT,
		remote_title TEXT,
		remote_poster_url TEXT,
		remote_server_id TEXT
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS playlist_items_uniq ON playlist_items(playlist_id, item_type, item_id)`,
	`CREATE INDEX IF NOT EXISTS playlist_items_playlist_idx ON playlist_items(playlist_id, position)`,
	`CREATE INDEX IF NOT EXISTS playlist_items_item_idx ON playlist_items(item_type, item_id)`,

	// ── Music catalogue ───────────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS artwork (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		source TEXT NOT NULL,
		original_path TEXT NOT NULL,
		hash TEXT NOT NULL,
		width INTEGER,
		height INTEGER,
		created_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS artwork_hash_idx ON artwork(hash)`,

	`CREATE TABLE IF NOT EXISTS artists (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		sort_name TEXT NOT NULL,
		norm_name TEXT NOT NULL,
		mbid TEXT,
		type TEXT,
		country TEXT,
		begin_year INTEGER,
		end_year INTEGER,
		disambiguation TEXT,
		bio TEXT,
		image_id TEXT,
		metadata_fetched_at TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS artists_mbid_idx ON artists(mbid)`,
	`CREATE INDEX IF NOT EXISTS artists_norm_idx ON artists(norm_name)`,
	`CREATE INDEX IF NOT EXISTS artists_sort_idx ON artists(sort_name)`,

	`CREATE TABLE IF NOT EXISTS albums (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		sort_title TEXT NOT NULL,
		norm_title TEXT NOT NULL,
		mbid_release_group TEXT,
		primary_type TEXT DEFAULT 'album',
		secondary_types TEXT DEFAULT '[]',
		is_compilation INTEGER DEFAULT 0,
		year INTEGER,
		original_year INTEGER,
		artist_credit TEXT,
		art_id TEXT,
		folder_path TEXT,
		track_count INTEGER DEFAULT 0,
		total_seconds INTEGER DEFAULT 0,
		rating_avg REAL,
		rating_count INTEGER DEFAULT 0,
		metadata_fetched_at TEXT,
		added_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS albums_rg_idx ON albums(mbid_release_group)`,
	`CREATE INDEX IF NOT EXISTS albums_norm_idx ON albums(norm_title)`,
	`CREATE INDEX IF NOT EXISTS albums_added_idx ON albums(added_at)`,
	`CREATE INDEX IF NOT EXISTS albums_year_idx ON albums(year)`,

	`CREATE TABLE IF NOT EXISTS album_releases (
		id TEXT PRIMARY KEY,
		album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		mbid_release TEXT,
		label TEXT,
		catalog_no TEXT,
		country TEXT,
		media_format TEXT,
		disc_count INTEGER DEFAULT 1,
		release_date TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS album_releases_album_idx ON album_releases(album_id)`,

	`CREATE TABLE IF NOT EXISTS album_artists (
		album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
		role TEXT NOT NULL DEFAULT 'primary',
		position INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS album_artists_pk ON album_artists(album_id, artist_id, role)`,
	`CREATE INDEX IF NOT EXISTS album_artists_artist_idx ON album_artists(artist_id)`,

	`CREATE TABLE IF NOT EXISTS tracks (
		id TEXT PRIMARY KEY,
		album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		release_id TEXT,
		title TEXT NOT NULL,
		norm_title TEXT NOT NULL,
		disc_no INTEGER DEFAULT 1,
		track_no INTEGER,
		duration_seconds REAL,
		artist_credit TEXT,
		mbid_recording TEXT,
		isrc TEXT,
		explicit INTEGER DEFAULT 0,
		bpm REAL,
		musical_key TEXT,
		rating_avg REAL,
		rating_count INTEGER DEFAULT 0,
		play_count INTEGER DEFAULT 0,
		added_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS tracks_album_order_idx ON tracks(album_id, disc_no, track_no)`,
	`CREATE INDEX IF NOT EXISTS tracks_recording_idx ON tracks(mbid_recording)`,
	`CREATE INDEX IF NOT EXISTS tracks_norm_idx ON tracks(norm_title)`,

	`CREATE TABLE IF NOT EXISTS track_artists (
		track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
		artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
		role TEXT NOT NULL DEFAULT 'primary',
		position INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS track_artists_pk ON track_artists(track_id, artist_id, role)`,
	`CREATE INDEX IF NOT EXISTS track_artists_artist_idx ON track_artists(artist_id)`,

	`CREATE TABLE IF NOT EXISTS track_files (
		id TEXT PRIMARY KEY,
		track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
		source_id TEXT REFERENCES media_sources(id),
		file_path TEXT NOT NULL UNIQUE,
		file_name TEXT NOT NULL,
		file_size INTEGER,
		file_modified_at TEXT,
		container TEXT,
		codec TEXT,
		bitrate INTEGER,
		sample_rate INTEGER,
		bit_depth INTEGER,
		channels INTEGER,
		lossless INTEGER DEFAULT 0,
		duration_seconds REAL,
		replaygain_track REAL,
		replaygain_album REAL,
		fingerprint TEXT,
		waveform_path TEXT,
		uploaded_by TEXT,
		available INTEGER DEFAULT 1,
		added_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS track_files_track_idx ON track_files(track_id)`,
	`CREATE INDEX IF NOT EXISTS track_files_source_idx ON track_files(source_id)`,

	`CREATE TABLE IF NOT EXISTS music_genres (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		norm_name TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS music_genres_norm_idx ON music_genres(norm_name)`,
	`CREATE TABLE IF NOT EXISTS album_genres (
		album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		genre_id TEXT NOT NULL REFERENCES music_genres(id) ON DELETE CASCADE
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS album_genres_pk ON album_genres(album_id, genre_id)`,
	`CREATE INDEX IF NOT EXISTS album_genres_genre_idx ON album_genres(genre_id)`,
	`CREATE TABLE IF NOT EXISTS artist_genres (
		artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
		genre_id TEXT NOT NULL REFERENCES music_genres(id) ON DELETE CASCADE
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS artist_genres_pk ON artist_genres(artist_id, genre_id)`,
	`CREATE INDEX IF NOT EXISTS artist_genres_genre_idx ON artist_genres(genre_id)`,

	`CREATE TABLE IF NOT EXISTS lyrics (
		track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
		plain TEXT,
		synced_lrc TEXT,
		source TEXT,
		language TEXT,
		edited_by TEXT,
		fetched_at TEXT,
		updated_at TEXT NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS music_identities (
		id TEXT PRIMARY KEY,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		source TEXT NOT NULL,
		external_id TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS music_identities_uniq ON music_identities(source, external_id, entity_type)`,
	`CREATE INDEX IF NOT EXISTS music_identities_entity_idx ON music_identities(entity_type, entity_id)`,

	// FTS5 (external content) — keyword search over a large catalogue without
	// LIKE scans. Triggers keep them in sync with the base tables.
	`CREATE VIRTUAL TABLE IF NOT EXISTS artists_fts USING fts5(name, content='artists', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS albums_fts USING fts5(title, artist_credit, content='albums', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(title, artist_credit, content='tracks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
	...ftsTriggers('artists', ['name']),
	...ftsTriggers('albums', ['title', 'artist_credit']),
	...ftsTriggers('tracks', ['title', 'artist_credit']),
];

function ftsTriggers(table, cols) {
	const fts = `${table}_fts`;
	const list = cols.join(', ');
	const newVals = cols.map((c) => `new.${c}`).join(', ');
	const oldVals = cols.map((c) => `old.${c}`).join(', ');
	return [
		`CREATE TRIGGER IF NOT EXISTS ${table}_fts_ai AFTER INSERT ON ${table} BEGIN
			INSERT INTO ${fts}(rowid, ${list}) VALUES (new.rowid, ${newVals});
		END`,
		`CREATE TRIGGER IF NOT EXISTS ${table}_fts_ad AFTER DELETE ON ${table} BEGIN
			INSERT INTO ${fts}(${fts}, rowid, ${list}) VALUES ('delete', old.rowid, ${oldVals});
		END`,
		`CREATE TRIGGER IF NOT EXISTS ${table}_fts_au AFTER UPDATE ON ${table} BEGIN
			INSERT INTO ${fts}(${fts}, rowid, ${list}) VALUES ('delete', old.rowid, ${oldVals});
			INSERT INTO ${fts}(rowid, ${list}) VALUES (new.rowid, ${newVals});
		END`,
	];
}

const ALTERS = [
	`ALTER TABLE media_sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'video'`,
	`ALTER TABLE stream_sessions ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'movie'`,
];

function tableExists(db, name) {
	return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function backfillOnce(db, name, fn) {
	if (db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)) return;
	db.transaction(() => {
		fn();
		db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
			name,
			new Date().toISOString(),
		);
	})();
	console.log(`Backfill applied: ${name}`);
}

function apply(db) {
	for (const sql of TABLES) db.exec(sql);
	for (const sql of ALTERS) {
		try {
			db.exec(sql);
		} catch (e) {
			if (!/duplicate column/i.test(String(e.message))) throw e;
		}
	}

	backfillOnce(db, '2026-10-entity-tables-backfill', () => {
		if (tableExists(db, 'user_ratings')) {
			db.exec(`INSERT OR IGNORE INTO entity_ratings (id, user_id, entity_type, entity_id, rating, created_at, updated_at)
				SELECT id, user_id, 'movie', movie_id, rating, created_at, updated_at FROM user_ratings`);
		}
		if (tableExists(db, 'movie_comments')) {
			db.exec(`INSERT OR IGNORE INTO entity_comments (id, entity_type, entity_id, user_id, parent_id, time_seconds, text, edited, created_at, updated_at)
				SELECT id, 'movie', movie_id, user_id, parent_id, time_seconds, text, edited, created_at, updated_at FROM movie_comments`);
		}
		if (tableExists(db, 'comment_reactions')) {
			db.exec(`INSERT OR IGNORE INTO entity_comment_reactions (id, comment_id, user_id, emoji, created_at)
				SELECT r.id, r.comment_id, r.user_id, r.emoji, r.created_at FROM comment_reactions r
				WHERE EXISTS (SELECT 1 FROM entity_comments c WHERE c.id = r.comment_id)`);
		}
		if (tableExists(db, 'user_watch_history')) {
			db.exec(`INSERT OR IGNORE INTO play_history (id, user_id, entity_type, entity_id, position_seconds, duration_watched_seconds, completed, play_count, last_played_at)
				SELECT id, user_id, 'movie', movie_id, COALESCE(position_seconds,0), COALESCE(duration_watched_seconds,0), COALESCE(completed,0), CASE WHEN completed THEN 1 ELSE 0 END, watched_at FROM user_watch_history`);
		}
		if (tableExists(db, 'user_watchlist')) {
			db.exec(`INSERT OR IGNORE INTO entity_watchlist (id, user_id, entity_type, entity_id, added_at, notes)
				SELECT id, user_id, 'movie', movie_id, added_at, notes FROM user_watchlist`);
		}
		if (tableExists(db, 'playlist_movies')) {
			db.exec(`INSERT OR IGNORE INTO playlist_items (id, playlist_id, item_type, item_id, position, added_at, added_by, remote_title, remote_poster_url, remote_server_id)
				SELECT id, playlist_id, 'movie', movie_id, position, added_at, added_by, remote_title, remote_poster_url, remote_server_id FROM playlist_movies`);
		}
	});

	// Rebuild FTS from content once (covers rows inserted before the triggers).
	backfillOnce(db, '2026-10-music-fts-rebuild', () => {
		for (const t of ['artists_fts', 'albums_fts', 'tracks_fts']) {
			db.exec(`INSERT INTO ${t}(${t}) VALUES ('rebuild')`);
		}
	});
}

module.exports = { apply };
