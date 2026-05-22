# Inline Federated Search — Design

**Date:** 2026-05-21
**Scope:** Two inline live-search inputs on `/discover` (movies + people), backed by a federated, progressively-streaming search service that queries the local DB, TMDB, OMDB, and Trakt. Plus remote-fallback enrichment for the movie detail page.

---

## 1. Goals

- **Replace** the modal-based "+ Add" picker on `/discover` with two inline search inputs (one for movies, one for people) sitting next to the seed pill row.
- **Federate** the search across local library DB → TMDB → OMDB → Trakt, returning results progressively (local first, externals as they arrive).
- **Reusable components** — drop-in anywhere on the site that needs an inline movie/person picker.
- **View-time enrichment** — clicking "View" on any result navigates to that entity's detail page. If the entity is not in the local DB, fetch the metadata on detail-page load and persist it for next time.
- **Polymorphic seed list** — already supports movies + people in state; this design tightens the visual differentiation.

## 2. Non-goals

- Pagination beyond the initial ~25 results per source. (User scrolls within the dropdown; if more are needed, they refine the query.)
- Background refresh of stale cache entries.
- Recommendations engine consuming person seeds as direct embeddings — keep existing flow (person → owned movies → seed IDs).
- Brand-new admin UI for Trakt credentials — that lives in the existing planned `Settings → Sources` page (separate work).

## 3. Architectural overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client (Discover page)                                              │
│                                                                       │
│  ┌─────────────────────────┐   ┌─────────────────────────┐           │
│  │ <MovieSearchInput/>     │   │ <PersonSearchInput/>    │           │
│  │ (uses EntitySearchInput)│   │ (uses EntitySearchInput)│           │
│  └──────────┬──────────────┘   └──────────┬──────────────┘           │
│             │                              │                          │
│             └──────────┬───────────────────┘                          │
│                        │ useSearchStream(type, query)                 │
│                        │ EventSource(GET /search/{type}/stream)       │
│                        ▼                                              │
└────────────────────────┼─────────────────────────────────────────────┘
                         │
                         │ SSE
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Server                                                              │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │ @Sse('search/movies/stream')   @Sse('search/people/stream')│      │
│  │       │                                  │                │      │
│  │       ▼                                  ▼                │      │
│  │ FederatedMovieSearchService    FederatedPeopleSearchService│      │
│  │       │                                  │                │      │
│  │       ├─ local DB (LIKE)                 ├─ local DB       │      │
│  │       ├─ search_cache table              ├─ search_cache   │      │
│  │       ├─ TMDB.searchMovie                ├─ TMDB.searchPerson      │
│  │       ├─ OMDB.searchMovie  (NEW)         └─ Trakt.searchPerson (NEW)│
│  │       └─ Trakt.searchMovie (NEW)                          │      │
│  └────────────────────────────────────────────────────────────┘      │
│                                                                       │
│  Detail-page fallback:                                                │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │ MovieController: GET /movies/:key  (NEW remote-fallback)   │      │
│  │   - if local row exists → return it                        │      │
│  │   - if key is `tmdb:<id>` and no local row → fetch from    │      │
│  │     TMDB, write a stub row (no file path, isOwned=false)   │      │
│  │ PeopleController: existing /people/:key already does this. │      │
│  └────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Streaming protocol

**SSE (Server-Sent Events)** via NestJS `@Sse()` decorator returning `Observable<MessageEvent>`. One-way, long-lived, uses the same cookie auth (`mu_access_token`) that the rest of the app uses. EventSource auto-reconnects on transient drop; that's fine — the orchestrator is idempotent for a given query.

Event types emitted per stream:

| Event | Payload | When |
|---|---|---|
| `results` | `{ source: 'local' \| 'tmdb' \| 'omdb' \| 'trakt' \| 'cache', items: SearchHit[] }` | Each batch as it arrives |
| `error` | `{ source, message }` | A source failed; orchestrator continues with others |
| `done` | `{ sourcesQueried: string[], cached: boolean }` | All sources resolved; client closes EventSource |

Order of arrival:
1. `local` (synchronous DB query — emitted within ~10ms)
2. `cache` (if a fresh `search_cache` row exists, emit cached external results immediately and skip external calls)
3. Otherwise, `tmdb` / `omdb` / `trakt` in whatever order they resolve

### 3.2 Cache layer

New table:

```ts
// packages/server/src/database/schema/search-cache.ts
export const searchCache = sqliteTable('search_cache', {
    id: text('id').primaryKey(),                  // hash(type + normalizedQuery)
    type: text('type', { enum: ['movie', 'person'] }).notNull(),
    normalizedQuery: text('normalized_query').notNull(),
    source: text('source', { enum: ['tmdb', 'omdb', 'trakt'] }).notNull(),
    payload: text('payload').notNull(),           // JSON: SearchHit[]
    fetchedAt: text('fetched_at').notNull(),      // ISO datetime
}, (t) => ({
    typeQueryIdx: index('search_cache_type_query').on(t.type, t.normalizedQuery),
}));
```

