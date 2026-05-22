import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCache } from '../../database/schema/search-cache.js';
import { SearchCacheService } from '../search-cache.service.js';

function makeDb() {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE search_cache (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			normalized_query TEXT NOT NULL,
			source TEXT NOT NULL,
			payload TEXT NOT NULL,
			fetched_at TEXT NOT NULL
		);
	`);
	return drizzle(sqlite, { schema: { searchCache } });
}

describe('SearchCacheService', () => {
	let db: any;
	let svc: SearchCacheService;

	beforeEach(() => {
		db = makeDb();
		svc = new SearchCacheService({ db } as any);
	});

	it('returns null when no row exists', () => {
		expect(svc.get('movie', 'matrix', 'tmdb')).toBeNull();
	});

	it('round-trips items via set/get', () => {
		svc.set('movie', 'matrix', 'tmdb', [{ tmdbId: 603, title: 'The Matrix' }]);
		const got = svc.get('movie', 'matrix', 'tmdb');
		expect(got).toEqual([{ tmdbId: 603, title: 'The Matrix' }]);
	});

	it('treats rows older than 7 days as miss', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		svc.set('movie', 'matrix', 'tmdb', [{ title: 'X' }]);
		vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
		expect(svc.get('movie', 'matrix', 'tmdb')).toBeNull();
		vi.useRealTimers();
	});

	it('upserts (same key replaces row)', () => {
		svc.set('movie', 'matrix', 'tmdb', [{ title: 'V1' }]);
		svc.set('movie', 'matrix', 'tmdb', [{ title: 'V2' }]);
		expect(svc.get('movie', 'matrix', 'tmdb')).toEqual([{ title: 'V2' }]);
	});

	it('normalizes query for cache key', () => {
		svc.set('movie', '  The  Matrix  ', 'tmdb', [{ title: 'X' }]);
		expect(svc.get('movie', 'the matrix', 'tmdb')).toEqual([{ title: 'X' }]);
	});

	it('per-source rows are independent', () => {
		svc.set('movie', 'matrix', 'tmdb', [{ title: 'TMDB' }]);
		svc.set('movie', 'matrix', 'omdb', [{ title: 'OMDB' }]);
		expect(svc.get('movie', 'matrix', 'tmdb')).toEqual([{ title: 'TMDB' }]);
		expect(svc.get('movie', 'matrix', 'omdb')).toEqual([{ title: 'OMDB' }]);
	});
});
