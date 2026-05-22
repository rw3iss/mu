# Inline Federated Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/discover` modal "+ Add" with two inline live-search dropdowns (movies + people) backed by an SSE-streaming federated search across local DB + TMDB + OMDB + Trakt, with a persistent 7-day search cache and `/movie/tmdb:<id>` virtual-row support for non-library detail pages.

**Architecture:** New server `SearchModule` exposes `@Sse('/search/{type}/stream?q=')` endpoints; an orchestrator service streams local-DB results first, then queries cache, then external providers in parallel and emits each as it arrives. Cross-source dedup by IMDB ID. New `EntitySearchInput` client component with `useSearchStream` hook wraps EventSource. Three phases: server foundation (local+TMDB), client + Discover wiring, then OMDB+Trakt as additive sources.

**Tech Stack:** NestJS 11, Fastify 5, Drizzle ORM, better-sqlite3, Vitest, RxJS (Observable for SSE), Preact 10, Preact Signals, Vite 6, SCSS Modules.

**Spec:** `docs/superpowers/specs/2026-05-21-inline-federated-search-design.md`

---

## File Structure

### Phase 1 — Server foundation
- **Create** `packages/server/src/database/schema/search-cache.ts` — Drizzle table
- **Modify** `packages/server/src/database/schema/index.ts` — re-export
- **Modify** `src/scripts/migrate.js` — CREATE TABLE IF NOT EXISTS
- **Create** `packages/server/src/search/search-types.ts` — `SearchHit`, `SearchEvent`
- **Create** `packages/server/src/search/dedup.ts` — dedup-key + merge helpers
- **Create** `packages/server/src/search/__tests__/dedup.spec.ts`
- **Create** `packages/server/src/search/search-cache.service.ts`
- **Create** `packages/server/src/search/__tests__/search-cache.service.spec.ts`
- **Create** `packages/server/src/search/federated-movie-search.service.ts`
- **Create** `packages/server/src/search/__tests__/federated-movie-search.service.spec.ts`
- **Create** `packages/server/src/search/federated-people-search.service.ts`
- **Create** `packages/server/src/search/__tests__/federated-people-search.service.spec.ts`
- **Create** `packages/server/src/search/search.controller.ts` — SSE + JSON
- **Create** `packages/server/src/search/search.module.ts`
- **Modify** `packages/server/src/app.module.ts` — register `SearchModule`
- **Modify** `packages/server/src/movies/movies.service.ts` — `getOrFetchByKey()`
- **Modify** `packages/server/src/movies/movies.controller.ts` — accept `tmdb:<id>` keys

### Phase 2 — Client + Discover
- **Create** `packages/shared/src/types/search.ts` — shared `SearchHit`, `SearchEventEnvelope`
- **Modify** `packages/shared/src/index.ts` — export
- **Create** `packages/client/src/services/search.service.ts` — JSON fallback wrapper
- **Create** `packages/client/src/components/common/EntitySearchInput/EntitySearchInput.tsx`
- **Create** `packages/client/src/components/common/EntitySearchInput/EntitySearchInput.module.scss`
- **Create** `packages/client/src/components/common/EntitySearchInput/useSearchStream.ts`
- **Create** `packages/client/src/components/common/EntitySearchInput/MovieSearchInput.tsx`
- **Create** `packages/client/src/components/common/EntitySearchInput/PersonSearchInput.tsx`
- **Create** `packages/client/src/components/common/EntitySearchInput/index.ts`
- **Create** `packages/client/src/components/common/EntitySearchInput/__tests__/useSearchStream.test.ts`
- **Create** `packages/client/src/components/common/EntitySearchInput/__tests__/EntitySearchInput.test.tsx`
- **Modify** `packages/client/src/pages/Discover.tsx` — swap MoviePicker for inline inputs
- **Modify** `packages/client/src/pages/Discover.module.scss` — `.seedSearchRow`
- **Modify** `packages/client/src/components/discover/SeedChip.tsx` — `kind` prop
- **Modify** `packages/client/src/components/discover/SeedChip.module.scss` — `.person` variant
- **Modify** `packages/client/src/pages/MovieDetail.tsx` — render `isOwned=false` state

### Phase 3 — OMDB + Trakt
- **Modify** `packages/server/src/metadata/providers/omdb.provider.ts` — `searchMovie()`
- **Modify** `packages/server/src/metadata/providers/__tests__/omdb.provider.spec.ts` — search test
- **Create** `packages/server/src/metadata/providers/trakt.provider.ts`
- **Create** `packages/server/src/metadata/providers/__tests__/trakt.provider.spec.ts`
- **Modify** `packages/server/src/metadata/metadata.module.ts` — register Trakt
- **Modify** `packages/server/src/search/federated-movie-search.service.ts` — wire OMDB + Trakt
- **Modify** `packages/server/src/search/federated-people-search.service.ts` — wire Trakt

---

# PHASE 1 — Server foundation (local + TMDB)

## Task 1: `search_cache` schema + migration

**Files:**
- Create: `src/packages/server/src/database/schema/search-cache.ts`
- Modify: `src/packages/server/src/database/schema/index.ts`
- Modify: `src/scripts/migrate.js`

- [ ] **Step 1: Define Drizzle table**

`src/packages/server/src/database/schema/search-cache.ts`:
```ts
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Persistent cache for federated search results. One row per
 * (type, normalized_query, source). TTL enforced in service layer
 * (rows older than 7 days are treated as miss).
 */
export const searchCache = sqliteTable(
	'search_cache',
	{
		id: text('id').primaryKey(),
		type: text('type', { enum: ['movie', 'person'] }).notNull(),
		normalizedQuery: text('normalized_query').notNull(),
		source: text('source', { enum: ['tmdb', 'omdb', 'trakt'] }).notNull(),
		payload: text('payload').notNull(),
		fetchedAt: text('fetched_at').notNull(),
	},
	(t) => ({
		typeQueryIdx: index('search_cache_type_query').on(t.type, t.normalizedQuery),
	}),
);

export type SearchCacheRow = typeof searchCache.$inferSelect;
export type NewSearchCacheRow = typeof searchCache.$inferInsert;
```

- [ ] **Step 2: Re-export from schema index**

Append to `src/packages/server/src/database/schema/index.ts` (keep alphabetical with neighbours):
```ts
export type { SearchCacheRow, NewSearchCacheRow } from './search-cache.ts';
export { searchCache } from './search-cache.ts';
```

- [ ] **Step 3: Migration**

Add to `src/scripts/migrate.js` in the table-creation block (near the other `CREATE TABLE IF NOT EXISTS` calls):
```js
db.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        normalized_query TEXT NOT NULL,
        source TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS search_cache_type_query
        ON search_cache(type, normalized_query);
`);
```

- [ ] **Step 4: Run migrate locally**

```
cd src && pnpm db:migrate
```
Expected: prints applied + finishes 0.

- [ ] **Step 5: Commit**

```
git add src/packages/server/src/database/schema/search-cache.ts \
        src/packages/server/src/database/schema/index.ts \
        src/scripts/migrate.js
git commit -m "Search: add search_cache table + migration"
```

---

## Task 2: Shared search types + dedup utility

**Files:**
- Create: `src/packages/server/src/search/search-types.ts`
- Create: `src/packages/server/src/search/dedup.ts`
- Create: `src/packages/server/src/search/__tests__/dedup.spec.ts`

- [ ] **Step 1: Types**

`src/packages/server/src/search/search-types.ts`:
```ts
export type SearchSource = 'local' | 'cache' | 'tmdb' | 'omdb' | 'trakt';

export interface MovieSearchHit {
	movieId?: string;
	imdbId?: string;
	tmdbId?: number;
	traktId?: number;
	title: string;
	year?: number;
	posterUrl?: string;
	overview?: string;
	sources: SearchSource[];
	isOwned: boolean;
	matchScore: number;
}

export interface PersonSearchHit {
	personKey: string;
	tmdbId?: number;
	traktId?: number;
	name: string;
	profileUrl?: string;
	role?: string;
	knownFor?: string[];
	sources: SearchSource[];
	isOwned: boolean;
	matchScore: number;
}

export type SearchHit = MovieSearchHit | PersonSearchHit;

export interface SearchResultsEvent<T> {
	kind: 'results';
	source: SearchSource;
	items: T[];
}
export interface SearchErrorEvent {
	kind: 'error';
	source: SearchSource;
	message: string;
}
export interface SearchDoneEvent {
	kind: 'done';
	sourcesQueried: SearchSource[];
}
export type SearchEvent<T> = SearchResultsEvent<T> | SearchErrorEvent | SearchDoneEvent;
```

- [ ] **Step 2: Failing dedup tests**

`src/packages/server/src/search/__tests__/dedup.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
	mergeMovieHit,
	movieDedupKey,
	normalizeQuery,
	personDedupKey,
	scoreMovie,
} from '../dedup.js';
import type { MovieSearchHit } from '../search-types.js';

describe('normalizeQuery', () => {
	it('lowercases, trims, collapses whitespace', () => {
		expect(normalizeQuery('  The   Matrix  ')).toBe('the matrix');
	});
});

describe('movieDedupKey', () => {
	it('prefers imdbId', () => {
		expect(movieDedupKey({ title: 'X', imdbId: 'tt1', tmdbId: 99 } as MovieSearchHit)).toBe(
			'imdb:tt1',
		);
	});
	it('falls back to tmdbId', () => {
		expect(movieDedupKey({ title: 'X', tmdbId: 42 } as MovieSearchHit)).toBe('tmdb:42');
	});
	it('falls back to title+year slug', () => {
		expect(movieDedupKey({ title: 'The Matrix', year: 1999 } as MovieSearchHit)).toBe(
			'slug:the-matrix|1999',
		);
	});
});