- Key: `(type, normalizedQuery, source)` — one row per source per query.
- TTL: 7 days. On read, rows older than 7d are ignored (treated as cache miss); orchestrator re-fetches and overwrites.
- Normalized query: `query.toLowerCase().trim().replace(/\s+/g, ' ')`.
- Migration handled by `scripts/migrate.js` (existing `CREATE TABLE IF NOT EXISTS` pattern).
- Local DB query is **never cached** — it's already fast (LIKE on indexed title) and we want newly-scanned movies to appear immediately.

### 3.3 Dedup & merge

Per-source `SearchHit` shape (normalized):

```ts
interface SearchHit {
    // Canonical keys — at least one must be present
    movieId?: string;       // local DB UUID (library hit)
    imdbId?: string;        // e.g. 'tt0133093'
    tmdbId?: number;
    traktId?: number;
    personKey?: string;     // 'tmdb:<id>' or 'name:<slug>' for people
    // Display
    title?: string;         // movies
    name?: string;          // people
    year?: number;
    posterUrl?: string;
    profileUrl?: string;
    overview?: string;      // first 200 chars
    role?: string;          // people: 'Acting' | 'Directing' | …
    // Provenance
    sources: Array<'local' | 'tmdb' | 'omdb' | 'trakt'>;
    isOwned: boolean;       // true if `movieId` resolves to a library row
    matchScore: number;     // 0..1; exact-match=1.0, partial=lower
}
```

**Movie dedup key (in order):**
1. `imdbId` if present
2. `tmdbId` if present
3. `slugify(title) + '|' + year`

When orchestrator receives a new hit, it looks up the dedup key. If a hit with the same key exists, it merges (`sources.push(newSource)`, union missing fields, keep highest matchScore). The merged hit is re-emitted to the client (which patches it by key).

**Person dedup key:**
1. `tmdbId`
2. `traktId`
3. `slugify(name) + '|' + role`

### 3.4 Result ranking

Client-side sort applied after each batch arrives:

```
tier 0: exact local match (case-insensitive)
tier 1: exact external match
tier 2: prefix local match
tier 3: prefix external match
tier 4: substring local match (anywhere)
tier 5: substring external match
within tier: by matchScore desc, then popularity desc
```

Library hits (`isOwned: true`) get a small visual badge but compete on the same tier with externals — the user wants exact matches to surface regardless of library status.

### 3.5 Detail-page remote enrichment

**Person** (`/person/:key`) — already works. `PeopleService.getOrFetch(key)` resolves from local row or TMDB. No changes needed.

**Movie** (`/movie/:key`) — new behavior:

- Route handler accepts either a UUID (existing behavior) or a `tmdb:<id>` key.
- If `tmdb:<id>` and no local row exists with that `tmdbId`:
  1. Fetch metadata from TMDB
  2. Run merge engine with TMDB-only contribution → produces full metadata
  3. Write a stub `movies` row with: `title`, `year`, `tmdbId`, `imdbId` (if present), `isOwned=false`, no file path, no library ID
  4. Write `movie_metadata` row
  5. Return the same shape the client already expects
- Client-side: `MovieDetail` already handles missing-file/missing-cast gracefully; we just need to handle the case where `Play` is hidden because `isOwned=false` (add a `View on TMDB` external link instead).
- The stub row is persistent — future visits skip the TMDB call entirely.

## 4. Backend implementation

### 4.1 New module: `SearchModule`

Path: `packages/server/src/search/`

Files:
- `search.module.ts` — wires up the services + controllers
- `search-types.ts` — `SearchHit`, `SearchEvent`, `SearchType`
- `federated-movie-search.service.ts`
- `federated-people-search.service.ts`
- `search-cache.service.ts` — thin Drizzle wrapper over the table
- `search.controller.ts` — `@Sse()` streaming endpoints + non-streaming fallbacks

Endpoints:

| Method | Path | Type | Auth | Notes |
|---|---|---|---|---|
| GET | `/api/v1/search/movies/stream?q=` | SSE | user | Progressive |
| GET | `/api/v1/search/people/stream?q=` | SSE | user | Progressive |
| GET | `/api/v1/search/movies?q=` | JSON | user | Waits for all sources, returns flat array. Polling-safe fallback for clients that don't have EventSource (e.g. server-side rendering). |
| GET | `/api/v1/search/people?q=` | JSON | user | Same |

### 4.2 Federated search service contract

