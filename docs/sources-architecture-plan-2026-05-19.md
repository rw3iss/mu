# Sources Architecture — Analysis & Plan (2026-05-19)

## 0. Executive summary

Mu already has a strong provider foundation — there's a typed `Provider`
interface with capability flags (`recommend`/`enrich`/`embed`/`rerank`/`explain`),
DB-backed credentials, rate limiting, monthly budgeting, an append-only audit
log, and a `@RegisterProvider()` decorator for discovery. **What's missing is
NOT the abstraction. What's missing is:**

1. A **canonical metadata merge engine** — current merge is a 200-line hardcoded
   block in `metadata.service.ts::fetchAndMerge()` (TMDB always wins for poster,
   OMDB always wins for IMDB rating, etc.). New sources need code changes.
2. A **multi-source identity layer** — we resolve TMDB↔IMDB via the TMDB
   `external_ids` field, but there's no canonical "this movie has the following
   IDs across all sources" record. Adding Trakt or Letterboxd today means a
   per-pair lookup hack.
3. A **Sources management UI** — `Connections.tsx` is a placeholder that lists
   `ProviderCard`s with no add/configure/test flow.
4. **More sources** — concretely: Trakt's metadata side (currently only the
   recommender), TVDB, MovieLens for collaborative filtering, Wikidata for
   linked-data signals, an LLM provider for `rerank`/`explain`.

This document maps the existing system, proposes a generic source-abstraction
layer (mostly extensions to what's there), proposes a metadata merge engine
driven by per-field precedence rules, and lists candidate sources ordered by
value-to-effort.

---

## 1. Current architecture

### 1.1 Metadata pipeline

```
File on disk
  → preprocess (title / year / SxxEyy detection)
  → matcher (title dice + year proximity + duration tiebreaker, threshold 0.82)
  → fetchAndMerge() in metadata.service.ts        ← single-purpose merge fn
      • TMDB providerDetails()
      • OMDB providerDetails()
      • Field-by-field hardcoded precedence
  → INSERT/UPDATE movies + movie_metadata
  → emit MOVIE_METADATA_UPDATED → embedding listener
```

### 1.2 Recommendation pipeline

```
Discover request
  → RecommendationsService.getSimilarMovies | getMultiInput | getPersonalized | getColdDiscover
  → Fan out to SimilarityStrategy[]:
      • external-cache  (DB table movie_external_recs — TMDB similar/rec + Trakt related)
      • content-vector  (in-library Jaccard/cosine on cast/keywords/genres)
      • embedding       (Embedder provider — plot text embeddings)
      • llm-rerank      (LLMClient provider)
  → composite-scorer.ts blends strategy outputs (configurable weights)
  → applyFilters (same-group exclude, per-director cap, hidden)
  → MMR re-rank for diversity
  → applyDiscoverFilters (user filters: minRating, minVotes, year range, etc.)
  → top N
```

### 1.3 Provider platform — what exists

| Piece | File | Status |
|---|---|---|
| Capability-typed `Provider` base | `providers/provider.interface.ts` | ✅ Solid |
| `@RegisterProvider()` decorator | `providers/register-provider.decorator.ts` | ✅ Solid |
| Registry (`list(cap)`, `configured(cap)`) | `providers/provider-registry.service.ts` | ✅ Solid |
| DB credentials | `database/schema/provider-credentials.ts` | ✅ Solid (cleartext v1) |
| Rate limit + budget | `providers/rate-limit.service.ts` | ✅ Solid |
| Audit log | `providers/provider-events.service.ts` | ✅ Solid |
| Connections settings UI | `pages/settings/Connections.tsx` | ⚠️ Placeholder |
| Generic merge engine | (does not exist) | ❌ |
| Multi-source identity registry | (per-row tmdbId/imdbId only) | ❌ |
| `Searcher` capability (search-and-match) | (does not exist) | ❌ |

### 1.4 Database

- `movies` — direct external-id columns (`tmdbId`, `imdbId`). No `traktId`, no
  `tvdbId`, no `letterboxdSlug`. No per-source raw payload.
- `movie_metadata` — one row per movie with a `source` string like
  `'tmdb+omdb'` or `'tmdb-tv-episode'`. The `extendedData` JSON column is the
  current spillover bucket.
- `movie_external_recs` — per-recommendation rows, source-tagged, lazily
  resolved to local `movieId`. Already multi-source-ready.
- `people` — multi-source-ready columns (`tmdbId`, `imdbId`, plus a generic
  namespaced `externalId`).

---

## 2. Gaps

### G-1 — Merge is hardcoded per source pair
Adding Trakt's metadata (it has its own poster, overview, runtime, IMDB ID,
rating) means editing `fetchAndMerge()` to add a third branch. Same for any
new source. The current code is a 200-line block of `if (omdb.imdbId)` /
`else if (tmdb.imdbId)` conditionals.