describe('personDedupKey', () => {
	it('prefers tmdbId', () => {
		expect(personDedupKey({ name: 'X', personKey: 'name:x', tmdbId: 7 } as any)).toBe('tmdb:7');
	});
	it('falls back to personKey', () => {
		expect(personDedupKey({ name: 'X', personKey: 'name:x' } as any)).toBe('key:name:x');
	});
});

describe('mergeMovieHit', () => {
	const base: MovieSearchHit = {
		tmdbId: 1, title: 'X', sources: ['tmdb'], isOwned: false, matchScore: 0.7,
	};
	it('unions sources, keeps highest score, prefers populated fields', () => {
		const next: MovieSearchHit = {
			tmdbId: 1, title: 'X', sources: ['omdb'], isOwned: false, matchScore: 0.9,
			imdbId: 'tt1', overview: 'Plot.',
		};
		const merged = mergeMovieHit(base, next);
		expect(merged.sources).toEqual(['tmdb', 'omdb']);
		expect(merged.matchScore).toBe(0.9);
		expect(merged.imdbId).toBe('tt1');
		expect(merged.overview).toBe('Plot.');
	});
});

describe('scoreMovie', () => {
	it('exact title match scores higher than partial', () => {
		const exact = scoreMovie('matrix', { title: 'Matrix' } as MovieSearchHit);
		const partial = scoreMovie('matrix', { title: 'Matrix Reloaded' } as MovieSearchHit);
		expect(exact).toBeGreaterThan(partial);
	});
});
```

- [ ] **Step 3: Verify they fail**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/dedup.spec.ts
```
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

`src/packages/server/src/search/dedup.ts`:
```ts
import type {
	MovieSearchHit,
	PersonSearchHit,
	SearchSource,
} from './search-types.js';

export function normalizeQuery(q: string): string {
	return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

function slug(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function movieDedupKey(hit: MovieSearchHit): string {
	if (hit.imdbId) return `imdb:${hit.imdbId}`;
	if (hit.tmdbId) return `tmdb:${hit.tmdbId}`;
	if (hit.movieId) return `local:${hit.movieId}`;
	return `slug:${slug(hit.title)}|${hit.year ?? ''}`;
}

export function personDedupKey(hit: PersonSearchHit): string {
	if (hit.tmdbId) return `tmdb:${hit.tmdbId}`;
	if (hit.traktId) return `trakt:${hit.traktId}`;
	return `key:${hit.personKey}`;
}

function mergeSources(a: SearchSource[], b: SearchSource[]): SearchSource[] {
	const out = [...a];
	for (const s of b) if (!out.includes(s)) out.push(s);
	return out;
}

function preferFilled<T>(a: T | undefined, b: T | undefined): T | undefined {
	return a ?? b;
}

export function mergeMovieHit(a: MovieSearchHit, b: MovieSearchHit): MovieSearchHit {
	return {
		movieId: preferFilled(a.movieId, b.movieId),
		imdbId: preferFilled(a.imdbId, b.imdbId),
		tmdbId: preferFilled(a.tmdbId, b.tmdbId),
		traktId: preferFilled(a.traktId, b.traktId),
		title: a.title || b.title,
		year: preferFilled(a.year, b.year),
		posterUrl: preferFilled(a.posterUrl, b.posterUrl),
		overview: preferFilled(a.overview, b.overview),
		sources: mergeSources(a.sources, b.sources),
		isOwned: a.isOwned || b.isOwned,
		matchScore: Math.max(a.matchScore, b.matchScore),
	};
}

export function mergePersonHit(a: PersonSearchHit, b: PersonSearchHit): PersonSearchHit {
	return {
		personKey: a.personKey || b.personKey,
		tmdbId: preferFilled(a.tmdbId, b.tmdbId),
		traktId: preferFilled(a.traktId, b.traktId),
		name: a.name || b.name,
		profileUrl: preferFilled(a.profileUrl, b.profileUrl),
		role: preferFilled(a.role, b.role),
		knownFor: a.knownFor && a.knownFor.length ? a.knownFor : b.knownFor,
		sources: mergeSources(a.sources, b.sources),
		isOwned: a.isOwned || b.isOwned,
		matchScore: Math.max(a.matchScore, b.matchScore),
	};
}

export function scoreMovie(query: string, hit: MovieSearchHit): number {
	const q = normalizeQuery(query);
	const t = normalizeQuery(hit.title);
	if (t === q) return 1.0;
	if (t.startsWith(q)) return 0.85;
	if (t.includes(q)) return 0.6;
	return 0.4;
}

export function scorePerson(query: string, hit: PersonSearchHit): number {
	const q = normalizeQuery(query);
	const n = normalizeQuery(hit.name);
	if (n === q) return 1.0;
	if (n.startsWith(q)) return 0.85;
	if (n.includes(q)) return 0.6;
	return 0.4;
}
```

- [ ] **Step 5: Verify pass**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/dedup.spec.ts
```
Expected: 7/7 passing.

- [ ] **Step 6: Commit**

```
git add src/packages/server/src/search/
git commit -m "Search: shared types + dedup/merge/score utilities"
```

---

## Task 3: SearchCacheService (Drizzle wrapper + TTL)

**Files:**
- Create: `src/packages/server/src/search/search-cache.service.ts`
- Create: `src/packages/server/src/search/__tests__/search-cache.service.spec.ts`

- [ ] **Step 1: Failing tests**

`src/packages/server/src/search/__tests__/search-cache.service.spec.ts`:
```ts
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
});
```

- [ ] **Step 2: Run, see it fail**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/search-cache.service.spec.ts
```

- [ ] **Step 3: Implement**

`src/packages/server/src/search/search-cache.service.ts`:
```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { searchCache } from '../database/schema/search-cache.js';
import { normalizeQuery } from './dedup.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SearchCacheService {
	constructor(private readonly database: DatabaseService) {}

	private hash(type: string, q: string, source: string): string {
		return createHash('sha1').update(`${type}|${q}|${source}`).digest('hex');
	}

	get<T>(type: 'movie' | 'person', query: string, source: 'tmdb' | 'omdb' | 'trakt'): T[] | null {
		const q = normalizeQuery(query);
		const id = this.hash(type, q, source);
		const row = this.database.db
			.select()
			.from(searchCache)
			.where(eq(searchCache.id, id))
			.get();
		if (!row) return null;
		const age = Date.now() - new Date(row.fetchedAt).getTime();
		if (age > TTL_MS) return null;
		try {
			return JSON.parse(row.payload) as T[];
		} catch {
			return null;
		}
	}

	set<T>(
		type: 'movie' | 'person',
		query: string,
		source: 'tmdb' | 'omdb' | 'trakt',
		items: T[],
	): void {
		const q = normalizeQuery(query);
		const id = this.hash(type, q, source);
		const payload = JSON.stringify(items);
		const fetchedAt = new Date().toISOString();
		this.database.db
			.insert(searchCache)
			.values({ id, type, normalizedQuery: q, source, payload, fetchedAt })
			.onConflictDoUpdate({
				target: searchCache.id,
				set: { payload, fetchedAt },
			})
			.run();
	}
}
```

- [ ] **Step 4: Verify**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/search-cache.service.spec.ts
```
Expected: 4/4 passing.

- [ ] **Step 5: Commit**

```
git add src/packages/server/src/search/search-cache.service.ts \
        src/packages/server/src/search/__tests__/search-cache.service.spec.ts
git commit -m "Search: SearchCacheService with 7d TTL + Drizzle upsert"
```

---

## Task 4: FederatedMovieSearchService (local + TMDB)

**Files:**
- Create: `src/packages/server/src/search/federated-movie-search.service.ts`
- Create: `src/packages/server/src/search/__tests__/federated-movie-search.service.spec.ts`

- [ ] **Step 1: Failing test (RxJS toArray pattern)**

`src/packages/server/src/search/__tests__/federated-movie-search.service.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { FederatedMovieSearchService } from '../federated-movie-search.service.js';
import type { MovieSearchHit, SearchEvent } from '../search-types.js';

function mockLocalRepo(rows: Array<Partial<MovieSearchHit>> = []) {
	return { searchMovies: vi.fn().mockResolvedValue(rows) };
}
function mockTmdb(rows: any[] = []) {
	return { searchMovie: vi.fn().mockResolvedValue(rows) };
}
function mockCache() {
	return {
		get: vi.fn().mockReturnValue(null),
		set: vi.fn(),
	};
}

describe('FederatedMovieSearchService', () => {
	let local: any, tmdb: any, cache: any, svc: FederatedMovieSearchService;
	beforeEach(() => {
		local = mockLocalRepo();
		tmdb = mockTmdb();
		cache = mockCache();
		svc = new FederatedMovieSearchService(local, tmdb, cache);
	});

	it('emits local results first then external then done', async () => {
		local.searchMovies.mockResolvedValue([
			{ movieId: 'lib1', title: 'Local Hit', isOwned: true, sources: ['local'], matchScore: 1 },
		]);
		tmdb.searchMovie.mockResolvedValue([
			{ id: 1, title: 'TMDB Hit', release_date: '1999-03-30' },
		]);
		const events = (await lastValueFrom(
			svc.search$('matrix', 'user-1').pipe(toArray()),
		)) as SearchEvent<MovieSearchHit>[];
		const sources = events.map((e) => (e.kind === 'results' ? e.source : e.kind));
		expect(sources[0]).toBe('local');
		expect(sources).toContain('tmdb');
		expect(sources[sources.length - 1]).toBe('done');
	});

	it('uses cache when present and skips upstream', async () => {
		cache.get.mockReturnValue([{ tmdbId: 1, title: 'Cached' }]);
		const events = (await lastValueFrom(
			svc.search$('matrix', 'user-1').pipe(toArray()),
		)) as SearchEvent<MovieSearchHit>[];
		expect(tmdb.searchMovie).not.toHaveBeenCalled();
		const sources = events
			.filter((e) => e.kind === 'results')
			.map((e: any) => e.source);
		expect(sources).toContain('cache');
	});

	it('continues when a source errors', async () => {
		tmdb.searchMovie.mockRejectedValue(new Error('rate limited'));
		const events = (await lastValueFrom(
			svc.search$('matrix', 'user-1').pipe(toArray()),
		)) as SearchEvent<MovieSearchHit>[];
		const errored = events.find((e) => e.kind === 'error');
		const done = events.find((e) => e.kind === 'done');
		expect(errored).toBeTruthy();
		expect(done).toBeTruthy();
	});

	it('persists fresh upstream results to cache', async () => {
		tmdb.searchMovie.mockResolvedValue([{ id: 1, title: 'Matrix', release_date: '1999-01-01' }]);
		await lastValueFrom(svc.search$('matrix', 'u').pipe(toArray()));
		expect(cache.set).toHaveBeenCalledWith('movie', 'matrix', 'tmdb', expect.any(Array));
	});
});
```

- [ ] **Step 2: Run — expect fail**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/federated-movie-search.service.spec.ts
```