```ts
class FederatedMovieSearchService {
    /** Subscribe to a streaming search. Returns an Observable that emits
     *  SearchEvent objects (results, error, done) until complete. */
    search$(query: string, userId: string): Observable<SearchEvent<MovieHit>>;
}
```

Internals:
1. Synchronous: query local DB (`movies.search(query, userId)`), emit `results` with `source: 'local'`.
2. Check `search_cache` for non-expired entries per external source. For each hit, emit `results` with `source: 'cache'` (payload tagged with original source). Skip step 3 for that source.
3. For each remaining source, fire async query in parallel. On resolution:
   - Normalize raw response → `SearchHit[]`
   - Merge with already-emitted hits by dedup key
   - Persist to `search_cache`
   - Emit `results` event
4. When all sources resolved (or errored), emit `done` and complete the observable.

Each source-query has a hard timeout (`5000ms`); on timeout, emit `error` for that source and continue.

### 4.3 New provider methods

**OMDB** (`packages/server/src/metadata/providers/omdb.provider.ts`):
```ts
async searchMovie(query: string): Promise<OmdbSearchResult[]>
// Uses OMDB's `?s=<title>` endpoint. Cached per-query (existing CacheService).
// OMDB doesn't have person search — feature simply skips OMDB for people.
```

**Trakt** (`packages/server/src/metadata/providers/trakt.provider.ts` — NEW FILE):
```ts
class TraktProvider {
    async searchMovie(query: string): Promise<TraktSearchResult[]>
    async searchPerson(query: string): Promise<TraktPersonResult[]>
}
```

Credentials: `ProviderCredentialsService.get('trakt')` returns `{ clientId, clientSecret, accessToken? }`. If not configured, Trakt source is silently skipped (no error to user — just one fewer source). **Credentials are entered by the user in Settings → Sources, never committed.**

If the Trakt provider doesn't exist by the time we land this, the orchestrator graceful-degrades: TraktProvider's methods can be no-ops returning `[]`. Wire-up of real Trakt becomes a separate PR.

### 4.4 Migration

Add to `scripts/migrate.js`:

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

## 5. Frontend implementation

### 5.1 Reusable component: `EntitySearchInput`

Path: `packages/client/src/components/common/EntitySearchInput/`

Files:
- `EntitySearchInput.tsx` — generic shell
- `EntitySearchInput.module.scss`
- `useSearchStream.ts` — EventSource hook
- `MovieSearchInput.tsx` — thin wrapper presets `type='movie'`
- `PersonSearchInput.tsx` — thin wrapper presets `type='person'`

```ts
interface EntitySearchInputProps {
    type: 'movie' | 'person';
    placeholder?: string;
    onSelect: (hit: SearchHit) => void;              // user clicked an item
    onView?: (hit: SearchHit) => void;               // user clicked View
    disabledKeys?: string[];                          // hits that should appear greyed (already-seeded)
    autoFocus?: boolean;
    maxHeight?: number;                               // dropdown scroll height
    class?: string;
}
```

Behavior:
- Debounce: 250ms idle after last keystroke.
- Min query length: 2 chars (below that, dropdown shows nothing).
- Open dropdown on focus + query present.
- Keyboard nav: ↑/↓ moves selection, Enter triggers `onSelect`, Esc closes.
- Loading state: spinner badge on the right of input while any source is pending.
- Source provenance: each row shows tiny dots — green=local, blue=TMDB, orange=OMDB, red=Trakt. Multiple dots = merged from multiple sources.
- Click row: triggers `onSelect`.
- Click "View" button on row (right side, on hover or always-visible on touch): triggers `onView`. Default `onView` navigates to detail page (movie or person depending on type).

### 5.2 `useSearchStream` hook

```ts
function useSearchStream(type: 'movie' | 'person', query: string): {
    results: SearchHit[];        // sorted, deduped
    isLoading: boolean;
    sources: string[];           // ['local', 'tmdb'] — which have responded
    error?: string;
};
```