### G-2 — External IDs are flat columns
Adding a `traktId` means a migration + querying changes. Multi-source identity
(TMDB:603 = IMDB:tt0133093 = Trakt:slug `the-matrix-1999` = TVDB:101) has no
home today.

### G-3 — No `Searcher` capability
The matcher takes a candidates array. Today only TMDB+OMDB are queried for
candidates. To support "search this title across N sources and pick the best
match", we need a `Searcher` interface (provider returns ranked candidates)
and a way for the matcher to fan out.

### G-4 — `Connections.tsx` is a stub
Users can't add Trakt today without editing config and restarting.

### G-5 — Per-source response caching is ad-hoc
TMDB calls cache via `CacheService` with hand-rolled keys. Trakt has its own.
A new provider has to invent its own cache key scheme.

### G-6 — Cast/credits identity has no cross-source merge
A person fetched from TMDB is a row keyed by `tmdb:N`. The same person from
Letterboxd or Wikidata would create a separate row with no cross-link, even
though `imdbId` is on the schema.

### G-7 — No "re-enrich on new source connect" flow
When the user adds a new source, existing movies don't get back-filled. They
should — that's the whole point of "anytime new metadata is fetched, merge it
in".

---

## 3. Proposed architecture

The shape: **extend the existing provider platform with three new pieces** —
a `Searcher` capability, a generic `MergeEngine`, and a `MovieIdentity`
registry — then build the UI on top.

### 3.1 New capability: `Searcher`

```ts
// providers/provider.interface.ts — addition
export type Capability = 'search' | 'recommend' | 'enrich' | 'embed' | 'rerank' | 'explain';

export interface Searcher extends Provider {
    search(query: SearchQuery): Promise<SearchHit[]>;
}

export interface SearchQuery {
    title: string;
    year?: number;
    durationMinutes?: number;
    imdbId?: string;
    tmdbId?: number;
}

export interface SearchHit {
    sourceId: string;          // provider id, e.g. 'trakt', 'tvdb'
    externalIds: Record<string, string | number>;  // { tmdb: 603, imdb: 'tt0133093' }
    title: string;
    year: number | null;
    score: number;             // 0–1, provider's own confidence (matcher composes them)
    raw: unknown;              // provider's full payload, kept for merge
}
```

The existing matcher promotes from "pick the best of N candidates" to "fan out
across all configured `Searcher`s in parallel, collect hits, run the existing
title/year/duration scorer across the union, pick top match".

### 3.2 New: `MovieIdentity` table

```
movie_identities
  id PK
  movieId FK → movies.id (nullable until first match)
  source TEXT       -- 'tmdb' | 'imdb' | 'trakt' | 'tvdb' | 'letterboxd' | …
  externalId TEXT
  confidence REAL   -- 0–1 from the matcher; 1.0 for user-confirmed
  addedAt
  updatedAt
  UNIQUE (source, externalId)
  INDEX (movieId)
```