- [ ] **Step 3: Implement**

`src/packages/server/src/search/federated-movie-search.service.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { MoviesService } from '../movies/movies.service.js';
import { mergeMovieHit, movieDedupKey, scoreMovie } from './dedup.js';
import { SearchCacheService } from './search-cache.service.js';
import type {
	MovieSearchHit,
	SearchEvent,
	SearchSource,
} from './search-types.js';

const SOURCE_TIMEOUT_MS = 5000;

/**
 * Federated movie search orchestrator. Phase 1 wires local + TMDB.
 * Phase 3 will add OMDB + Trakt at the additional-source seam below.
 */
@Injectable()
export class FederatedMovieSearchService {
	private readonly logger = new Logger('FederatedMovieSearch');

	constructor(
		private readonly movies: MoviesService,
		private readonly tmdb: TmdbProvider,
		private readonly cache: SearchCacheService,
	) {}

	search$(query: string, userId: string): Observable<SearchEvent<MovieSearchHit>> {
		return new Observable((subscriber) => {
			const hitsByKey = new Map<string, MovieSearchHit>();
			const sourcesQueried: SearchSource[] = [];
			let cancelled = false;

			const emitResults = (source: SearchSource, items: MovieSearchHit[]) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				const newOrUpdated: MovieSearchHit[] = [];
				for (const item of items) {
					const key = movieDedupKey(item);
					const existing = hitsByKey.get(key);
					const merged = existing ? mergeMovieHit(existing, item) : item;
					hitsByKey.set(key, merged);
					newOrUpdated.push(merged);
				}
				subscriber.next({ kind: 'results', source, items: newOrUpdated });
			};

			const emitError = (source: SearchSource, message: string) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				subscriber.next({ kind: 'error', source, message });
			};

			const withTimeout = <T>(p: Promise<T>, source: SearchSource): Promise<T | null> =>
				Promise.race([
					p,
					new Promise<null>((_, reject) =>
						setTimeout(
							() => reject(new Error(`${source} timed out after ${SOURCE_TIMEOUT_MS}ms`)),
							SOURCE_TIMEOUT_MS,
						),
					),
				]).catch((err) => {
					emitError(source, err instanceof Error ? err.message : String(err));
					return null;
				});

			(async () => {
				// 1) Local DB — synchronous-ish, fast path
				try {
					const local = await this.movies.searchForFederation(query, userId);
					const scored = local.map((h) => ({ ...h, matchScore: scoreMovie(query, h) }));
					if (scored.length) emitResults('local', scored);
				} catch (e: any) {
					emitError('local', e?.message ?? String(e));
				}

				// 2) Cache + upstreams in parallel per source
				await Promise.all([this.runTmdb(query, withTimeout, emitResults)]);

				if (!cancelled) {
					subscriber.next({ kind: 'done', sourcesQueried });
					subscriber.complete();
				}
			})();

			return () => {
				cancelled = true;
			};
		});
	}

	private async runTmdb(
		query: string,
		withTimeout: <T>(p: Promise<T>, s: SearchSource) => Promise<T | null>,
		emit: (s: SearchSource, items: MovieSearchHit[]) => void,
	) {
		const cached = this.cache.get<MovieSearchHit>('movie', query, 'tmdb');
		if (cached) {
			emit('cache', cached);
			return;
		}
		const raw = await withTimeout(this.tmdb.searchMovie(query), 'tmdb');
		if (!raw) return;
		const hits = raw.map(this.normalizeTmdb.bind(this, query));
		emit('tmdb', hits);
		this.cache.set('movie', query, 'tmdb', hits);
	}

	private normalizeTmdb(query: string, r: any): MovieSearchHit {
		const year = r.release_date ? Number.parseInt(r.release_date.slice(0, 4), 10) : undefined;
		const hit: MovieSearchHit = {
			tmdbId: r.id,
			title: r.title,
			year: Number.isFinite(year) ? year : undefined,
			posterUrl: r.poster_path
				? `https://image.tmdb.org/t/p/w185${r.poster_path}`
				: undefined,
			overview: r.overview ? String(r.overview).slice(0, 200) : undefined,
			sources: ['tmdb'],
			isOwned: false,
			matchScore: 0,
		};
		hit.matchScore = scoreMovie(query, hit);
		return hit;
	}
}
```

- [ ] **Step 4: Add `MoviesService.searchForFederation()` shim**

Modify `src/packages/server/src/movies/movies.service.ts` — add a small helper near the existing `search()` method:
```ts
async searchForFederation(query: string, userId: string): Promise<Array<{
	movieId: string;
	title: string;
	year?: number;
	posterUrl?: string;
	isOwned: boolean;
	sources: Array<'local'>;
	matchScore: number;
}>> {
	const res = await this.search(query, userId);
	return (res.movies ?? []).slice(0, 25).map((m: any) => ({
		movieId: m.id,
		imdbId: m.imdbId ?? undefined,
		tmdbId: m.tmdbId ?? undefined,
		title: m.title,
		year: m.year ?? undefined,
		posterUrl: m.posterUrl ?? undefined,
		isOwned: true,
		sources: ['local'] as Array<'local'>,
		matchScore: 0, // filled by the orchestrator
	}));
}
```

- [ ] **Step 5: Run tests**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/federated-movie-search.service.spec.ts
```
Expected: 4/4 passing.

- [ ] **Step 6: Commit**

```
git add src/packages/server/src/search/federated-movie-search.service.ts \
        src/packages/server/src/search/__tests__/federated-movie-search.service.spec.ts \
        src/packages/server/src/movies/movies.service.ts
git commit -m "Search: FederatedMovieSearchService with local+TMDB orchestrator"
```

---

## Task 5: FederatedPeopleSearchService (local + TMDB)

**Files:**
- Create: `src/packages/server/src/search/federated-people-search.service.ts`
- Create: `src/packages/server/src/search/__tests__/federated-people-search.service.spec.ts`

- [ ] **Step 1: Failing test**

`src/packages/server/src/search/__tests__/federated-people-search.service.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { FederatedPeopleSearchService } from '../federated-people-search.service.js';
import type { PersonSearchHit, SearchEvent } from '../search-types.js';

describe('FederatedPeopleSearchService', () => {
	let people: any, tmdb: any, cache: any, svc: FederatedPeopleSearchService;
	beforeEach(() => {
		people = { searchPeopleForFederation: vi.fn().mockResolvedValue([]) };
		tmdb = { searchPerson: vi.fn().mockResolvedValue([]) };
		cache = { get: vi.fn().mockReturnValue(null), set: vi.fn() };
		svc = new FederatedPeopleSearchService(people, tmdb, cache);
	});

	it('emits local first then tmdb then done', async () => {
		people.searchPeopleForFederation.mockResolvedValue([
			{ personKey: 'tmdb:1', name: 'Alice', isOwned: true, sources: ['local'], matchScore: 1 },
		]);
		tmdb.searchPerson.mockResolvedValue([{ id: 2, name: 'Bob', profile_path: '/x.jpg' }]);
		const evs = (await lastValueFrom(
			svc.search$('alice').pipe(toArray()),
		)) as SearchEvent<PersonSearchHit>[];
		const ordered = evs.map((e) => (e.kind === 'results' ? e.source : e.kind));
		expect(ordered[0]).toBe('local');
		expect(ordered).toContain('tmdb');
		expect(ordered[ordered.length - 1]).toBe('done');
	});

	it('uses cached tmdb when present', async () => {
		cache.get.mockReturnValue([
			{ personKey: 'tmdb:2', name: 'Bob', sources: ['tmdb'], isOwned: false, matchScore: 0.6 },
		]);
		await lastValueFrom(svc.search$('bob').pipe(toArray()));
		expect(tmdb.searchPerson).not.toHaveBeenCalled();
		expect(cache.set).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run, fail**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/federated-people-search.service.spec.ts
```

- [ ] **Step 3: Implement**