- Opens `EventSource(/api/v1/search/{type}/stream?q={query})` on query change (after debounce).
- Closes previous EventSource if a new query arrives.
- On `results` event: merges into local state by dedup key (client mirrors server's dedup logic, so out-of-order arrival is safe).
- On `done`: closes the EventSource.
- On EventSource `error` (network drop): one retry, then surface as `error`.

### 5.3 Discover page changes

```diff
- <MoviePicker isOpen={pickerOpen} ... />
- <button class={styles.addSeedBtn} onClick={() => setPickerOpen(true)}>+ Add</button>

+ <div class={styles.seedSearchRow}>
+   <MovieSearchInput
+       placeholder="Add a movie seed…"
+       disabledKeys={seeds}
+       onSelect={(hit) => addSeed(hit.movieId ?? `tmdb:${hit.tmdbId}`, hit.title)}
+   />
+   <PersonSearchInput
+       placeholder="Add a person seed (cast/director)…"
+       disabledKeys={personSeedKeys.value}
+       onSelect={(hit) => addPersonSeed(hit.personKey!, hit.name)}
+   />
+ </div>
```

Seed pills (`SeedChip`) get a `kind?: 'movie' | 'person'` prop. People chips get a slightly different background (subtle tint) + the existing `👤` prefix becomes a real icon. Movie chips stay as today.

`MoviePicker` import and `pickerOpen` state are removed from Discover. The component file stays in place for any future reuse.

### 5.4 MovieDetail TMDB-virtual-row support

When `MovieDetail` mounts with a `tmdb:<id>` route param, it calls `moviesService.get('tmdb:42')` which hits `GET /movies/tmdb:42`. The server endpoint handles the lookup-or-fetch logic described in §3.5.

Client renders the page as normal. Conditionally: if `movie.isOwned === false`, replace the Play button with an external "View on TMDB" link, and hide the file-info / encoding-settings sections.

## 6. Testing

### 6.1 Server unit tests

- `federated-movie-search.service.spec.ts`
  - Emits `local` first when local matches exist
  - Returns cached external results when fresh cache exists; skips upstream call
  - Merges identical IMDB IDs across sources into one hit
  - Tolerates a failing source (emits `error`, continues with others)
  - Times out at 5s per source
- `federated-people-search.service.spec.ts` — same shape, minus OMDB
- `search-cache.service.spec.ts`
  - 7-day TTL: rows older than cutoff are treated as miss
  - `set()` upserts (rewrites existing row for same key)
- `omdb.provider.spec.ts` — search by title returns normalized array
- `trakt.provider.spec.ts` — gracefully no-ops when credentials missing

### 6.2 Client unit tests

- `useSearchStream.test.ts`
  - Subscribes to EventSource on query, unsubscribes on unmount/change
  - Merges out-of-order events by dedup key
  - Re-sorts on each batch
- `EntitySearchInput.test.tsx`
  - Debounces input by 250ms
  - Keyboard nav (↑/↓/Enter/Esc)
  - Click row → onSelect
  - Click View → onView (default navigation)

### 6.3 Integration smoke tests

- `/api/v1/search/movies/stream?q=matrix` returns SSE with `local` event followed by external events.
- `/movies/tmdb:603` (Matrix's TMDB ID) creates a stub row on first GET, returns the same row on second GET (no second TMDB call).

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TMDB / OMDB / Trakt rate limits hit during heavy search use | Per-source token-bucket already exists (`RateLimitService`). Federated orchestrator respects it — if rate-limited, source is skipped, error emitted, others continue. |
| Cache fills up with one-off queries | 7-day TTL + LIMIT-aware pruning on insert (keep most-recent 10k entries, delete oldest). Background prune runs daily. |
| SSE long-lived connection issues behind proxies | Documented requirement: deploy must allow streaming responses (NSSM service does; no nginx in front in current setup). Fallback non-streaming endpoint exists. |
| Trakt provider doesn't exist yet | Orchestrator graceful-degrades. Trakt is the lowest-priority source. |
| Dedup key collisions (two different movies with same title+year) | IMDB ID is the primary key — title+year fallback only when IMDB ID is absent from all sources. Real collisions are rare and acceptable. |
| Streaming reorder UI flicker (results jumping as they arrive) | Sort is stable: items keep their position unless a higher-tier match arrives. Animated slide for new arrivals (CSS transform, 150ms). |

## 8. Phased delivery

This is too large for a single PR — three phases:

**Phase 1: Server foundation**
- `search_cache` table + migration
- `SearchModule`, federated services (local + TMDB only; OMDB/Trakt no-op)
- SSE controller + non-streaming fallback
- Movie detail TMDB virtual-row support
- Server unit tests
- Verify with curl against running server

**Phase 2: Client components + Discover wiring**
- `EntitySearchInput` + `useSearchStream`
- `MovieSearchInput` / `PersonSearchInput`
- Discover page integration (replace MoviePicker)
- Seed chip visual polish
- Client unit tests
- End-to-end smoke test in browser

**Phase 3: OMDB + Trakt search**
- OMDB `searchMovie`
- Trakt provider (if credentials present in `ProviderCredentialsService`)
- Wire into federated services
- Tests

Each phase ships independently. After Phase 1+2, the feature is usable with local + TMDB only (covers ~95% of cases). Phase 3 is additive.

## 9. Open questions

None remaining; all four architectural decisions (sources, view behavior, MoviePicker disposition, cache strategy) and dedup approach resolved during brainstorming.