Replaces the per-source columns on `movies` (we keep `tmdbId`/`imdbId` as
denormalised hot fields for fast filtering, but they become reflections of
the canonical `movie_identities` rows). New sources add rows without
migrations.

Same shape for `person_identities` (already partially modeled by the
namespaced `externalId` column on `people`).

### 3.3 New: declarative `MergeEngine`

Each provider declares which fields it can supply and how authoritative it
is per-field. The merge engine reads the rule table and runs:

```ts
// providers/merge/merge-engine.ts (new)
export interface FieldRule {
    field: keyof MovieMetadata | keyof Movies;
    /** Per-source precedence (highest wins on conflict). Source not in
     *  the list is implicitly weight 0. */
    precedence: Record<string /* sourceId */, number>;
    /** How to combine: 'take-best' (highest precedence wins) | 'merge-arrays' |
     *  'numeric-max' | 'numeric-avg' | 'union-strings' */
    strategy: 'take-best' | 'merge-arrays' | 'numeric-max' | 'union-strings';
}

const MERGE_RULES: FieldRule[] = [
    { field: 'imdbRating',    precedence: { omdb: 10, trakt: 5 },  strategy: 'take-best' },
    { field: 'posterUrl',     precedence: { tmdb: 10, trakt: 6 },  strategy: 'take-best' },
    { field: 'cast',          precedence: { tmdb: 10, trakt: 5 },  strategy: 'merge-arrays' },
    { field: 'genres',        precedence: { tmdb: 10, omdb: 4 },   strategy: 'merge-arrays' },
    { field: 'tmdbVotes',     precedence: { tmdb: 10 },            strategy: 'numeric-max' },
    // …
];

mergeEngine.apply(existingRow, [{ source: 'tmdb', payload: {…} }, { source: 'trakt', payload: {…} }])
  → updatedRow + diff log
```

Key behaviors:
- **Additive merge.** A new source's value lands only if its precedence is
  higher than the existing field's recorded provenance, OR the field is empty.
- **Per-field provenance.** A new column `metadata_provenance JSON` stores
  `{ field: sourceId }` so we know who set each field. Re-running the merge is
  idempotent.
- **No data loss.** Raw per-source payloads land in a sibling
  `movie_source_payloads` table keyed by `(movieId, sourceId, fetchedAt)`.
  Future re-runs can re-merge without re-fetching.

### 3.4 Re-enrich job

A new `BackfillSourceJob` queued whenever the user enables a new source. It
walks the library in batches of 50, calls `Searcher.search()` then
`Enricher.enrich()` for each unmatched movie, and feeds results to the merge
engine. Uses the existing rate-limit + budget infrastructure.

### 3.5 Sources management UI

Replace `Connections.tsx` placeholder with:

```
┌── Sources ─────────────────────────────────────────────────────┐
│                                                                │
│ Connected                                                      │
│ ──────────                                                     │
│  [TMDB]   capability chips · 12.4k calls · 0 errors  ⚙ Edit    │
│  [OMDB]   apiKey · 8.2k calls · 12 errors            ⚙ Edit    │
│  [Trakt]  oauth · disabled                           ⚙ Edit    │
│                                                                │
│ Available — click to connect                                   │
│ ──────────                                                     │
│  [TVDB]   metadata · enrich              + Connect             │
│  [MovieLens] recommend                   + Connect             │
│  [Wikidata]  enrich · explain (free, no key) + Connect         │
│                                                                │
│ + Add a custom source (JSON manifest)                          │
└────────────────────────────────────────────────────────────────┘
```

Per source:
- Edit modal opens a form auto-generated from the provider's `configFields`.
- A "Test connection" button hits `provider.healthCheck()`.
- A "Back-fill library" button triggers `BackfillSourceJob`.
- The right-side panel shows the audit-log sparkline + last error.

Settings → Connections becomes Settings → Sources. The internal route can stay
to avoid breaking deep links.

---

## 4. Candidate sources

Ordered by **value × low integration cost**. Effort = ★ (low) to ★★★ (high).