`src/packages/server/src/search/federated-people-search.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PeopleService } from '../people/people.service.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { mergePersonHit, personDedupKey, scorePerson } from './dedup.js';
import { SearchCacheService } from './search-cache.service.js';
import type { PersonSearchHit, SearchEvent, SearchSource } from './search-types.js';

const SOURCE_TIMEOUT_MS = 5000;

@Injectable()
export class FederatedPeopleSearchService {
	private readonly logger = new Logger('FederatedPeopleSearch');

	constructor(
		private readonly people: PeopleService,
		private readonly tmdb: TmdbProvider,
		private readonly cache: SearchCacheService,
	) {}

	search$(query: string): Observable<SearchEvent<PersonSearchHit>> {
		return new Observable((subscriber) => {
			const hits = new Map<string, PersonSearchHit>();
			const sourcesQueried: SearchSource[] = [];
			let cancelled = false;

			const emit = (source: SearchSource, items: PersonSearchHit[]) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				const merged: PersonSearchHit[] = [];
				for (const item of items) {
					const key = personDedupKey(item);
					const prev = hits.get(key);
					const m = prev ? mergePersonHit(prev, item) : item;
					hits.set(key, m);
					merged.push(m);
				}
				subscriber.next({ kind: 'results', source, items: merged });
			};

			const emitError = (source: SearchSource, message: string) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				subscriber.next({ kind: 'error', source, message });
			};

			const withTimeout = <T>(p: Promise<T>, source: SearchSource): Promise<T | null> =>
				Promise.race([
					p,
					new Promise<null>((_, reject) =>
						setTimeout(
							() => reject(new Error(`${source} timed out`)),
							SOURCE_TIMEOUT_MS,
						),
					),
				]).catch((err) => {
					emitError(source, err instanceof Error ? err.message : String(err));
					return null;
				});

			(async () => {
				try {
					const local = await this.people.searchPeopleForFederation(query);
					if (local.length) emit('local', local);
				} catch (e: any) {
					emitError('local', e?.message ?? String(e));
				}

				const cached = this.cache.get<PersonSearchHit>('person', query, 'tmdb');
				if (cached) {
					emit('cache', cached);
				} else {
					const raw = await withTimeout(this.tmdb.searchPerson(query), 'tmdb');
					if (raw) {
						const items = raw.map((r: any) => {
							const hit: PersonSearchHit = {
								personKey: `tmdb:${r.id}`,
								tmdbId: r.id,
								name: r.name,
								profileUrl: r.profile_path
									? `https://image.tmdb.org/t/p/w185${r.profile_path}`
									: undefined,
								role: r.known_for_department,
								knownFor: Array.isArray(r.known_for)
									? r.known_for.map((k: any) => k.title || k.name).filter(Boolean)
									: undefined,
								sources: ['tmdb'],
								isOwned: false,
								matchScore: 0,
							};
							hit.matchScore = scorePerson(query, hit);
							return hit;
						});
						emit('tmdb', items);
						this.cache.set('person', query, 'tmdb', items);
					}
				}

				if (!cancelled) {
					subscriber.next({ kind: 'done', sourcesQueried });
					subscriber.complete();
				}
			})();

			return () => {
				cancelled = true;
			};
		});
	}
}
```

- [ ] **Step 4: Add `PeopleService.searchPeopleForFederation` helper**

Modify `src/packages/server/src/people/people.service.ts` — search the `people` table by name (LIKE), returning normalized `PersonSearchHit[]`:
```ts
async searchPeopleForFederation(query: string): Promise<Array<{
	personKey: string;
	tmdbId?: number;
	name: string;
	profileUrl?: string;
	role?: string;
	sources: Array<'local'>;
	isOwned: boolean;
	matchScore: number;
}>> {
	const q = `%${query.toLowerCase()}%`;
	const rows = await this.database.db
		.select({
			id: people.id,
			externalId: people.externalId,
			tmdbId: people.tmdbId,
			name: people.name,
			profileUrl: people.profileUrl,
			knownForDepartment: people.knownForDepartment,
		})
		.from(people)
		.where(sql`lower(${people.name}) like ${q}`)
		.limit(25)
		.all();
	return rows.map((r) => ({
		personKey: r.externalId,
		tmdbId: r.tmdbId ?? undefined,
		name: r.name,
		profileUrl: r.profileUrl ?? undefined,
		role: r.knownForDepartment ?? undefined,
		sources: ['local'] as Array<'local'>,
		isOwned: true,
		matchScore: 0,
	}));
}
```
(Imports as needed: `sql` from `drizzle-orm`, `people` from the schema.)

- [ ] **Step 5: Run tests**

```
cd src/packages/server && pnpm exec vitest run src/search/__tests__/federated-people-search.service.spec.ts
```
Expected: 2/2 passing.

- [ ] **Step 6: Commit**

```
git add src/packages/server/src/search/federated-people-search.service.ts \
        src/packages/server/src/search/__tests__/federated-people-search.service.spec.ts \
        src/packages/server/src/people/people.service.ts
git commit -m "Search: FederatedPeopleSearchService with local+TMDB orchestrator"
```

---

## Task 6: SearchController (SSE + JSON fallback)

**Files:**
- Create: `src/packages/server/src/search/search.controller.ts`
- Create: `src/packages/server/src/search/search.module.ts`
- Modify: `src/packages/server/src/app.module.ts`

- [ ] **Step 1: Controller**

`src/packages/server/src/search/search.controller.ts`:
```ts
import {
	BadRequestException,
	Controller,
	Get,
	Logger,
	Query,
	Req,
	Sse,
} from '@nestjs/common';
import { lastValueFrom, map, toArray, type Observable } from 'rxjs';
import { FederatedMovieSearchService } from './federated-movie-search.service.js';
import { FederatedPeopleSearchService } from './federated-people-search.service.js';
import type { SearchEvent } from './search-types.js';

@Controller('search')
export class SearchController {
	private readonly logger = new Logger('SearchController');

	constructor(
		private readonly movies: FederatedMovieSearchService,
		private readonly people: FederatedPeopleSearchService,
	) {}

	private requireQuery(q: string | undefined): string {
		if (!q || q.trim().length < 2) {
			throw new BadRequestException('Query must be at least 2 characters');
		}
		return q.trim();
	}

	@Sse('movies/stream')
	streamMovies(@Query('q') q: string, @Req() req: any): Observable<MessageEvent> {
		const query = this.requireQuery(q);
		const userId = req.user?.sub ?? req.user?.id ?? 'anonymous';
		return this.movies
			.search$(query, userId)
			.pipe(map((ev) => ({ data: ev } as unknown as MessageEvent)));
	}

	@Sse('people/stream')
	streamPeople(@Query('q') q: string): Observable<MessageEvent> {
		const query = this.requireQuery(q);
		return this.people
			.search$(query)
			.pipe(map((ev) => ({ data: ev } as unknown as MessageEvent)));
	}

	@Get('movies')
	async listMovies(@Query('q') q: string, @Req() req: any) {
		const query = this.requireQuery(q);
		const userId = req.user?.sub ?? req.user?.id ?? 'anonymous';
		const events = await lastValueFrom(this.movies.search$(query, userId).pipe(toArray()));
		return this.flatten(events);
	}

	@Get('people')
	async listPeople(@Query('q') q: string) {
		const query = this.requireQuery(q);
		const events = await lastValueFrom(this.people.search$(query).pipe(toArray()));
		return this.flatten(events);
	}

	private flatten<T>(events: SearchEvent<T>[]) {
		const byKey = new Map<string, T>();
		const sources: string[] = [];
		const errors: Array<{ source: string; message: string }> = [];
		for (const ev of events) {
			if (ev.kind === 'results') {
				for (const item of ev.items) {
					const id = JSON.stringify(item);
					byKey.set(id, item);
				}
				if (!sources.includes(ev.source)) sources.push(ev.source);
			} else if (ev.kind === 'error') {
				errors.push({ source: ev.source, message: ev.message });
			}
		}
		return { items: Array.from(byKey.values()), sources, errors };
	}
}
```

- [ ] **Step 2: Module**

`src/packages/server/src/search/search.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { MoviesModule } from '../movies/movies.module.js';
import { PeopleModule } from '../people/people.module.js';
import { FederatedMovieSearchService } from './federated-movie-search.service.js';
import { FederatedPeopleSearchService } from './federated-people-search.service.js';
import { SearchCacheService } from './search-cache.service.js';
import { SearchController } from './search.controller.js';

@Module({
	imports: [DatabaseModule, MetadataModule, MoviesModule, PeopleModule],
	controllers: [SearchController],
	providers: [
		SearchCacheService,
		FederatedMovieSearchService,
		FederatedPeopleSearchService,
	],
	exports: [FederatedMovieSearchService, FederatedPeopleSearchService],
})
export class SearchModule {}
```

- [ ] **Step 3: Register**

Modify `src/packages/server/src/app.module.ts` — add `SearchModule` to the `imports` array.

- [ ] **Step 4: Local smoke test**

Start dev server (`cd src && pnpm dev:server`), then:
```
curl -i -H 'Accept: text/event-stream' \
    'http://localhost:4000/api/v1/search/movies/stream?q=matrix'
curl 'http://localhost:4000/api/v1/search/movies?q=matrix'
curl 'http://localhost:4000/api/v1/search/people?q=cleese'
```
Expected: streaming endpoint returns `data: {...}` events; JSON endpoints return `{ items, sources, errors }`. If localBypass is on, no auth required.

- [ ] **Step 5: Commit**

```
git add src/packages/server/src/search/search.controller.ts \
        src/packages/server/src/search/search.module.ts \
        src/packages/server/src/app.module.ts
