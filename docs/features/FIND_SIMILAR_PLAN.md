# Find Similar Movies — Implementation Plan

Companion to [FIND_SIMILAR.md](./FIND_SIMILAR.md). The spec answers *what* and *why*; this plan answers *exactly which files in what order*.

## Implementation status (2026-05-13)

| Phase | Status |
|---|---|
| 0 — Provider platform foundation | ✅ Shipped |
| 1 — TMDB cache + content vectors + UI rail | ✅ Shipped (replace-entirely path; existing module gone) |
| 2 — Trakt provider | ✅ Shipped |
| 3 — Local plot embeddings (MiniLM) | ✅ Shipped |
| 4 — Multi-input / playlist (variance-aware) | ✅ Shipped |
| 5 — LLM (Anthropic) + re-rank + features + explanations | ✅ Shipped |
| 6 — Collaborative filtering | 🟡 Deferred per plan (multi-user scale prerequisite) |
| 7 — MovieLens tag-genome import | 🟡 Optional, deferred |
| J — Job-provider abstraction + BullMQ + Docker | ✅ Shipped (added scope) |

Discovery page UI rebuild is the natural next step on the client side.

## How to read this plan

- Phases are **shippable units**. Each one ends with a working, useful product (Phase 0 ends with a working admin Connections page even though no recommender is hooked up yet — that's still useful).
- Within a phase, the order is **schema → server → client → tests → acceptance**.
- Each phase declares **dependencies**, **out of scope**, and **estimated effort** so it can be picked up cold.
- File paths are absolute under `src/`. Naming follows the existing project conventions (NestJS modules in `packages/server/src/<area>/`, Preact pages in `packages/client/src/pages/`, schema in `packages/server/src/database/schema/`, inline migrations in `src/scripts/migrate.js`).

## Architectural invariants (apply to every phase)

1. **Drizzle schema is dialect-portable.** No SQLite-only functions. JSON columns via `text({ mode: 'json' })`. Booleans via `integer({ mode: 'boolean' })`. UUIDs as primary keys. Timestamps as ISO strings.
2. **All external sources are `Provider`s.** Never import a concrete provider class outside its own file — go through `ProviderRegistry`.
3. **Rate limits are declarative.** Each provider declares its `RateLimitSpec`; `RateLimitService` enforces it. No provider implements its own throttling.
4. **Credentials live only in `provider_credentials`.** Never in `config.yml`, never in env vars (other than `MU_SECRETS_KEY` for at-rest encryption in v2), never logged.
5. **Auto-enrichment is opt-in per capability.** Defaults: local strategies always on, external APIs on, LLM features off (paid).
6. **Idempotency everywhere.** Every job short-circuits on "already done recently". Refresh is driven by a configurable staleness window.
7. **Graceful degradation always.** Zero configured providers must still return something useful (content-vector + group fallback).

---

## Phase 0 — Provider platform (foundation)

**Goal:** Land the abstractions, admin UX, and cross-cutting plumbing so every later phase is "add one provider".

**Effort:** 2–3 working days.

**Dependencies:** none.

### 0.1 Schema

Add to `src/scripts/migrate.js` (in the existing `tables` array for CREATE statements):

```sql
CREATE TABLE IF NOT EXISTS provider_credentials (
  provider_id  TEXT PRIMARY KEY,
  config       TEXT NOT NULL,                 -- JSON: arbitrary per-provider
  enabled      INTEGER NOT NULL DEFAULT 1,
  encrypted    INTEGER NOT NULL DEFAULT 0,
  added_at     TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  provider_id  TEXT NOT NULL,
  window       TEXT NOT NULL,                 -- 'minute' | 'day' | 'month'
  bucket_key   TEXT NOT NULL,                 -- ISO timestamp truncated to window
  count        INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL DEFAULT 0,
  PRIMARY KEY (provider_id, window, bucket_key)
);

CREATE TABLE IF NOT EXISTS provider_events (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  event_type   TEXT NOT NULL,                 -- 'call' | 'error' | 'rate_limit' | 'budget_exhausted' | 'health_check'
  status_code  INTEGER,
  duration_ms  INTEGER,
  cost_usd     REAL,
  payload      TEXT,                          -- JSON, secrets redacted
  occurred_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_events_provider_idx
  ON provider_events(provider_id, occurred_at DESC);
```

Mirror in Drizzle schema files (one file per table) under `packages/server/src/database/schema/`. Export from `schema/index.ts`.

### 0.2 Server files (new)

```
packages/server/src/providers/
├── providers.module.ts              # NestJS module wiring everything
├── provider.interface.ts            # Provider, Recommender, Enricher, Embedder, LLMClient, Capability
├── provider-registry.service.ts     # Registration + lookup by capability
├── provider-credentials.service.ts  # CRUD; masks secrets on read
├── rate-limit.service.ts            # Token bucket + persistence
├── provider-events.service.ts       # Event recording + summary queries
├── providers.controller.ts          # REST surface (admin-only)
├── register-provider.decorator.ts   # @RegisterProvider() for DI
├── config-field.types.ts            # ConfigFieldSpec, RateLimitSpec types
└── exceptions.ts                    # RateLimitExceeded, BudgetExhausted, ProviderNotConfigured
```

### 0.3 Server REST surface (`providers.controller.ts`)

All endpoints behind admin auth.

```
GET    /providers                            # list all registered providers (masked)
GET    /providers/:id                        # details + status + recent usage
PUT    /providers/:id/credentials            # set config (admin)
DELETE /providers/:id/credentials            # remove
POST   /providers/:id/test                   # healthCheck()
GET    /providers/:id/usage?window=7d        # usage timeline
PATCH  /providers/:id                        # toggle enabled
```

### 0.4 Client files (new)

```
packages/client/src/pages/settings/
├── Connections.tsx
├── Connections.module.scss
├── Matching.tsx                     # stub for Phase 1+ (renders defaults only)
└── Matching.module.scss

packages/client/src/components/settings/
├── ProviderCard.tsx
├── ProviderCard.module.scss
├── ProviderConfigModal.tsx          # form auto-generated from configFields
└── ProviderConfigModal.module.scss

packages/client/src/services/providers.service.ts
packages/client/src/state/providers.state.ts
```

### 0.5 Modifications

- `packages/server/src/app.module.ts` — register `ProvidersModule`.
- `packages/server/src/events/events.service.ts` (already exists) — add `MOVIE_METADATA_UPDATED` event constant if not present. Confirm `EventsModule` is `Global` so subscribers can hook in from other modules.
- `packages/server/src/metadata/metadata.service.ts` — emit `MOVIE_METADATA_UPDATED` after `getMovieDetails` finalises. No subscribers yet.
- `packages/client/src/pages/Settings.tsx` — add Connections + Matching sub-page entries.
- `packages/client/src/app.tsx` — register `/settings/connections` and `/settings/matching` routes.

### 0.6 Tests

Server (`packages/server/src/providers/__tests__/`):
- `provider-registry.spec.ts` — registration, dedup, capability filtering, listing only configured providers.
- `rate-limit.spec.ts` — token bucket math, sliding window over hour/day/month, persistence across simulated restart, `RateLimitExceeded` thrown with correct `retryAfterMs`, budget enforcement.
- `provider-credentials.spec.ts` — JSON round-trip, masking on read, `encrypted` flag preserved.
- `provider-events.spec.ts` — record + 7d/30d summary aggregation.

Client: smoke test the Connections page renders with an empty registry.

### 0.7 Acceptance criteria

- [ ] `GET /providers` returns `[]` (no providers registered yet — by design).
- [ ] `Settings → Connections` page renders cleanly with an empty state ("No providers registered. Add one via the Phase 1+ deployment.").
- [ ] `Settings → Matching` page renders with default values, all controls disabled until strategies land.
- [ ] All three new tables migrate cleanly on existing dev/prod DBs (test by running `pnpm db:migrate-inline` twice — second run no-ops).
- [ ] Build passes with `pnpm build` from `src/`.

### 0.8 Out of scope

- Encryption-at-rest (v2 upgrade — leave the `encrypted` column for it).
- Multi-instance / distributed rate limits (single-server only for v1).
- Cost forecasting beyond simple linear extrapolation.
- Per-user provider configs (server-wide for v1).

---

## Phase 1 — TMDB recs cache + content-vector strategy + UI rail

**Goal:** End-to-end recommender powered entirely by data already on disk + TMDB's free `/similar` and `/recommendations` payloads. Better than TMDB alone, zero new external calls.

**Effort:** 1–2 working days.

**Dependencies:** Phase 0.

### 1.1 Schema

```sql
CREATE TABLE IF NOT EXISTS movie_external_recs (
  movie_id     TEXT NOT NULL,
  source       TEXT NOT NULL,           -- 'tmdb_similar' | 'tmdb_rec'
  rank         INTEGER NOT NULL,
  target_movie_id TEXT,                 -- our movie ID if we have it locally
  target_tmdb  INTEGER,
  target_imdb  TEXT,
  target_title TEXT NOT NULL,
  target_year  INTEGER,
  raw          TEXT,                    -- JSON, full payload for future re-mining
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (movie_id, source, rank)
);
CREATE INDEX IF NOT EXISTS movie_external_recs_target_idx
  ON movie_external_recs(target_movie_id);
CREATE INDEX IF NOT EXISTS movie_external_recs_target_tmdb_idx
  ON movie_external_recs(target_tmdb);
```

### 1.2 Server files (new)

```
packages/server/src/recommendations/
├── recommendations.module.ts
├── recommendations.controller.ts          # GET /recommendations/movie/:id (and multi/playlist endpoints stubbed)
├── recommendations.service.ts             # orchestrator
├── external-recs.repository.ts            # CRUD + resolve-target queries
├── strategies/
│   ├── strategy.interface.ts              # SimilarityStrategy
│   ├── content-vector.strategy.ts         # sparse features from movie_metadata
│   ├── external-cache.strategy.ts         # reads movie_external_recs
│   └── tmdb-live.strategy.ts              # live /similar fallback (rare)
├── scoring/
│   ├── composite-scorer.ts                # weighted combine + normalise
│   ├── mmr.ts                             # diversity re-ranking
│   └── filters.ts                         # same-group, quality floor, etc.
├── jobs/
│   └── external-recs-cache.job.ts         # subscribes to MOVIE_METADATA_UPDATED
└── providers/
    └── tmdb.recommender.ts                # @RegisterProvider wraps existing TmdbProvider
```

### 1.3 Server modifications

- `metadata.service.ts` — when the TMDB response contains `similar` + `recommendations` (already pulled via `append_to_response`), pass them to `ExternalRecsCacheJob` via the event payload, OR run the cache write inline before discarding (preferred: inline write in metadata service is one query, no need for a separate job for this case).
- `app.module.ts` — register `RecommendationsModule`.

### 1.4 Strategy details

**Content-vector strategy** (`content-vector.strategy.ts`):

Inputs from `movie_metadata` JSON columns: `genres`, `cast` (top-10 by billing), `directors`, `writers`, `keywords`, `production_companies`, plus `movies.year`, `movies.runtime_minutes`, `movies.country`, `movies.language`.

Per-feature scoring:
- Jaccard for sets (cast, directors, keywords).
- Weighted Jaccard for genres (rarer genres contribute more).
- Gaussian decay for year / runtime: `exp(-Δ² / 2σ²)`.

Composite (initial weights, exposed in `Settings → Matching`):
```
0.30 · keywords + 0.20 · cast + 0.20 · genres
+ 0.10 · directors + 0.05 · companies + 0.05 · year + 0.10 · runtime
```

Returns top-K by score with metadata about which dimensions drove the match (for the UI's "shares director, 3 cast" fallback caption).

**External-cache strategy** (`external-cache.strategy.ts`):

Reads `movie_external_recs` for the seed; resolves `target_tmdb` / `target_imdb` to local movie IDs where possible (these are candidates already in the library). Out-of-library candidates flagged for the UI's "Not in library" badge.

### 1.5 Orchestrator (`recommendations.service.ts`)

```ts
async forMovie(seedId: string, opts: RecommendOpts): Promise<RecResponse> {
  const seed = await movies.findById(seedId);
  const strategies = this.activeStrategies(opts);

  const candidatePool = await this.collectCandidates(seed, strategies);
  const scored = await this.scoreAcrossStrategies(seed, candidatePool, strategies);
  const filtered = filters.apply(scored, seed, opts);
  const diversified = mmr(filtered, opts.mmrLambda ?? 0.7);

  return {
    results: diversified.slice(0, opts.k ?? 20),
    usedSources: strategies.map(s => s.name).filter(n => scored.usedNames.has(n)),
    reason: diversified.length === 0 ? 'no_signal' : null,
  };
}
```

### 1.6 Client files (new)

```
packages/client/src/components/movie/
├── SimilarMoviesRail.tsx
└── SimilarMoviesRail.module.scss

packages/client/src/services/recommendations.service.ts
packages/client/src/state/recommendations.state.ts
```

### 1.7 Client modifications

- `pages/MovieDetail.tsx` — render `<SimilarMoviesRail />` below the metadata, lazy-load on mount.
- `pages/settings/Matching.tsx` — wire the strategy-weight sliders + MMR slider + quality floor + filter checkboxes to call `PATCH /settings/matching`. Store config in `app_settings` table.

### 1.8 Tests

- `content-vector.strategy.spec.ts` — known fixtures, deterministic scores.
- `composite-scorer.spec.ts` — score normalisation, weight application, edge cases (only one strategy active).
- `mmr.spec.ts` — diversity actually applied, λ=1 reproduces input order.
- `filters.spec.ts` — same-group exclusion, per-director cap.
- Integration: `GET /recommendations/movie/:id` end-to-end against a seed DB with 50 movies and known similarities.

### 1.9 Acceptance criteria

- [ ] Open any movie detail page; see a "Similar Movies" rail with ≥5 results within 300 ms.
- [ ] Toggle a strategy off in Matching → results change without page reload.
- [ ] Same-group movies never appear (verified with a TV-show season seed).
- [ ] `usedSources` badge shows "TMDB · content-vector" on a movie with full metadata.

### 1.10 Out of scope

- Multi-input / playlist (Phase 4).
- Embeddings (Phase 3).
- LLM re-rank (Phase 5).
- Trakt (Phase 2).

---

## Phase 2 — Trakt as second recommender

**Goal:** Add Trakt `/related` as a second, diversifying recommendation source. Exercises the multi-provider blend.

**Effort:** 1–2 working days.

**Dependencies:** Phase 1.

### 2.1 Schema

Extend `movie_external_recs` source enum to accept `'trakt_related'`. No schema change required — just a new `source` value.

### 2.2 Server files (new)

```
packages/server/src/providers/sources/trakt/
├── trakt.module.ts
├── trakt.http-client.ts                # axios/undici wrapper with trakt-api-key header
├── trakt.recommender.ts                # @RegisterProvider Recommender
├── trakt.enricher.ts                   # @RegisterProvider Enricher (optional: tags + lists)
└── trakt.types.ts

packages/server/src/recommendations/jobs/trakt-related-fetch.job.ts
```

### 2.3 RateLimitSpec for Trakt

```ts
{ perSecond: 1, perMinute: 60, perDay: 50_000 }
```

Conservative — Trakt's actual app-level limit is generous; we leave headroom.

### 2.4 Server modifications

- `events.service.ts` subscriber added in `TraktModule.onModuleInit` — on `MOVIE_METADATA_UPDATED`, enqueue `TraktRelatedFetchJob` (rate-limited).
- `recommendations.service.ts` — `external-cache.strategy.ts` now consumes both `tmdb_*` and `trakt_related` sources transparently.
- `app.module.ts` — register `TraktModule`.

### 2.5 Client modifications

- `pages/settings/Connections.tsx` — Trakt card now appears (registered). Admin enters `client_id` (and optional `client_secret` for future OAuth).
- `pages/settings/Matching.tsx` — Trakt weight slider becomes active.

### 2.6 Tests

- `trakt.recommender.spec.ts` — request shape, response parsing, header presence (mocked HTTP).
- Rate-limiter integration — Trakt over-quota → `TraktRelatedFetchJob` requeues with proper `runAfter`.
- Snapshot of Trakt JSON → assert correct `movie_external_recs` rows produced.

### 2.7 Acceptance criteria

- [ ] Admin adds Trakt client_id; Connections page shows "Active" with a successful test call.
- [ ] After re-scanning a movie, Trakt-related entries appear in `movie_external_recs`.
- [ ] Movie detail "Similar" rail now blends TMDB + Trakt; `usedSources` reflects both.
- [ ] Removing the Trakt credential → status returns to "Not configured"; existing cached data still drives results.

### 2.8 Out of scope

- User OAuth (defer to a later "personal Trakt sync" feature).
- Trakt's `/users/me/recommendations/movies` endpoint.

---

## Phase 3 — Local plot embeddings + embedding strategy

**Goal:** Dense semantic similarity from plot summaries, fully local, free.

**Effort:** 3–5 working days.

**Dependencies:** Phase 0.

### 3.1 Schema

```sql
CREATE TABLE IF NOT EXISTS movie_embeddings (
  movie_id     TEXT NOT NULL,
  model        TEXT NOT NULL,            -- 'minilm-l6-v2'
  dim          INTEGER NOT NULL,
  vector       BLOB NOT NULL,            -- Float32 LE
  source_text  TEXT,                     -- hash of input for staleness detection
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (movie_id, model)
);
```

### 3.2 Server files (new)

```
packages/server/src/embeddings/
├── embeddings.module.ts
├── embedding-store.interface.ts            # EmbeddingStore (Postgres-portable abstraction)
├── sqlite-blob-embedding-store.ts          # v1 impl
├── embedders/
│   ├── minilm-local.embedder.ts            # @xenova/transformers in-process
│   └── openai.embedder.ts                  # optional, gated on API key (Phase 5+)
└── knn/
    └── in-memory-cosine.ts                 # full-scan KNN (fine to ~50K)

packages/server/src/recommendations/strategies/embedding.strategy.ts
packages/server/src/recommendations/jobs/embedding.job.ts
```

### 3.3 Server modifications

- `package.json` — add `@xenova/transformers`. Model file (~80 MB) downloads on first use to `data/models/`.
- `events.service.ts` subscriber — `MOVIE_METADATA_UPDATED` → enqueue `EmbeddingJob` for that movie.
- `recommendations.service.ts` — add `embedding.strategy.ts` to the active list when an embedder is configured.

### 3.4 Provider registration

`MiniLMLocalEmbedder` registers itself with `capabilities: {'embed'}`, `auth: 'none'`, `rateLimit: { perSecond: 50 }` (CPU-bound estimate). It's always "configured" (no key required) but `isConfigured()` returns false until the model has downloaded — which lets the admin see "Downloading model… (43 MB / 80 MB)" in Connections.

### 3.5 KNN concerns

For libraries ≤ 50K movies, in-memory full-scan cosine over Float32 BLOBs is <50 ms. Re-load vectors on service start; refresh incrementally when `EmbeddingJob` updates rows. No external vector DB.

For >50K vectors, switch to `sqlite-vec`. Hidden behind `EmbeddingStore` — orchestrator code unchanged.

### 3.6 Client modifications

- Connections page — embedding card shows model download progress, "Embed entire library" button (admin trigger).
- Matching page — embedding weight slider becomes active; "Embed on scan" toggle in auto-enrichment section.

### 3.7 Tests

- `minilm-local.embedder.spec.ts` — embeds known input, deterministic vector (within FP tolerance), dim = 384.
- `in-memory-cosine.spec.ts` — known neighbours from a 20-movie synthetic corpus.
- `embedding.job.spec.ts` — idempotent (re-running for same movie + unchanged plot = no-op), staleness detection via `source_text` hash.

### 3.8 Acceptance criteria

- [ ] First server boot triggers model download with progress visible in admin UI.
- [ ] After enabling "Embed on scan", a library re-scan populates `movie_embeddings` for every movie with a plot.
- [ ] "Similar Movies" rail visibly improves on plot-similar films (e.g. *Arrival* surfaces *Contact*, *Interstellar*, not just franchise mates).
- [ ] Embedding strategy can be weighted to 0 and recs still work (fallback to content-vector + cache).

### 3.9 Out of scope

- Cloud embedding providers (OpenAI, Voyage) — those are Phase 5.
- `sqlite-vec` integration (deferred until needed).
- Hierarchical / Matryoshka truncation.

---

## Phase 4 — Multi-input / playlist similarity

**Goal:** "Find more like *this set*" — for playlists, collections, and ad-hoc multi-select.

**Effort:** 2–3 working days.

**Dependencies:** Phase 3 (centroid embedding is the cleanest signal; falls back gracefully if Phase 3 not deployed).

### 4.1 Server files

New:
- `packages/server/src/recommendations/multi-input.service.ts`
- `packages/server/src/recommendations/scoring/centroid.ts`
- `packages/server/src/recommendations/scoring/variance.ts`

Modify:
- `recommendations.controller.ts` — implement the previously-stubbed `POST /recommendations/multi` and `GET /recommendations/playlist/:id`.

### 4.2 Algorithm

1. Embed each input (or pull cached embeddings).
2. Compute centroid + intra-set cosine variance.
3. If variance < threshold (homogeneous set) — KNN against centroid + MMR.
4. If variance ≥ threshold (heterogeneous set) — union-of-neighbours: KNN each input separately, merge by reciprocal-rank fusion, MMR.
5. Apply standard filters (exclude inputs, same-group exclude, quality floor).

`Settings → Matching` exposes the variance threshold and the policy override (*Centroid* / *Union* / *Auto*).

### 4.3 Client modifications

- `pages/PlaylistDetail.tsx` — "Add similar" button → modal showing top-20 centroid suggestions with checkboxes.
- `pages/Library.tsx` — multi-select mode (already exists for some flows?) → "Recommend more like these".

### 4.4 Tests

- `centroid.spec.ts` — known input embeddings produce expected centroid.
- `variance.spec.ts` — homogeneous vs heterogeneous detection.
- Integration — given a 5-movie playlist, returns sensible recs that exclude all 5.

### 4.5 Acceptance criteria

- [ ] Adding 3 movies of similar tone to a playlist and clicking "Add similar" surfaces ≥5 tonally adjacent suggestions.
- [ ] Adding 3 movies across genres switches to union-of-neighbours and returns a more eclectic mix.
- [ ] Variance threshold slider visibly changes behaviour on a borderline-mixed playlist.

### 4.6 Out of scope

- "Negative examples" (movies you didn't like) — could be a Phase 4b.

---

## Phase 5 — LLM enrichment + re-rank + "Why" explanations

**Goal:** Optional, paid-API quality boost. Off by default; enabling it requires the admin to add an LLM credential AND opt in.

**Effort:** 4–6 working days.

**Dependencies:** Phase 1 (for the candidate pool), Phase 3 helpful but not required.

### 5.1 Schema

```sql
CREATE TABLE IF NOT EXISTS movie_llm_features (
  movie_id     TEXT NOT NULL,
  model        TEXT NOT NULL,            -- 'claude-sonnet-4-6'
  features     TEXT NOT NULL,            -- JSON: { tone, pace, themes, audience, comparables }
  cost_usd     REAL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (movie_id, model)
);

CREATE TABLE IF NOT EXISTS movie_rec_explanations (
  seed_id      TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  model        TEXT NOT NULL,
  explanation  TEXT NOT NULL,
  cost_usd     REAL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (seed_id, target_id, model)
);
```

### 5.2 Server files

```
packages/server/src/providers/sources/llm/
├── llm.types.ts                          # shared LLMClient contracts
├── anthropic.client.ts                   # @RegisterProvider LLMClient (Claude)
├── openai.client.ts                      # optional, same interface
└── local-ollama.client.ts                # optional, free local

packages/server/src/recommendations/strategies/llm-rerank.strategy.ts
packages/server/src/recommendations/jobs/llm-features.job.ts
packages/server/src/recommendations/jobs/llm-explain.job.ts
packages/server/src/recommendations/llm-features.repository.ts
packages/server/src/recommendations/explanations.repository.ts
```

### 5.3 LLMClient contract

```ts
interface LLMClient extends Provider {
  rerank(seed: Movie, candidates: Movie[], opts: { withWhy?: boolean }): Promise<RankedResult[]>;
  features(movie: Movie): Promise<MovieFeatures>;       // tone/pace/themes/audience/comparables
  explain(seed: Movie, target: Movie): Promise<string>; // one-line "why"
}
```

All three operations honour:
- `costPerCall` from `RateLimitSpec` for budget tracking.
- `monthlyBudgetUsd` ceiling.
- Prompt caching for the seed-movie context (Claude SDK feature) — reduces re-rank cost 5–10×.

### 5.4 Provider registration & budgets

Each LLM provider declares its model, cost-per-1M-tokens, and a default `monthlyBudgetUsd: 5` (configurable). The rate limiter tracks `cost_usd` per call.

### 5.5 Job behaviour

- `LlmFeaturesJob` — runs once per (movie, model) when the metadata event fires AND the admin has opted in. Cost: pennies for the whole library.
- `LlmExplainJob` — runs **on demand** when the user opens a movie detail, for the top-N recs that don't already have a cached explanation. Cost: sub-cent per movie view.
- Re-rank strategy runs synchronously inside `recommendations.service.ts` when an LLMClient is active AND `useReRank=true` in matching settings. Adds ~1 s latency; cached in `movie_rec_explanations`.

### 5.6 Client modifications

- Connections page — LLM provider cards (Anthropic, OpenAI, Ollama). Form auto-generated from `configFields`. Monthly budget input.
- Matching page — "Re-rank with LLM" toggle, "Show one-line explanations" toggle, monthly budget display with progress bar.
- `SimilarMoviesRail.tsx` — render explanation as a tooltip / caption when present.

### 5.7 Tests

- Each LLMClient: mock HTTP, assert request shape, parse response, record cost.
- Budget enforcement: simulated over-budget call throws `BudgetExhausted`, recorded in `provider_events`.
- Re-rank determinism (with `temperature=0`).
- Explanation generation idempotency.

### 5.8 Acceptance criteria

- [ ] With no LLM configured, recommendations work exactly as before Phase 5.
- [ ] Adding an Anthropic key + enabling re-rank — top results visibly improve on subtle thematic matches (manual judgement).
- [ ] Explanations render in the rail.
- [ ] Setting monthly budget to $0.01 — re-rank disables itself after ~10 calls; admin sees clear "Budget exhausted" status.

### 5.9 Out of scope

- Personalised re-rank (incorporating user history) — privacy-sensitive, Phase 5b.
- Multi-LLM ensemble re-rank.

---

## Phase 6 — Collaborative filtering (deferred until scale)

**Goal:** Item-item co-occurrence boost when the multi-user federation has enough signal.

**Effort:** 2–3 working days when warranted.

**Dependencies:** Multi-user adoption (this phase is gated on "do we have hundreds of users with meaningful watch history?").

### 6.1 Schema

```sql
CREATE TABLE IF NOT EXISTS movie_cooccurrence (
  a_id         TEXT NOT NULL,
  b_id         TEXT NOT NULL,
  score        REAL NOT NULL,
  support      INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE INDEX IF NOT EXISTS cooc_a_idx ON movie_cooccurrence(a_id);
```

### 6.2 Server files

```
packages/server/src/recommendations/strategies/collaborative.strategy.ts
packages/server/src/recommendations/jobs/cooccurrence-rebuild.job.ts
```

### 6.3 Algorithm

Nightly job rebuilds cooccurrence over `user_watch_history` + `user_watchlist`. Top-K per movie. Strategy returns scores blended with content sim:

```
final = α · content + (1-α) · cf,  α = 1 / (1 + log(1 + cf_support))
```

### 6.4 Acceptance criteria

- [ ] Strategy returns nothing when `cf_support < threshold` — graceful degradation.
- [ ] Cooccurrence job completes in <60 s on a 100K-row watch history.

---

## Phase 7 (optional) — MovieLens tag-genome import

**Goal:** Free, offline, ~1100-dimension feature vector for every TMDB-matched movie. Strongest non-LLM semantic signal we can get.

**Effort:** 2–3 working days.

**Dependencies:** Phase 3 (uses the same EmbeddingStore abstraction).

### 7.1 Schema

```sql
CREATE TABLE IF NOT EXISTS movielens_tag_scores (
  movie_id     TEXT NOT NULL,
  tag          TEXT NOT NULL,
  relevance    REAL NOT NULL,
  PRIMARY KEY (movie_id, tag)
);
CREATE INDEX IF NOT EXISTS movielens_tag_idx ON movielens_tag_scores(tag);
```

(Alternative: store as a 1100-dim `Float32` BLOB in `movie_embeddings` with `model = 'movielens-tag-genome'` — same store, same KNN, no new code.)

### 7.2 Server files

```
packages/server/src/recommendations/import/
├── movielens-genome-import.command.ts    # CLI: download + ingest
└── movielens-id-mapping.ts                # MovieLens → IMDb join
```

### 7.3 Acceptance criteria

- [ ] Admin runs `pnpm import:movielens` (or button in admin dashboard).
- [ ] Coverage: ≥80% of library movies receive tag scores.
- [ ] Recommendations using genome similarity surface unexpectedly good matches on niche/older films.

---

## Cross-cutting work items

These don't fit cleanly in any one phase but should land during Phases 0–3:

### CC.1 — `app_settings` table for tuning parameters

Used by `Settings → Matching` to persist strategy weights, λ, quality floor, exclusions, auto-enrichment toggles.

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

Or extend the existing `settings` table if its shape allows (check `database/schema/settings.ts`).

### CC.2 — `MOVIE_METADATA_UPDATED` event audit

Search the codebase for any other place metadata is finalised (admin "Refresh metadata", manual edit) and ensure all paths emit the event. The grouping detector subscribed via `LIBRARY_MOVIE_ADDED` — recommendations needs the broader `_UPDATED`.

### CC.3 — `mu-server` config-yml deprecation note

Any existing TMDB / OMDB key handling in `data/config/config.yml` should be **read-only / fallback**. The Connections page is the new source of truth. Migration: on first boot after Phase 0, copy keys from `config.yml` into `provider_credentials` if not already present, then leave the YAML alone for backward compat.

### CC.4 — Observability surfaces

After Phase 0 the per-card sparkline lands. After Phase 2 add the "Providers" tab to AdminDashboard with:
- Per-provider call volume (7d/30d), error rate, p95 latency.
- Quota progress bars.
- Monthly $ spent vs ceiling for paid providers.
- Recent errors table with one-click retry / disable.

### CC.5 — Job-runner integration with rate limits

Audit `JobManagerService` to make sure jobs can specify `provider: 'trakt'` (or similar). The runner consults `RateLimitService.acquire()` before invoking the job; on `RateLimitExceeded`, requeues with `runAfter = retryAfterMs`. Add a small wrapper if the current job runner doesn't accept this.

### CC.6 — Tests for graceful degradation

A integration test that:
1. Spins up the server with **zero** providers configured.
2. Calls `GET /recommendations/movie/:id` for a fully-metadata-populated movie.
3. Asserts the response is non-empty and `usedSources` is `['content-vector']`.

### CC.7 — Postgres dry-run

After Phase 3, run the Drizzle schema against a Postgres test container to verify the dialect-portable conventions hold. Don't ship Postgres support — just prove the schema would migrate cleanly.

---

## Timeline summary

| Phase | Effort | Cumulative | User-visible? |
|---|---|---|---|
| 0 — Provider platform | 2–3 d | 2–3 d | Admin UX only |
| 1 — TMDB cache + content vectors | 1–2 d | 3–5 d | ✅ Similar rail |
| 2 — Trakt provider | 1–2 d | 4–7 d | ✅ Better blends |
| 3 — Local embeddings | 3–5 d | 7–12 d | ✅ Quality jump |
| 4 — Multi-input / playlist | 2–3 d | 9–15 d | ✅ Playlist UX |
| 5 — LLM enrich + re-rank | 4–6 d | 13–21 d | ✅ Optional polish |
| 6 — Collaborative filtering | 2–3 d | — | Deferred |
| 7 — MovieLens import | 2–3 d | — | Optional |

A reasonable ship cadence: 0+1 in one PR (foundation + the user-facing rail), 2 in a follow-up, 3 when ready to invest the model-bundling effort, 4 alongside playlist polish, 5 as an opt-in beta once at least one user wants it. Phases 6 and 7 stay on the shelf until their preconditions are real.

---

## Open questions to answer before starting Phase 0

1. **Settings sub-navigation pattern.** Is `pages/Settings.tsx` currently a tabbed page, a sidebar nav, or separate routes per setting area? Phase 0 should match the existing pattern, not invent a new one.
2. **Is there an existing `app_settings` / generic key-value table?** Check `database/schema/settings.ts`. If yes, reuse it. If no, CC.1 lands in Phase 0.
3. **Does `JobManagerService` already support `runAfter` and per-job retry?** If yes, CC.5 is a small adapter. If no, we add a thin wrapper in Phase 0 — don't refactor the existing queue.
4. **`EventsService.MOVIE_METADATA_UPDATED` — does this event exist?** If not, add it in Phase 0 alongside the existing `LIBRARY_MOVIE_ADDED`.
5. **Admin auth gate.** Confirm we have a `@Roles('admin')` decorator / guard for the new endpoints. If not, reuse whatever pattern the existing `AdminController` uses.

These are 30-minute investigations the first task in Phase 0 should resolve before any code lands.