| Source | Capabilities | Why it matters | Effort | Notes |
|---|---|---|---|---|
| **Trakt full** (currently recommender only) | enrich, recommend, search | Free, well-documented, rich similar-movies graph, watch-history sync potential | ★ | Already partially wired; add `search` + `enrich` interfaces on the same client |
| **TVDB** | enrich, search | Best TV episode data; some movies. Free dev tier. | ★★ | TV-first; pairs well with the SxxEyy detection we already have |
| **Wikidata SPARQL** | enrich, explain | Free, no key. Adaptation chains (book→film), cross-IDs (TMDB↔IMDB↔Trakt↔Letterboxd↔TVDB all in one query), franchise members, awards | ★★ | Query language has a learning curve but the payoff is huge — one stop for cross-ID resolution |
| **IMDb datasets** (bulk CSV) | enrich (offline) | Authoritative ratings + votes for the entire IMDb. Updates daily. No key, no rate limit. | ★★ | Background cron downloads + diffs; not online — we ingest once a day. Solves the OMDB rate ceiling for big libraries. |
| **Anthropic / OpenAI LLM** | rerank, explain | Already declared as `LLMClient`. Major UX upgrade: per-recommendation "why" text on result cards. | ★ | Wire one provider implementation; existing `llm-rerank` strategy is the consumer. |
| **MovieLens** | recommend | 33M user-movie ratings → collaborative-filtering signal we don't currently have. Free for non-commercial. | ★★★ | Ratings dataset only; we need to host the CF model ourselves (matrix factorization or a sentence-transformer wrap). |
| **AniList GraphQL** | enrich, search, recommend | Best anime coverage; complements TMDB which is shallow on anime. Free. | ★★ | Worth doing if the user's library has any anime; otherwise defer. |
| **JustWatch** | enrich (availability) | "Available on Netflix/Hulu/Prime by region". | ★★★ | No official API; legal grey-zone. Recommend deferring. |
| **Letterboxd** | (none reliable) | Community lists are interesting; no API. RSS feeds are unofficial. | — | Skip — fragile and ToS-questionable. |
| **Rotten Tomatoes** | (none reliable) | Critic score signal. Public API discontinued. | — | Skip — OMDB already exposes the RT score. |
| **OpenLibrary** | enrich (book→film) | Adaptation linkage; nice signal for "if you liked the book…" | ★★ | Minor unless we add book pages to the app. |
| **Google Knowledge Graph** | enrich | Free with key, generic entity data. Coverage overlaps Wikidata heavily. | ★ | Lower value than Wikidata; skip unless we hit rate limits on Wikidata. |

**Recommended initial batch (Phase A in §5):**
- Trakt enrich + search (already half there)
- Wikidata SPARQL (free, huge cross-ID payoff)
- One LLM provider (low effort, high UX value)

Defer: MovieLens, TVDB, AniList until the foundation is in.

---

## 5. Implementation phases

### Phase 0 — Foundation (no new sources yet)
Estimated: 3–4 days.

1. `movie_identities` + `person_identities` tables (migration).
2. `Searcher` capability + interface.
3. `MergeEngine` with declarative `FieldRule[]`. Migrate the current
   `fetchAndMerge` body into a rule table — same behavior, new shape.
4. `movie_source_payloads` table for raw-per-source storage.
5. `metadata_provenance` JSON column on `movie_metadata` for per-field source
   tracking.
6. Refactor `MetadataService.fetchAndMerge` to call `MergeEngine.apply`.
7. Regression test: existing TMDB+OMDB ingestion produces byte-identical
   `movie_metadata` rows after the refactor.

### Phase A — UI + first new sources
Estimated: 2–3 days.

1. Replace `Connections.tsx` with the design in §3.5. Per-source edit modal
   driven by `configFields`. Health-check button. Back-fill button.
2. Wire **Trakt** as full `Searcher` + `Enricher` (the client already exists
   in the `Recommender` impl — reuse it).