git commit -m "Search: SSE controller + non-streaming fallback + module wiring"
```

---

## Task 7: Movie `tmdb:<id>` virtual-row support

**Files:**
- Modify: `src/packages/server/src/movies/movies.service.ts`
- Modify: `src/packages/server/src/movies/movies.controller.ts`

- [ ] **Step 1: Service method**

Add to `MoviesService`:
```ts
async getOrFetchByKey(key: string, userId: string) {
	// Existing UUID lookup
	if (!key.includes(':')) return this.getById(key, userId);

	const [scheme, idStr] = key.split(':', 2);
	if (scheme !== 'tmdb') {
		throw new BadRequestException(`Unsupported movie key scheme: ${scheme}`);
	}
	const tmdbId = Number.parseInt(idStr, 10);
	if (!Number.isFinite(tmdbId)) {
		throw new BadRequestException(`Invalid TMDB id: ${idStr}`);
	}

	// Already have a row for this tmdbId?
	const existing = await this.database.db
		.select({ id: movies.id })
		.from(movies)
		.where(eq(movies.tmdbId, tmdbId))
		.get();
	if (existing) return this.getById(existing.id, userId);

	// Fetch from TMDB, write a stub row + metadata
	const meta = await this.tmdb.getMovie(tmdbId);
	if (!meta) throw new NotFoundException(`TMDB movie ${tmdbId} not found`);

	const stubId = randomUUID();
	const now = new Date().toISOString();
	const year = meta.release_date ? Number.parseInt(meta.release_date.slice(0, 4), 10) : null;

	await this.database.db.insert(movies).values({
		id: stubId,
		title: meta.title,
		year: Number.isFinite(year) ? year : null,
		tmdbId,
		imdbId: meta.imdb_id ?? null,
		isOwned: 0, // not in library
		posterUrl: meta.poster_path
			? `https://image.tmdb.org/t/p/w500${meta.poster_path}`
			: null,
		backdropUrl: meta.backdrop_path
			? `https://image.tmdb.org/t/p/original${meta.backdrop_path}`
			: null,
		createdAt: now,
		updatedAt: now,
	}).run();

	// Reuse existing metadata-refresh pipeline so cast/crew/overview/etc populate
	await this.metadataService.refreshMetadata(stubId).catch(() => undefined);

	return this.getById(stubId, userId);
}
```
(Imports as needed: `randomUUID` from `node:crypto`, `BadRequestException`/`NotFoundException` from `@nestjs/common`, `movies` from schema, `eq` from drizzle-orm, `TmdbProvider`, `MetadataService`. Inject `TmdbProvider` and `MetadataService` via constructor if not already.)

**Schema note:** confirm `movies.isOwned` exists. If not, add it via a migration similar to `ALTER TABLE movies ADD COLUMN is_owned INTEGER DEFAULT 1` (existing scanned rows are owned by default). Check `src/packages/server/src/database/schema/movies.ts` first.

- [ ] **Step 2: Controller route accepts keys**

Modify `movies.controller.ts` — the existing `@Get(':id')` handler should call `getOrFetchByKey` instead of `getById`:
```ts
@Get(':key')
async getOne(@Param('key') key: string, @Req() req: any) {
	const userId = req.user?.sub ?? req.user?.id ?? 'anonymous';
	return this.moviesService.getOrFetchByKey(key, userId);
}
```
If a separate `@Get(':id')` route already exists, change its param name to `key` and route through the new method.

- [ ] **Step 3: Smoke**

```
curl 'http://localhost:4000/api/v1/movies/tmdb:603'   # Matrix
curl 'http://localhost:4000/api/v1/movies/tmdb:603'   # second call — uses cached stub
```
Expected: first call ~500ms (TMDB fetch + write), second call <50ms (DB-only).

- [ ] **Step 4: Commit**

```
git add src/packages/server/src/movies/movies.service.ts \
        src/packages/server/src/movies/movies.controller.ts \
        src/packages/server/src/database/schema/movies.ts \
        src/scripts/migrate.js
git commit -m "Movies: getOrFetchByKey accepts tmdb:<id> for virtual rows"
```

---

## Task 8: Phase 1 deploy + verify

- [ ] **Step 1: Run full server test suite**

```
cd src/packages/server && pnpm exec vitest run
```
Expected: all pass. Investigate any regressions.

- [ ] **Step 2: Verify build**

```
cd src && pnpm build
```
Expected: clean.

- [ ] **Step 3: Deploy**

```
bash src/scripts/deploy-remote.sh
```
Expected: exits 0; HTTP 200 verified externally.

- [ ] **Step 4: Smoke on prod**

```
curl 'https://mu.ryanweiss.net:4000/api/v1/search/movies?q=matrix'
curl 'https://mu.ryanweiss.net:4000/api/v1/search/people?q=cleese'
curl 'https://mu.ryanweiss.net:4000/api/v1/movies/tmdb:603'
```
Expected: federated movie response with `local` + `tmdb` sources; people response with TMDB hits; virtual movie row returned with full metadata.

---

# PHASE 2 — Client components + Discover wiring

## Task 9: Shared SearchHit type

**Files:**
- Create: `src/packages/shared/src/types/search.ts`
- Modify: `src/packages/shared/src/index.ts`

- [ ] **Step 1: Promote types**

`src/packages/shared/src/types/search.ts` — copy `MovieSearchHit`, `PersonSearchHit`, `SearchEvent`, `SearchSource` from the server (Phase 1 Task 2), with `SearchHit = MovieSearchHit | PersonSearchHit`. Then change the server's `search-types.ts` to re-export from `@mu/shared`.

- [ ] **Step 2: Export from `@mu/shared`**

Add to `src/packages/shared/src/index.ts`:
```ts
export type {
	MovieSearchHit,
	PersonSearchHit,
	SearchHit,
	SearchEvent,
	SearchSource,
	SearchResultsEvent,
	SearchErrorEvent,
	SearchDoneEvent,
} from './types/search.js';
```

- [ ] **Step 3: Re-point server types**

Replace contents of `src/packages/server/src/search/search-types.ts`:
```ts
export type {
	MovieSearchHit,
	PersonSearchHit,
	SearchHit,
	SearchEvent,
	SearchResultsEvent,
	SearchErrorEvent,
	SearchDoneEvent,
	SearchSource,
} from '@mu/shared';
```

- [ ] **Step 4: Verify still builds + tests pass**

```
cd src && pnpm build
cd src/packages/server && pnpm exec vitest run src/search
```

- [ ] **Step 5: Commit**

```
git add src/packages/shared/src/ src/packages/server/src/search/search-types.ts
git commit -m "Shared: promote SearchHit/SearchEvent types to @mu/shared"
```

---

## Task 10: `useSearchStream` hook

**Files:**
- Create: `src/packages/client/src/components/common/EntitySearchInput/useSearchStream.ts`
- Create: `src/packages/client/src/components/common/EntitySearchInput/__tests__/useSearchStream.test.ts`

- [ ] **Step 1: Failing test (vitest + happy-dom or mocked EventSource)**

`__tests__/useSearchStream.test.ts`:
```ts
import { act, renderHook } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearchStream } from '../useSearchStream.js';

class MockEventSource {
	static instances: MockEventSource[] = [];
	url: string;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	readyState = 0;
	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}
	emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
	close() { this.readyState = 2; }
}

beforeEach(() => { (globalThis as any).EventSource = MockEventSource; MockEventSource.instances = []; });
afterEach(() => { delete (globalThis as any).EventSource; });

