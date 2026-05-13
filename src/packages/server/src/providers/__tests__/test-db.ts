import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema/index.js';

/**
 * Build an in-memory SQLite + Drizzle instance with the provider
 * platform tables for unit tests. Mirrors the CREATE TABLE
 * statements in `scripts/migrate.js` for the three tables Phase 0
 * services need; not the whole app schema (tests should be tiny).
 */
export function makeTestDb(): {
	db: BetterSQLite3Database<typeof schema>;
	sqlite: Database.Database;
} {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE provider_credentials (
			provider_id TEXT PRIMARY KEY,
			config TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			encrypted INTEGER NOT NULL DEFAULT 0,
			added_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE provider_usage (
			provider_id TEXT NOT NULL,
			window TEXT NOT NULL,
			bucket_key TEXT NOT NULL,
			count INTEGER NOT NULL DEFAULT 0,
			cost_usd REAL DEFAULT 0,
			PRIMARY KEY (provider_id, window, bucket_key)
		);
		CREATE TABLE provider_events (
			id TEXT PRIMARY KEY,
			provider_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			status_code INTEGER,
			duration_ms INTEGER,
			cost_usd REAL,
			payload TEXT,
			occurred_at TEXT NOT NULL
		);
		CREATE INDEX provider_events_provider_idx ON provider_events(provider_id, occurred_at);
	`);
	const db = drizzle(sqlite, { schema });
	return { db, sqlite };
}

/** Minimal stand-in for DatabaseService so we can construct services in tests. */
export function makeFakeDatabaseService(db: BetterSQLite3Database<typeof schema>) {
	return { db } as any;
}