3. Wire **Wikidata SPARQL** as an `Enricher`. Query: `?film wdt:P345 ?imdb ;
   wdt:P4947 ?tmdb ; wdt:P364 ?language ; …`. Cache by IMDB ID.
4. Wire **one LLM provider** (Anthropic, since the user is already on it) as
   `LLMClient`. Powers `llm-rerank` + per-card "why" explanations.

### Phase B — Back-fill + bulk sources
Estimated: 3 days.

1. `BackfillSourceJob` (uses existing job system). Runs when a new source is
   connected — iterates library, calls Searcher → Enricher, runs through
   MergeEngine.
2. **IMDb datasets** ingester — daily cron, downloads `title.basics.tsv.gz` +
   `title.ratings.tsv.gz`, diffs against `movie_identities`, runs through
   MergeEngine with `source='imdb-dataset'`. Highest precedence for IMDB
   rating/votes (replaces the OMDB ceiling for big libraries).
3. Per-source health dashboard widget on the Sources page (already powered by
   `provider_events`).

### Phase C — Advanced sources
Pick based on user library composition.

- TVDB if the library is TV-heavy.
- MovieLens if the user wants collaborative-filtering signals.
- AniList if there's anime.

---

## 6. Risks & open questions

### R-1 — Re-merge churn on existing data
After Phase 0, re-running the merge on every existing row will rewrite the
`source` field and possibly the `metadata_provenance`. Acceptable as a
one-time migration, but the regression test needs to verify nothing the user
sees changes.

### R-2 — Storage growth from raw payloads
`movie_source_payloads` doubles for each new source per movie. For ~5k movies
× 5 sources × ~30KB = ~750MB. Acceptable; can be pruned by `fetchedAt` if
needed.

### R-3 — Identity collisions
Wikidata sometimes returns multiple TMDB IDs for the same Wikidata movie (TV
remake of a film, e.g.). The matcher's year-proximity check usually disambiguates,
but we need a `(source, externalId)` uniqueness constraint AND a manual
"resolve conflict" button in the UI.

### R-4 — Rate limits during back-fill
Trakt is 1/s. For 5k movies, back-fill takes ~85 minutes. Acceptable as a
background job, but the UI needs to show progress. The existing job system
already supports this.

### R-5 — Provider precedence is a judgement call
The `FieldRule.precedence` numbers are subjective. Initial values should
mirror current behavior (TMDB=10 for poster, OMDB=10 for IMDB rating) so
nothing visibly changes. Future tuning lives in a single file.

### Open Q-1 — Where do user-applied overrides go?
If a user manually corrects a title, that should always beat any source.
Proposal: `metadata_provenance.<field> = 'user'` with implicit precedence
infinity. The "user" source isn't a provider — it's a sentinel.

### Open Q-2 — How granular is the "back-fill" trigger?
- Per source on connect (proposed default).
- Per source on schema change (e.g., we add a new field to MergeEngine).
- Manual "re-enrich library" button on the source's card (proposed).

### Open Q-3 — Should the matcher consider title aliases?
Wikidata exposes `also_known_as`. AniList exposes Japanese + English titles.
Title-matching with aliases would let us auto-match "Spirited Away" to
"千と千尋の神隠し". Probably yes, but it's a Phase B-or-later concern.

---

## 7. What I propose we build first

If the goal is fastest visible improvement:

1. **Phase 0 (foundation)** — invisible but unblocks everything.
2. **Phase A items 1, 3, 4** — Sources UI, Wikidata, LLM explainer.

That's ~5–6 days of focused work and gives the user:
- A real Sources page they can configure.
- A free cross-ID source (Wikidata) that hugely improves identity resolution.
- LLM-generated "why" text under each recommendation card.

If the user wants to start there, I can break Phase 0 into commits and start.
If they want a different ordering — IMDb bulk datasets first for the rating
data quality, or Trakt full integration before Wikidata — say so and I'll
reorder.