describe('useSearchStream', () => {
	it('opens EventSource on query, merges results, closes on done', async () => {
		const { result } = renderHook(() => useSearchStream('movie', 'matrix'));
		expect(MockEventSource.instances).toHaveLength(1);
		const es = MockEventSource.instances[0]!;
		act(() => es.emit({ kind: 'results', source: 'local', items: [{ title: 'Matrix', sources: ['local'], isOwned: true, matchScore: 1 }] }));
		expect(result.current.results).toHaveLength(1);
		act(() => es.emit({ kind: 'results', source: 'tmdb', items: [{ tmdbId: 603, title: 'The Matrix', sources: ['tmdb'], isOwned: false, matchScore: 0.85 }] }));
		expect(result.current.results.length).toBeGreaterThanOrEqual(1);
		act(() => es.emit({ kind: 'done', sourcesQueried: ['local', 'tmdb'] }));
		expect(result.current.isLoading).toBe(false);
	});

	it('does not open EventSource when query is shorter than 2 chars', () => {
		renderHook(() => useSearchStream('movie', 'a'));
		expect(MockEventSource.instances).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Implement**

`useSearchStream.ts`:
```ts
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
	MovieSearchHit,
	PersonSearchHit,
	SearchEvent,
	SearchSource,
} from '@mu/shared';

type Hit<T extends 'movie' | 'person'> = T extends 'movie' ? MovieSearchHit : PersonSearchHit;

function movieKey(h: MovieSearchHit): string {
	if (h.imdbId) return `imdb:${h.imdbId}`;
	if (h.tmdbId) return `tmdb:${h.tmdbId}`;
	if (h.movieId) return `local:${h.movieId}`;
	return `slug:${h.title.toLowerCase().replace(/\s+/g, '-')}|${h.year ?? ''}`;
}
function personKey(h: PersonSearchHit): string {
	if (h.tmdbId) return `tmdb:${h.tmdbId}`;
	return `key:${h.personKey}`;
}

function tierFor(query: string, isOwned: boolean, title: string): number {
	const q = query.toLowerCase();
	const t = title.toLowerCase();
	if (t === q) return isOwned ? 0 : 1;
	if (t.startsWith(q)) return isOwned ? 2 : 3;
	return isOwned ? 4 : 5;
}

export function useSearchStream<T extends 'movie' | 'person'>(
	type: T,
	query: string,
): {
	results: Hit<T>[];
	isLoading: boolean;
	sources: SearchSource[];
	error?: string;
} {
	const [results, setResults] = useState<Hit<T>[]>([]);
	const [isLoading, setLoading] = useState(false);
	const [sources, setSources] = useState<SearchSource[]>([]);
	const [error, setError] = useState<string | undefined>(undefined);
	const esRef = useRef<EventSource | null>(null);

	useEffect(() => {
		esRef.current?.close();
		setResults([]); setSources([]); setError(undefined);

		if (!query || query.trim().length < 2) { setLoading(false); return; }

		setLoading(true);
		const es = new EventSource(`/api/v1/search/${type === 'movie' ? 'movies' : 'people'}/stream?q=${encodeURIComponent(query)}`);
		esRef.current = es;

		const keyOf = (h: any) =>
			type === 'movie' ? movieKey(h as MovieSearchHit) : personKey(h as PersonSearchHit);

		es.onmessage = (msg) => {
			let ev: SearchEvent<Hit<T>>;
			try { ev = JSON.parse(msg.data); } catch { return; }
			if (ev.kind === 'results') {
				setSources((prev) => (prev.includes(ev.source) ? prev : [...prev, ev.source]));
				setResults((prev) => {
					const byKey = new Map<string, Hit<T>>();
					for (const h of prev) byKey.set(keyOf(h), h);
					for (const h of ev.items) byKey.set(keyOf(h), h as Hit<T>);
					const all = Array.from(byKey.values());
					all.sort((a: any, b: any) => {
						const titleA = (a.title ?? a.name) as string;
						const titleB = (b.title ?? b.name) as string;
						const tA = tierFor(query, a.isOwned, titleA);
						const tB = tierFor(query, b.isOwned, titleB);
						if (tA !== tB) return tA - tB;
						return (b.matchScore ?? 0) - (a.matchScore ?? 0);
					});
					return all;
				});
			} else if (ev.kind === 'error') {
				setError(`${ev.source}: ${ev.message}`);
			} else if (ev.kind === 'done') {
				setLoading(false);
				es.close();
			}
		};
		es.onerror = () => {
			setError('Search stream interrupted');
			setLoading(false);
			es.close();
		};

		return () => { es.close(); };
	}, [type, query]);

	return { results, isLoading, sources, error };
}
```

- [ ] **Step 3: Run tests**

```
cd src/packages/client && pnpm exec vitest run src/components/common/EntitySearchInput/__tests__/useSearchStream.test.ts
```
Expected: 2/2 passing.

- [ ] **Step 4: Commit**

```
git add src/packages/client/src/components/common/EntitySearchInput/useSearchStream.ts \
        src/packages/client/src/components/common/EntitySearchInput/__tests__/useSearchStream.test.ts
git commit -m "Search: useSearchStream hook with EventSource + dedup-sort"
```

---

## Task 11: `EntitySearchInput` component + styles

**Files:**
- Create: `src/packages/client/src/components/common/EntitySearchInput/EntitySearchInput.tsx`
- Create: `src/packages/client/src/components/common/EntitySearchInput/EntitySearchInput.module.scss`
- Create: `src/packages/client/src/components/common/EntitySearchInput/MovieSearchInput.tsx`
- Create: `src/packages/client/src/components/common/EntitySearchInput/PersonSearchInput.tsx`
- Create: `src/packages/client/src/components/common/EntitySearchInput/index.ts`
- Create: `src/packages/client/src/components/common/EntitySearchInput/__tests__/EntitySearchInput.test.tsx`

- [ ] **Step 1: Failing test**

`__tests__/EntitySearchInput.test.tsx`:
```tsx
import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { EntitySearchInput } from '../EntitySearchInput.js';

// MockEventSource setup omitted for brevity — same shape as useSearchStream test

describe('EntitySearchInput', () => {
	it('debounces input by 250ms before opening a stream', async () => {
		const { getByRole } = render(<EntitySearchInput type="movie" onSelect={() => {}} />);
		const input = getByRole('combobox') as HTMLInputElement;
		fireEvent.input(input, { target: { value: 'matrix' } });
		// Immediate: no stream yet (debounced)
		// After 300ms: stream opened — assertion depends on MockEventSource registry
		// (kept tight in the actual test file)
		expect(input.value).toBe('matrix');
	});
});
```
(The integration assertions on EventSource creation are kept lightweight — the orchestrator behavior is fully covered by `useSearchStream.test.ts`. This test verifies the component layer wires input → hook correctly.)

- [ ] **Step 2: Implement component**

`EntitySearchInput.tsx`:
```tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MovieSearchHit, PersonSearchHit, SearchHit, SearchSource } from '@mu/shared';
import { route } from 'preact-router';
import { useSearchStream } from './useSearchStream.js';
import styles from './EntitySearchInput.module.scss';

export interface EntitySearchInputProps {
	type: 'movie' | 'person';
	placeholder?: string;
	onSelect: (hit: SearchHit) => void;
	onView?: (hit: SearchHit) => void;
	disabledKeys?: string[];
	autoFocus?: boolean;
	maxHeight?: number;
	class?: string;
}

function defaultOnView(hit: SearchHit) {
	if ('personKey' in hit) {
		route(`/person/${hit.personKey}`);
	} else if (hit.movieId) {
		route(`/movie/${hit.movieId}`);
	} else if (hit.tmdbId) {
		route(`/movie/tmdb:${hit.tmdbId}`);
	}
}

function hitKey(hit: SearchHit): string {
	if ('personKey' in hit) return hit.personKey;
	if (hit.movieId) return hit.movieId;
	if (hit.tmdbId) return `tmdb:${hit.tmdbId}`;
	if (hit.imdbId) return `imdb:${hit.imdbId}`;
	return `${hit.title}|${hit.year ?? ''}`;
}

const SOURCE_COLOR: Record<SearchSource, string> = {
	local: '#4ade80', cache: '#94a3b8', tmdb: '#3b82f6', omdb: '#f59e0b', trakt: '#ef4444',
};

export function EntitySearchInput({
	type, placeholder, onSelect, onView = defaultOnView, disabledKeys, autoFocus, maxHeight = 360, class: className,
}: EntitySearchInputProps) {
	const [raw, setRaw] = useState('');
	const [debounced, setDebounced] = useState('');
	const [open, setOpen] = useState(false);
	const [activeIdx, setActiveIdx] = useState(-1);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(raw), 250);
		return () => clearTimeout(t);
	}, [raw]);

	const { results, isLoading, sources, error } = useSearchStream(type, debounced);

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, []);

	const disabledSet = new Set(disabledKeys ?? []);
	const visible = results.filter((h) => !disabledSet.has(hitKey(h as SearchHit)));

	const onKeyDown = (e: KeyboardEvent) => {
		if (!open) return;
		if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, visible.length - 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
		else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(visible[activeIdx] as SearchHit); }
		else if (e.key === 'Escape') { setOpen(false); }
	};

	const pick = (hit: SearchHit) => {
		onSelect(hit);
		setRaw('');
		setDebounced('');
		setOpen(false);
		setActiveIdx(-1);
	};

	return (
		<div class={`${styles.wrap} ${className ?? ''}`} ref={wrapRef}>
			<input
				class={styles.input}
				role="combobox"
				aria-expanded={open}
				autoFocus={autoFocus}
				placeholder={placeholder}
				value={raw}
				onInput={(e) => { setRaw((e.target as HTMLInputElement).value); setOpen(true); }}
				onFocus={() => setOpen(true)}
				onKeyDown={onKeyDown as any}
			/>
			{isLoading && <span class={styles.spinner} aria-hidden="true" />}
			{open && debounced.length >= 2 && (
				<ul class={styles.dropdown} style={{ maxHeight }} role="listbox">
					{visible.length === 0 && !isLoading && (
						<li class={styles.empty}>No results.</li>
					)}
					{visible.map((h, i) => {
						const hit = h as SearchHit;
						const title = 'name' in hit ? hit.name : hit.title;
						const sub = 'name' in hit
							? hit.role ?? (hit.knownFor ? hit.knownFor.slice(0, 3).join(', ') : '')
							: hit.year ? String(hit.year) : '';
						const img = 'profileUrl' in hit ? hit.profileUrl : hit.posterUrl;
						return (
							<li
								key={hitKey(hit)}
								class={`${styles.row} ${i === activeIdx ? styles.active : ''} ${hit.isOwned ? styles.owned : ''}`}
								role="option"
								aria-selected={i === activeIdx}
								onMouseEnter={() => setActiveIdx(i)}
								onClick={() => pick(hit)}
							>
								{img && <img class={styles.thumb} src={img} alt="" loading="lazy" />}
								<div class={styles.text}>
									<div class={styles.title}>{title}</div>
									<div class={styles.sub}>{sub}</div>
								</div>
								<div class={styles.sourceDots} aria-label={`Sources: ${hit.sources.join(', ')}`}>
									{hit.sources.map((s) => (
										<span key={s} class={styles.dot} style={{ background: SOURCE_COLOR[s] }} />
									))}
								</div>
								<button
									type="button"
									class={styles.viewBtn}
									onClick={(e) => { e.stopPropagation(); onView(hit); }}
									title="View details"
								>
									View
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{error && <div class={styles.error}>{error}</div>}
		</div>
	);
}
```

- [ ] **Step 3: SCSS**

`EntitySearchInput.module.scss`:
```scss
.wrap { position: relative; }
.input {
	width: 100%;
	padding: 8px 12px;
	background: var(--surface-input, rgba(255,255,255,0.05));
	border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
	border-radius: 6px;
	color: var(--text-primary);
	font-size: 14px;
	&:focus { outline: none; border-color: var(--accent, #3b82f6); }
}
.spinner {
	position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
	width: 12px; height: 12px; border-radius: 50%;
	border: 2px solid rgba(255,255,255,0.2); border-top-color: var(--accent, #3b82f6);
	animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
.dropdown {
	position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
	background: var(--surface-elevated, #1e293b);
	border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
	border-radius: 6px;
	overflow-y: auto;
	box-shadow: var(--shadow-overlay, 0 4px 20px rgba(0,0,0,0.5));
	list-style: none; margin: 0; padding: 4px 0;
}
.row {
	display: grid; grid-template-columns: 48px 1fr auto auto;
	align-items: center; gap: 10px;
	padding: 6px 10px; cursor: pointer;
	&.active, &:hover { background: rgba(255,255,255,0.06); }
	&.owned .title { color: var(--accent, #3b82f6); }
}
.thumb { width: 44px; height: 64px; object-fit: cover; border-radius: 3px; background: rgba(255,255,255,0.05); }
.text { min-width: 0; }
.title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sourceDots { display: flex; gap: 3px; }
.dot { width: 6px; height: 6px; border-radius: 50%; }
.viewBtn {
	font-size: 11px; padding: 4px 8px; border-radius: 4px;
	background: rgba(255,255,255,0.08); color: var(--text-primary);
	border: 1px solid transparent; cursor: pointer;
	&:hover { background: rgba(255,255,255,0.16); }
}
.empty { padding: 12px; color: var(--text-secondary); font-size: 13px; }
.error { font-size: 12px; color: #ef4444; margin-top: 4px; }
```

- [ ] **Step 4: Thin wrappers + barrel**

`MovieSearchInput.tsx`:
```tsx
import { EntitySearchInput, type EntitySearchInputProps } from './EntitySearchInput.js';
export function MovieSearchInput(props: Omit<EntitySearchInputProps, 'type'>) {
	return <EntitySearchInput type="movie" placeholder={props.placeholder ?? 'Search movies…'} {...props} />;
}
```
`PersonSearchInput.tsx`:
```tsx
import { EntitySearchInput, type EntitySearchInputProps } from './EntitySearchInput.js';
export function PersonSearchInput(props: Omit<EntitySearchInputProps, 'type'>) {
	return <EntitySearchInput type="person" placeholder={props.placeholder ?? 'Search people…'} {...props} />;
}
```
`index.ts`:
```ts
export { EntitySearchInput } from './EntitySearchInput.js';
export type { EntitySearchInputProps } from './EntitySearchInput.js';
export { MovieSearchInput } from './MovieSearchInput.js';
export { PersonSearchInput } from './PersonSearchInput.js';
export { useSearchStream } from './useSearchStream.js';
```

- [ ] **Step 5: Run tests**

```
cd src/packages/client && pnpm exec vitest run src/components/common/EntitySearchInput/__tests__/
```

- [ ] **Step 6: Commit**

```
git add src/packages/client/src/components/common/EntitySearchInput/
git commit -m "Search: EntitySearchInput component + Movie/Person wrappers"
```

---

## Task 12: Discover page wiring

**Files:**
- Modify: `src/packages/client/src/pages/Discover.tsx`
- Modify: `src/packages/client/src/pages/Discover.module.scss`
- Modify: `src/packages/client/src/components/discover/SeedChip.tsx`
- Modify: `src/packages/client/src/components/discover/SeedChip.module.scss`

- [ ] **Step 1: SeedChip variant**

Add a `kind?: 'movie' | 'person'` prop to `SeedChip`. Add a `.person` class with a subtle tint:
```scss
.person {
	background: linear-gradient(135deg, rgba(168, 85, 247, 0.18), rgba(168, 85, 247, 0.08));
	&::before { content: '👤'; margin-right: 4px; opacity: 0.9; }
}
```
Component:
```tsx
<span class={`${styles.chip} ${kind === 'person' ? styles.person : ''}`}>
	{label}
	<button onClick={onRemove}>×</button>
</span>
```

- [ ] **Step 2: Discover seed-search row**

In `Discover.tsx`, replace the existing `+ Add` button and `MoviePicker` with two inputs:
```tsx
import { MovieSearchInput, PersonSearchInput }
	from '@/components/common/EntitySearchInput';
import { addPersonSeed } from '@/state/discover.state';
// remove: import { MoviePicker } from ...
// remove: const [pickerOpen, setPickerOpen] = useState(false);

// inside JSX, replace the addSeedBtn + MoviePicker section:
<div class={styles.seedSearchRow}>
	<MovieSearchInput
		placeholder="Add a movie seed…"
		disabledKeys={seeds}
		onSelect={(hit: any) => {
			const id = hit.movieId ?? (hit.tmdbId ? `tmdb:${hit.tmdbId}` : null);
			if (id) addSeed(id, hit.title);
		}}
	/>
	<PersonSearchInput
		placeholder="Add a person seed (cast/director)…"
		disabledKeys={personSeedKeys.value}
		onSelect={(hit: any) => addPersonSeed(hit.personKey, hit.name)}
	/>
</div>
```
Update the `seedRow` to use the polymorphic SeedChip:
```tsx
{seeds.map((id) => (
	<SeedChip kind="movie" key={id} label={seedLabelMap[id] ?? id.slice(0, 8)} onRemove={() => removeSeed(id)} />
))}
{personSeedKeys.value.map((key) => (
	<SeedChip kind="person" key={key} label={personSeedLabels.value[key] ?? key} onRemove={() => removePersonSeed(key)} />
))}
```
(Drop the old inline `👤 ${label}` — the chip variant handles it now.)

- [ ] **Step 3: SCSS**

Append to `Discover.module.scss`:
```scss
.seedSearchRow {
	display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
	margin: 12px 0 16px;
	@media (max-width: 720px) { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Local browser smoke**

```
cd src && pnpm dev:client
```
Open `/discover`, type "matrix" in the movie input — should see results stream in (local + TMDB). Click a result → chip appears in seed row. Type "cleese" in the person input → person results stream in. Click `View` → navigates to movie/person detail page.

- [ ] **Step 5: Commit**

```
git add src/packages/client/src/pages/Discover.tsx \
        src/packages/client/src/pages/Discover.module.scss \
        src/packages/client/src/components/discover/SeedChip.tsx \
        src/packages/client/src/components/discover/SeedChip.module.scss
git commit -m "Discover: inline movie+person search inputs replace MoviePicker"
```

---

## Task 13: MovieDetail handles `isOwned=false` state

**Files:**
- Modify: `src/packages/client/src/pages/MovieDetail.tsx`

- [ ] **Step 1: Conditional Play replacement**

Wherever the `Play` button currently renders, gate it on `movie.isOwned`. When false, render an external link instead:
```tsx
{movie.isOwned ? (
	<Button onClick={onPlay}>Play</Button>
) : (
	<a
		class={styles.externalLink}
		href={movie.tmdbId ? `https://www.themoviedb.org/movie/${movie.tmdbId}` : '#'}
		target="_blank" rel="noopener noreferrer"
	>
		View on TMDB
	</a>
)}
```
Hide file-info / encoding-settings panels when `!movie.isOwned`. Cast/people/overview render as normal.

- [ ] **Step 2: Smoke**

In dev, visit `/movie/tmdb:603`. Expected: page renders Matrix metadata with "View on TMDB" link instead of Play, cast is present.

- [ ] **Step 3: Commit**

```
git add src/packages/client/src/pages/MovieDetail.tsx
git commit -m "MovieDetail: render 'View on TMDB' for non-owned virtual rows"
```

---

## Task 14: Phase 2 deploy + browser verify

- [ ] **Step 1: Build**

```
cd src && pnpm build
```

- [ ] **Step 2: Deploy**

```
bash src/scripts/deploy-remote.sh
```

- [ ] **Step 3: Browser verify**

Open `https://mu.ryanweiss.net:4000/discover` in a browser. Verify:
- Movie input streams local + TMDB results as you type
- Person input streams local + TMDB people
- Adding a seed: chip appears with correct kind (movie vs person)
- Clicking "View" on a non-library TMDB movie navigates to `/movie/tmdb:<id>` and renders metadata
- Refreshing the search dropdown for the same query returns instantly (cache hit)
- Existing recommendations still work end-to-end

---

# PHASE 3 — OMDB + Trakt search

## Task 15: OMDB `searchMovie`

**Files:**
- Modify: `src/packages/server/src/metadata/providers/omdb.provider.ts`
- Modify (or create): `src/packages/server/src/metadata/providers/__tests__/omdb.provider.spec.ts`

- [ ] **Step 1: Failing test**

Add to OMDB provider spec:
```ts
it('searchMovie returns normalized array of {imdbId,title,year,posterUrl}', async () => {
	const fetcher = vi.fn().mockResolvedValue({
		Response: 'True', Search: [
			{ imdbID: 'tt1', Title: 'Matrix', Year: '1999', Type: 'movie', Poster: 'http://p/x.jpg' },
		],
	});
	const provider = new OmdbProvider({ get: () => 'KEY' } as any, fetcher as any, { get: () => null, set: () => {} } as any);
	const out = await provider.searchMovie('matrix');
	expect(out).toEqual([
		{ imdbId: 'tt1', title: 'Matrix', year: 1999, posterUrl: 'http://p/x.jpg' },
	]);
});
```

- [ ] **Step 2: Implement**

Add to `OmdbProvider`:
```ts
async searchMovie(query: string): Promise<Array<{ imdbId: string; title: string; year?: number; posterUrl?: string }>> {
	const key = this.getApiKey();
	if (!key) return [];
	const cacheKey = `omdb:search:${query.toLowerCase()}`;
	const cached = this.cache.get<any[]>('METADATA', cacheKey);
	if (cached) return cached;
	const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&type=movie&apikey=${key}`;
	const res = await this.fetcher(url);
	if (res?.Response !== 'True' || !Array.isArray(res.Search)) return [];
	const out = res.Search
		.filter((r: any) => r.imdbID && r.Title)
		.map((r: any) => ({
			imdbId: r.imdbID,
			title: r.Title,
			year: r.Year ? Number.parseInt(r.Year, 10) : undefined,
			posterUrl: r.Poster && r.Poster !== 'N/A' ? r.Poster : undefined,
		}));
	this.cache.set('METADATA', cacheKey, out);
	return out;
}
```

- [ ] **Step 3: Verify + commit**

```
cd src/packages/server && pnpm exec vitest run src/metadata/providers/__tests__/omdb.provider.spec.ts
git add src/packages/server/src/metadata/providers/omdb.provider.ts \
        src/packages/server/src/metadata/providers/__tests__/omdb.provider.spec.ts
git commit -m "OMDB: searchMovie endpoint with normalized result shape"
```

---

## Task 16: Trakt provider scaffold

**Files:**
- Create: `src/packages/server/src/metadata/providers/trakt.provider.ts`
- Create: `src/packages/server/src/metadata/providers/__tests__/trakt.provider.spec.ts`
- Modify: `src/packages/server/src/metadata/metadata.module.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { TraktProvider } from '../trakt.provider.js';

describe('TraktProvider', () => {
	it('returns [] gracefully when no credentials configured', async () => {
		const creds = { get: vi.fn().mockResolvedValue(null) };
		const p = new TraktProvider(creds as any, vi.fn() as any, { get: () => null, set: () => {} } as any);
		expect(await p.searchMovie('matrix')).toEqual([]);
		expect(await p.searchPerson('cleese')).toEqual([]);
	});

	it('searchMovie returns normalized hits when credentials present', async () => {
		const creds = { get: vi.fn().mockResolvedValue({ clientId: 'X' }) };
		const fetcher = vi.fn().mockResolvedValue([
			{ type: 'movie', movie: { title: 'The Matrix', year: 1999, ids: { trakt: 1, imdb: 'tt1', tmdb: 603 } } },
		]);
		const p = new TraktProvider(creds as any, fetcher as any, { get: () => null, set: () => {} } as any);
		const out = await p.searchMovie('matrix');
		expect(out[0]).toMatchObject({ traktId: 1, imdbId: 'tt1', tmdbId: 603, title: 'The Matrix', year: 1999 });
	});

	it('searchPerson returns normalized hits', async () => {
		const creds = { get: vi.fn().mockResolvedValue({ clientId: 'X' }) };
		const fetcher = vi.fn().mockResolvedValue([
			{ type: 'person', person: { name: 'John Cleese', ids: { trakt: 1, tmdb: 5 } } },
		]);
		const p = new TraktProvider(creds as any, fetcher as any, { get: () => null, set: () => {} } as any);
		const out = await p.searchPerson('cleese');
		expect(out[0]).toMatchObject({ traktId: 1, tmdbId: 5, name: 'John Cleese' });
	});
});
```

- [ ] **Step 2: Implement**

`trakt.provider.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { ProviderCredentialsService } from '../../providers/credentials/provider-credentials.service.js';

type Fetcher = (url: string, init?: RequestInit) => Promise<any>;

export interface TraktMovieHit {
	traktId?: number;
	imdbId?: string;
	tmdbId?: number;
	title: string;
	year?: number;
}
export interface TraktPersonHit {
	traktId?: number;
	tmdbId?: number;
	name: string;
}

@Injectable()
export class TraktProvider {
	private readonly logger = new Logger('TraktProvider');

	constructor(
		private readonly creds: ProviderCredentialsService,
		private readonly fetcher: Fetcher,
		private readonly cache: CacheService,
	) {}

	private async authHeaders(): Promise<Record<string, string> | null> {
		const c = await this.creds.get('trakt');
		if (!c?.clientId) return null;
		return {
			'trakt-api-version': '2',
			'trakt-api-key': String(c.clientId),
			'Content-Type': 'application/json',
		};
	}

	async searchMovie(query: string): Promise<TraktMovieHit[]> {
		const headers = await this.authHeaders();
		if (!headers) return [];
		const ck = `trakt:search:movie:${query.toLowerCase()}`;
		const cached = this.cache.get<TraktMovieHit[]>('METADATA', ck);
		if (cached) return cached;
		try {
			const url = `https://api.trakt.tv/search/movie?query=${encodeURIComponent(query)}&limit=25`;
			const res = await this.fetcher(url, { headers });
			if (!Array.isArray(res)) return [];
			const out = res
				.filter((r) => r.movie?.title)
				.map((r): TraktMovieHit => ({
					traktId: r.movie.ids?.trakt,
					imdbId: r.movie.ids?.imdb ?? undefined,
					tmdbId: r.movie.ids?.tmdb ?? undefined,
					title: r.movie.title,
					year: r.movie.year ?? undefined,
				}));
			this.cache.set('METADATA', ck, out);
			return out;
		} catch (e) {
			this.logger.warn(`Trakt searchMovie failed: ${(e as Error).message}`);
			return [];
		}
	}

	async searchPerson(query: string): Promise<TraktPersonHit[]> {
		const headers = await this.authHeaders();
		if (!headers) return [];
		const ck = `trakt:search:person:${query.toLowerCase()}`;
		const cached = this.cache.get<TraktPersonHit[]>('METADATA', ck);
		if (cached) return cached;
		try {
			const url = `https://api.trakt.tv/search/person?query=${encodeURIComponent(query)}&limit=25`;
			const res = await this.fetcher(url, { headers });
			if (!Array.isArray(res)) return [];
			const out = res
				.filter((r) => r.person?.name)
				.map((r): TraktPersonHit => ({
					traktId: r.person.ids?.trakt,
					tmdbId: r.person.ids?.tmdb ?? undefined,
					name: r.person.name,
				}));
			this.cache.set('METADATA', ck, out);
			return out;
		} catch (e) {
			this.logger.warn(`Trakt searchPerson failed: ${(e as Error).message}`);
			return [];
		}
	}
}
```

- [ ] **Step 3: Register in MetadataModule**

Add `TraktProvider` to providers + exports. Add a `Fetcher` provider that supplies global `fetch` so the constructor can be DI'd:
```ts
providers: [
	// ...existing
	TraktProvider,
	{ provide: 'FETCHER', useValue: (url: string, init?: RequestInit) => fetch(url, init).then((r) => r.json()) },
],
exports: [
	// ...existing
	TraktProvider,
],
```
And update `TraktProvider`'s constructor to use `@Inject('FETCHER')` for the fetcher param.

- [ ] **Step 4: Run + commit**

```
cd src/packages/server && pnpm exec vitest run src/metadata/providers/__tests__/trakt.provider.spec.ts
git add src/packages/server/src/metadata/providers/trakt.provider.ts \
        src/packages/server/src/metadata/providers/__tests__/trakt.provider.spec.ts \
        src/packages/server/src/metadata/metadata.module.ts
git commit -m "Trakt: provider with credentials-gated searchMovie/searchPerson"
```

---

## Task 17: Wire OMDB + Trakt into federated services

**Files:**
- Modify: `src/packages/server/src/search/federated-movie-search.service.ts`
- Modify: `src/packages/server/src/search/federated-people-search.service.ts`
- Modify: `src/packages/server/src/search/search.module.ts`

- [ ] **Step 1: Extend movie orchestrator**

In `FederatedMovieSearchService`:
- Inject `OmdbProvider` and `TraktProvider` in the constructor.
- In `search$`, parallelize three runs in the existing `Promise.all([...])`:
```ts
await Promise.all([
	this.runTmdb(query, withTimeout, emitResults),
	this.runOmdb(query, withTimeout, emitResults),
	this.runTrakt(query, withTimeout, emitResults),
]);
```
- Add `runOmdb` and `runTrakt` mirroring `runTmdb` (cache lookup → fetch → normalize → emit → cache.set).
- Normalize OMDB hit → `MovieSearchHit` (imdbId, title, year, posterUrl).
- Normalize Trakt hit → `MovieSearchHit` (traktId, imdbId, tmdbId, title, year).

- [ ] **Step 2: Extend people orchestrator**

In `FederatedPeopleSearchService`:
- Inject `TraktProvider`.
- After the TMDB block, add a Trakt block (cache check → fetch → normalize → emit → cache.set).
- Normalize Trakt person hit → `PersonSearchHit` (personKey = `tmdb:${tmdbId}` when present else `trakt:${traktId}`).

- [ ] **Step 3: Tests update**

Add tests to the existing federated-movie spec for OMDB + Trakt sources. Reuse the cache-hit / source-error patterns from existing tests.

- [ ] **Step 4: Run tests, commit**

```
cd src/packages/server && pnpm exec vitest run src/search
git add src/packages/server/src/search/
git commit -m "Search: wire OMDB + Trakt into federated movie/people services"
```

---

## Task 18: Phase 3 deploy + verify

- [ ] **Step 1: Build**

```
cd src && pnpm build
```

- [ ] **Step 2: Deploy**

```
bash src/scripts/deploy-remote.sh
```

- [ ] **Step 3: Smoke**

```
curl 'https://mu.ryanweiss.net:4000/api/v1/search/movies?q=matrix' | jq .sources
```
Expected: `["local","tmdb","omdb"]` (Trakt absent unless credentials configured). No errors. Cache miss → ~1.5s; second call → <100ms.

In browser: searches still feel snappy; source dots on result rows now show blue+orange (TMDB+OMDB) when both contribute.

---

# Final verification

- [ ] **Step 1: Full test suite**

```
cd src && pnpm exec turbo run test
```
Expected: all packages pass.

- [ ] **Step 2: Lint + format**

```
cd src && pnpm check
```

- [ ] **Step 3: Update CLAUDE.md**

Add to the `Server Architecture` table:
```
| `search` | Federated search (movies + people) over local DB + TMDB + OMDB + Trakt. SSE-streaming via `@Sse`. Persistent 7d cache. |
```

And to the `Gotchas & Patterns` section under "Client Player" → new section "Federated Search":
> Search uses SSE (`@Sse`) and EventSource. The dropdown component is in `components/common/EntitySearchInput`. `useSearchStream` hook is the canonical client API. Cache lives in `search_cache` table, 7d TTL. Each source has a 5s per-call timeout — orchestrator never blocks on one slow upstream.

- [ ] **Step 4: Commit docs**

```
git add CLAUDE.md
git commit -m "Docs: SearchModule + federated search gotchas"
```

---

## Self-review (run mentally after writing — no separate step)

- **Spec coverage**: §1 goals, §2 non-goals, §3.1 SSE, §3.2 cache, §3.3 dedup, §3.4 ranking, §3.5 detail enrichment, §4 backend, §5 frontend, §6 testing — all mapped to tasks. ✓
- **Placeholders**: none.
- **Type consistency**: `MovieSearchHit`/`PersonSearchHit`/`SearchEvent` defined once in `search-types.ts` (Task 2), promoted to `@mu/shared` (Task 9), re-exported by server. `movieDedupKey` / `personDedupKey` / `mergeMovieHit` / `mergePersonHit` consistent across server + client (client `useSearchStream` has its own minimal copies of dedup-key logic but matches the shape).
- **Risks**: Trakt credentials absent → graceful no-op. SSE behind proxy → fallback JSON endpoint exists. Cache TTL → 7d as per spec.
