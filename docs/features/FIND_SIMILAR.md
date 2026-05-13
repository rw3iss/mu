# "Find Similar Movies" — Research & Design

**Status:** research / design notes
**Goal:** Given (a) a single movie or (b) a set of movies (playlist, collection, season), return a ranked list of other movies the user is likely to enjoy. Operate against both the local library (most useful for streaming hosts) and external catalogs (for discovery / wishlist-building).

This doc surveys every reasonable approach, where each one shines and breaks, what's free vs paid, what fits the existing Mu codebase, and ends with a recommended phased rollout.

---

## 1. What we already have

Before designing anything new, note what's already on disk and reusable:

| Signal | Where | Notes |
|---|---|---|
| TMDB `/similar` + `/recommendations` | `metadata.service.ts` already calls `append_to_response: ...,similar,...` (`tmdb.provider.ts:122`) | Free, already integrated, but the response is currently **not persisted** — we throw it away after detail-merge. Cheapest possible win is to start saving it. |
| Genres, cast, directors, writers, keywords, production companies | `movie_metadata.cast_members / directors / writers / keywords / production_companies / genres` (TEXT JSON) | Already populated for every TMDB-matched movie. Ready to be turned into feature vectors. |
| Plot / tagline / overview | `movies.overview`, `movies.tagline` | Text — embeddable. |
| Ratings (IMDb, TMDB, RT, Metacritic) | `movie_metadata.*_rating` | Useful as a soft prior — bad films don't get recommended just because they share a cast. |
| Watch history, watchlist, user ratings | `user_watch_history`, `user_watchlist`, `user_ratings` | Raw material for collaborative filtering and a personalised re-ranker. |
| Group / series links | `movie_groups` + `movies.group_id` | We can boost or exclude siblings (don't recommend "Lord of the Rings 2" when watching "Lord of the Rings 1" — surface the next episode/season via the group view instead). |

That table alone implies the **lowest-effort high-quality v1**: persist `/similar` + `/recommendations`, combine with internal feature vectors built from columns already in `movie_metadata`, and ship.

---

## 2. External APIs (catalog + recommendation sources)

All free unless flagged. Rate limits are 2026 figures and tend to drift — verify before depending on them.

### 2.1 TMDB — already integrated

- `GET /3/movie/{id}/similar` — surface-features algorithm (genre, keywords)
- `GET /3/movie/{id}/recommendations` — **different** algorithm, behavior-driven, generally higher quality
- `GET /3/movie/{id}/keywords` — for keyword-overlap scoring (we already pull this inline)
- `GET /3/movie/{id}/watch/providers` — useful for cross-linking with what's actually streamable

**Strengths:** free, generous limits (~40 req/10 s/IP), excellent coverage, already wired.
**Weaknesses:** algorithm is opaque, sometimes leans on franchise/sequel correlation, no per-user personalisation.

### 2.2 Trakt.tv

- `GET /movies/{id}/related` — community-curated "people who watched X also watched"
- `GET /users/me/recommendations/movies` — personalised if the user has connected an account
- `GET /movies/{id}/lists` — find user-made lists containing this movie, then mine those lists for other films

**Strengths:** very different signal from TMDB (actual user co-watch behavior at scale), high-quality for popular and arthouse alike.
**Weaknesses:** needs API key + OAuth for personalised endpoints, rate-limited (~1 req/sec for app-level).

### 2.3 MovieLens / GroupLens datasets (offline)

- Static dataset downloads (small: 100K ratings / 9K movies, large: 33M ratings / 86K movies)
- `tag-genome-2021.csv` is the gem: ~1,100 dimensions of human-curated tags scored 0–1 for every movie (e.g. *"slow-paced"*, *"based on a book"*, *"unreliable narrator"*)

**Strengths:** the tag-genome is ready-made embedding space — drop the row vector in and cosine-similarity works immediately. Free, no rate limits, no API.
**Weaknesses:** offline (need to refresh periodically); coverage skews older / English-language; matching to our movies requires IMDb-ID join.

### 2.4 OMDB

We already use it. Limited recommendation surface — mostly metadata. Useful as a tiebreaker (RT/Metacritic scores) but not a primary recommender.

### 2.5 TasteDive / Qloo

- `GET /api/similar?q=movie:Inception,movie:Interstellar&info=1` — multi-entity input → cross-domain output
- Free tier: 300 requests/day

**Strengths:** designed for the "given a list, return similar" use case we need for playlists/collections. Cross-domain (movies, music, books, games) is overkill for us but the movie endpoint alone is strong.
**Weaknesses:** generous free tier is now metered; quality is decent but not as deep as Trakt for niche films.

### 2.6 Wikidata / DBpedia (SPARQL)

Open-data graph queries — given an `imdbId` or `wikidataId`, traverse:

- shared director / writer / production company
- adapted from same source novel
- award co-nominees
- shared cinematographer, composer, etc.

**Strengths:** free, structured, surfaces relationships no commercial API exposes (e.g. "other films scored by Jóhann Jóhannsson").
**Weaknesses:** SPARQL endpoint can be flaky; matching coverage trails TMDB for new releases; you write more code.

### 2.7 What's NOT realistic

- **Netflix / Letterboxd / Reelgood APIs** — no public similarity API. Letterboxd has rich tag/list data but no terms-of-service-clean way to mine it.
- **JustWatch** — availability only, no similarity.

### 2.8 Summary recommendation for external sources

Use **TMDB `/similar` + `/recommendations`** as the baseline (already integrated, free, decent), augment with **Trakt `/related`** for diversity (very different algorithm), and treat **MovieLens tag-genome** as the gold-standard feature vector source for any movie we can ID-join.

---

## 3. Internal embedding / feature-vector similarity

This is the biggest leverage point: every row in `movie_metadata` is already a half-built feature vector. The question is what mix of cheap and expensive features to combine.

### 3.1 Sparse multi-hot vectors from existing columns

| Feature | Dimensionality | Encoding | Distance |
|---|---|---|---|
| Genre | ~20 | multi-hot | cosine or Jaccard |
| Keywords (TMDB) | ~50K vocab, ~10 per movie | sparse multi-hot, optional TF-IDF | cosine |
| Cast (top-N, weighted by billing order) | ~1M people, ~10 per movie | sparse multi-hot | cosine (weighted) |
| Director, writers | ~100K | sparse multi-hot | Jaccard, weighted heavier than cast |
| Production company | ~10K | sparse multi-hot, low weight | Jaccard |
| Year proximity | scalar | `exp(-Δyears / σ)` | direct |
| Runtime proximity | scalar | `exp(-Δminutes / σ)` | direct, low weight |
| Rating bucket | ordinal | bucket distance | low weight (soft prior, not strong signal) |
| Country / language | small vocab | one-hot | optional, lifestyle prior |

These can be computed entirely on-the-fly from the existing `movie_metadata` table — no new storage, no models, no API. The composite score:

```
sim(A, B) = w_g · genre(A,B)
          + w_k · keywords(A,B)
          + w_c · cast(A,B)
          + w_d · director(A,B)
          + w_p · companies(A,B)
          + w_y · year(A,B)
          + w_r · runtime(A,B)
```

Starting weights (tune later): `w_k=0.30, w_c=0.20, w_g=0.20, w_d=0.10, w_p=0.05, w_y=0.05, w_r=0.10`.

**This alone is plausibly competitive with TMDB `/similar`** for our use case, costs zero external calls, and runs in tens of ms for a library of a few thousand titles.

### 3.2 Dense plot embeddings (text → vector)

The `overview` (TMDB plot) and `tagline` fields are gold for semantic similarity ("two films about grief, even though one is sci-fi and one is a drama").

Options, from "ship today" to "perfect quality":

| Approach | Where it runs | Vector dim | Cost | Notes |
|---|---|---|---|---|
| `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` | In-process Node, CPU | 384 | free | ~80 MB model. Fast enough for batch + on-demand. Already a popular choice for self-hosted apps. |
| `nomic-embed-text-v1.5` via `@xenova/transformers` or local Ollama | CPU or local Ollama | 768 | free | Larger, slightly better, supports Matryoshka truncation to 256/128. |
| `bge-m3` via local Ollama / llama.cpp | Local GPU/CPU | 1024 | free if you have hardware | Best open-weight English+multilingual embed model as of late 2025. |
| OpenAI `text-embedding-3-small` | API | 1536 (or truncated) | ~$0.02 per million tokens | Cheapest paid option, excellent quality. Plot summaries are tiny — a full library is cents. |
| Voyage AI `voyage-3-lite` | API | 512 | ~$0.02 per million tokens | Often top of MTEB leaderboards for retrieval. |

Anthropic does **not** ship an embedding endpoint — for Claude users this means: use a local model, or call out to OpenAI/Voyage/Cohere/Jina alongside Claude for the LLM-flavored steps.

#### Storage in SQLite

We're already on `better-sqlite3`. Two reasonable paths:

1. **`sqlite-vec`** (modern, actively maintained — supersedes `sqlite-vss`). Ships as a loadable extension. Native `vec0` virtual tables with `MATCH` queries.
   ```sql
   CREATE VIRTUAL TABLE movie_plot_vec USING vec0(
       movie_id TEXT PRIMARY KEY,
       embedding FLOAT[384]
   );
   SELECT movie_id, distance FROM movie_plot_vec
       WHERE embedding MATCH ? ORDER BY distance LIMIT 50;
   ```
   Pros: sub-ms queries, no extra service, scales fine to 100K+ vectors.
   Cons: a loadable extension to ship (we already control the binary, so this is fine).

2. **Plain BLOB column + in-memory cosine.** Store `Float32Array.buffer` directly. For a few-thousand-movie library, a full scan in Node is still <10 ms. No new dependency. Easiest to ship. Pick this for v1; migrate to `sqlite-vec` if/when libraries cross ~50K movies.

### 3.3 Centroid / multi-input similarity (for playlists & collections)

For a playlist/collection as input:

1. Compute embedding for each input movie.
2. Compute the **centroid** (mean vector) — or, if some inputs are more "central" than others, a weighted centroid.
3. Find nearest neighbors to the centroid in the library / external catalog.
4. Filter out the input movies themselves.
5. Re-rank with **Maximum Marginal Relevance (MMR)** to avoid returning 10 near-duplicates:
   ```
   MMR(d) = λ · sim(d, centroid) − (1−λ) · max_{s in selected} sim(d, s)
   ```
   `λ=0.7` is a reasonable default.

Centroid + MMR is the standard, well-validated approach for "given a set, find more like this set."

For very heterogeneous inputs (a playlist mixing horror and romance), the centroid drifts to nowhere. Detect this with the **input-set variance**: if intra-set similarity is low, switch to a *union-of-neighbors* strategy (find neighbors of each input, merge with vote-counting) instead of centroid.

### 3.4 Diversity & exclusion filters

After scoring, apply:

- Exclude movies already in the input set.
- Exclude movies in the same `group_id` (don't recommend the next franchise entry — surface that via the group view).
- Cap per-director / per-actor (no more than 2 results sharing the same director).
- Quality floor: drop anything with `imdb_rating < N` unless explicitly opted in.
- Already-watched penalty (drop, or push to the bottom with a "you've seen this" flag).
- Optional: same-decade boost, same-language boost — both configurable.

### 3.5 Cold start

A brand-new movie with no metadata still has its filename and folder structure (used by the grouping detectors). Until metadata lands, fall back to:
- TMDB title search for nearest catalog match.
- Group-based suggestion: if the file is grouped (`group_id` set), recommend members of the same group or sibling groups.

---

## 4. Collaborative filtering (user behaviour)

We have `user_watch_history`, `user_watchlist`, and `user_ratings`. With even a modest user base this enables proper CF.

### 4.1 Item-item CF (the practical choice)

For every pair of movies, count co-occurrences in user histories / watchlists, normalise to cosine similarity over the user dimension. This is what Amazon's "Customers who bought X also bought Y" runs on — robust, no training, easy to incrementalise.

```
sim(A, B) = |users(A) ∩ users(B)|  /  sqrt(|users(A)| · |users(B)|)
```

Stored once per pair in a `movie_cooccurrence` table (capped at top-K per movie to keep size bounded).

**When this works:** as soon as you have ~hundreds of users with non-trivial histories. For a personal/family-only Mu install with 1–4 users, CF signal is too sparse — skip it and lean on content-based similarity.

### 4.2 User-user CF

Cosine over user profiles → recommend movies your nearest user has watched that you haven't. Stronger personalisation, weaker explainability ("recommended because user X liked it"). Mostly skip for self-hosted.

### 4.3 Matrix factorisation / ALS

Overkill for the scale. Mention only for completeness.

### 4.4 The hybrid sweet spot

For multi-user installs (federation across remote servers!), use content-based as the base, and let item-item CF act as a re-ranking boost when there's enough signal:

```
final_score = α · content_sim + (1−α) · cf_sim
α = 1 / (1 + log(1 + cf_support))   # CF weight grows with how much co-watch data exists
```

---

## 5. AI / LLM-based approaches

LLMs can absolutely help here, but **where** you use them matters a lot.

### 5.1 Bad idea: LLM as primary recommender

Asking "What are 10 movies similar to *Arrival*?" and trusting the output:
- Hallucinates movie titles (especially years and lesser-known films).
- Costs a meaningful $ / latency per request.
- Output not grounded in *our library*.

Don't do this as the core mechanic.

### 5.2 Good idea: LLM as re-ranker

Pipeline:
1. Generate 30–50 candidates via TMDB + embeddings + CF (cheap).
2. Pass to LLM with the seed movie + each candidate's plot + the user's history if available.
3. Ask it to **rank, with one-sentence justifications**, and optionally cluster ("3 with similar tone", "3 with similar plot mechanics", etc.).

This is the same pattern Spotify, Pinterest, and others use: cheap recall, expensive re-rank.

**Latency:** Claude Haiku can do this in ~1 s for 30 candidates with prompt caching on the seed metadata. Cost is fractions of a cent per query.

### 5.3 Better idea: LLM as feature extractor (one-time, batched)

Use an LLM **once per movie**, during library scan / metadata fetch, to extract structured features the catalog APIs don't expose:

- Tone (`bleak / hopeful / playful / melancholic / ...`)
- Pace (`slow / measured / brisk / frenetic`)
- Themes (`grief, redemption, identity, surveillance, ...`)
- Audience signal (`prestige / popcorn / cult / family`)
- "Comparable to X, Y, Z" canonical references

Store as a `movie_llm_features` table (JSON). These become high-signal axes in the feature vector — and once extracted, they're free to use forever.

This is the cleanest LLM integration: **expensive once, cheap thereafter**, and it raises the ceiling of every downstream method (content sim, centroid, re-rank).

### 5.4 Generative explanation layer

Independent of ranking: once we have the top results, ask the LLM to write a one-sentence "Why" for each — *"Both are quiet sci-fi character pieces about communication across an unbridgeable gap."* Explanations dramatically lift perceived recommendation quality even if the underlying ranking is unchanged. Cheap, easy, very effective UX.

### 5.5 Models worth considering

- **Claude Haiku 4.5** — re-ranking, explanations. Fast, cheap, plays well with prompt caching for seed-movie context.
- **Claude Sonnet 4.6** — feature extraction (one-time, quality matters more than cost here).
- **Local Ollama (`llama3.1:8b`, `qwen2.5:7b`)** — for users who don't want cloud. Slower, lower quality on subtle taste judgments, but free.

---

## 6. Putting it together — architecture sketch

A new NestJS module `recommendations` (sibling to `movies`, `metadata`, `grouping`).

```
src/packages/server/src/recommendations/
  recommendations.module.ts
  recommendations.controller.ts        # GET /recommendations/movie/:id
                                       # POST /recommendations/multi  (body: { movieIds: [...] })
                                       # GET  /recommendations/playlist/:id
  recommendations.service.ts           # orchestrator
  strategies/
    tmdb-similar.strategy.ts           # wraps existing TmdbProvider
    trakt-related.strategy.ts          # new, optional
    content-vector.strategy.ts         # sparse-feature scoring from movie_metadata
    plot-embedding.strategy.ts         # dense embeddings (sqlite-vec or in-memory)
    collaborative.strategy.ts          # item-item CF (optional, gated by user count)
    llm-rerank.strategy.ts             # optional, gated by API key presence
  scoring/
    composite-scorer.ts                # weighted combination + MMR diversity
    filters.ts                         # group/exclusion/quality/already-watched filters
  embeddings/
    embedding-service.ts               # local or remote; pluggable backends
    embedding-store.ts                 # BLOB column v1, sqlite-vec later
```

Each strategy is a thin adapter implementing:

```ts
interface SimilarityStrategy {
  readonly name: string;
  readonly available: boolean;          // false if API key missing, model not loaded, etc.
  score(seed: Seed, candidates: Movie[]): Promise<Map<string, number>>;
}
```

The orchestrator runs available strategies (in parallel where possible), normalises scores to `[0,1]` per strategy, combines them with user-configurable weights from `settings`, applies filters, applies MMR, returns top K.

### New schema (3 small additions)

```sql
-- Cached external recommendations (TMDB similar/recs, Trakt related)
CREATE TABLE movie_external_recs (
  movie_id     TEXT NOT NULL,
  source       TEXT NOT NULL,           -- 'tmdb_similar' | 'tmdb_rec' | 'trakt_related'
  rank         INTEGER NOT NULL,
  target_tmdb  INTEGER,
  target_imdb  TEXT,
  target_title TEXT,
  raw          TEXT,                    -- JSON
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (movie_id, source, rank)
);

-- Plot embeddings (BLOB v1; migrate to sqlite-vec when needed)
CREATE TABLE movie_embeddings (
  movie_id     TEXT PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,           -- e.g. 'minilm-l6-v2'
  dim          INTEGER NOT NULL,
  vector       BLOB NOT NULL,           -- Float32 little-endian
  updated_at   TEXT NOT NULL
);

-- Item-item co-occurrence (only if multi-user CF is enabled)
CREATE TABLE movie_cooccurrence (
  a_id         TEXT NOT NULL,
  b_id         TEXT NOT NULL,
  score        REAL NOT NULL,
  support      INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE INDEX cooc_a_idx ON movie_cooccurrence(a_id);
```

### Background jobs (reuse existing `jobs` module)

- `RecommendationsRefreshJob` — periodically refresh external recs for recently watched movies.
- `EmbedMoviesJob` — compute plot embeddings on library scan; runs incrementally on new metadata.
- `CooccurrenceJob` — nightly recompute (cheap; matrix is small).
- `LlmFeaturesJob` — opt-in, runs once per movie if an API key is configured.

### Client UX

- `MovieDetail` page: a new "Similar" rail below the existing metadata, lazy-loaded.
- `Playlist` / `Collection` view: an "Add similar" button → modal showing top centroid-based suggestions with checkboxes.
- `Library` page: optional "Because you watched X" row (uses recent watch history).
- Per-result: tiny one-line LLM explanation if available, otherwise show the dominant signal (e.g. *"shares director, 4 cast"*) as a fallback.

---

## 6.5 Architectural deepening — providers, rate limits, settings, Postgres

The §6 sketch covers *what*. This section covers *how* — the SOLID contracts every source implements, the cross-cutting concerns (rate limits, retries, secrets, budgets), and the abstractions that let us swap SQLite for Postgres later without rewriting every module.

### One contract per kind of source

Three kinds of external help, four interfaces:

```ts
// Shared by every provider — declarative metadata + lifecycle
interface Provider {
  readonly id: string;                          // 'tmdb' | 'trakt' | 'openai-embed' | …
  readonly displayName: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly auth: 'apiKey' | 'oauth' | 'none';
  readonly configFields: ConfigFieldSpec[];     // declarative — drives the UI form
  readonly rateLimit: RateLimitSpec;            // declarative — drives the limiter
  isConfigured(): boolean;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

type Capability =
  | 'recommend'   // returns similar movies for a seed
  | 'enrich'      // returns extra metadata (keywords, themes, ratings)
  | 'embed'       // produces vectors from text
  | 'rerank'      // reorders candidates against a seed
  | 'explain';    // produces a one-line "why X is similar to Y"

interface Recommender extends Provider {
  recommend(seed: Movie, k: number): Promise<Recommendation[]>;
}
interface Enricher extends Provider {
  enrich(movie: Movie, want: ReadonlySet<EnrichField>): Promise<EnrichResult>;
}
interface Embedder extends Provider {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
interface LLMClient extends Provider {
  rerank(seed: Movie, candidates: Movie[]): Promise<RankedResult[]>;
  features(movie: Movie): Promise<MovieFeatures>;
  explain(seed: Movie, target: Movie): Promise<string>;
}
```

A single `ProviderRegistry` is where modules look up providers by capability — **no code ever imports a concrete provider class for recommendations**, it goes through the registry:

```ts
const recommenders = registry.list('recommend').filter((p) => p.isConfigured());
```

Adding a new source is one file: implement the interface(s), decorate with `@RegisterProvider`, register in the providers module. The orchestrator, settings UI, rate limiter, and observability surface pick it up automatically. This is the Open/Closed payoff — adding "MovieDB Pro 9000" later requires zero changes outside its own file.

### Rate limiting, retries & budgets

Cross-cutting concern, decoupled from every provider, lives in `RateLimitService`:

```ts
interface RateLimitSpec {
  perSecond?: number;
  perMinute?: number;
  perDay?: number;
  perMonth?: number;
  costPerCall?: number;        // estimated $ for budget calculations
  monthlyBudgetUsd?: number;   // hard ceiling (paid providers only)
}

await rateLimit.acquire('trakt', { cost: 1 });   // throws RateLimitExceeded if over
```

State persists to `provider_usage` (token-bucket counters keyed by window — minute/day/month buckets). Daily/monthly windows survive restarts; sub-second buckets are in-memory only.

**On 429 / quota-exhausted:**
- HTTP client honours `Retry-After` when present.
- Job-queue calls catch `RateLimitExceeded`, requeue with `runAfter = now + retryAfter` (or next bucket reset), exponential backoff with jitter capped at 30 min.
- After N consecutive failures (configurable), provider is flagged `cooled-down` for an hour; `healthCheck` reflects this in the UI.

**Budget caps (paid LLMs):** every call records estimated `cost_usd`. If projected monthly spend exceeds the user-set ceiling, the provider returns "budget exhausted" without making the call.

### API key storage & secrets

```sql
CREATE TABLE provider_credentials (
  provider_id  TEXT PRIMARY KEY,
  config       TEXT NOT NULL,             -- JSON: {client_id, client_secret, api_key, …}
  enabled      INTEGER NOT NULL DEFAULT 1,
  encrypted    INTEGER NOT NULL DEFAULT 0,
  added_at     TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

`ProviderCredentialsService` owns this table:
- Admin-only mutation endpoints.
- Reads return **masked** secrets (`sk-xxxx…ab12`) except when the provider is making an outbound call.
- v1: cleartext at rest (server is private, behind auth).
- v2 upgrade: AES-GCM with a key derived from `MU_SECRETS_KEY` env var; the `encrypted` flag is the migration switch. No callsite changes.

### Postgres-ready data layer

Today: SQLite + Drizzle. Future: same schema, Postgres dialect. Conventions so we don't paint into a corner:

- **No SQLite-only SQL functions.** No `datetime('now')`, `strftime`, `unixepoch()`. Compute timestamps in JS, store as ISO strings (already the convention).
- **JSON columns** use Drizzle `text({ mode: 'json' })`. On Postgres we swap to `jsonb` per column — one schema edit, no app-code change.
- **Booleans**: `integer({ mode: 'boolean' })` — Drizzle handles the Postgres bool transparently.
- **UUIDs everywhere**, no `last_insert_rowid()`.
- **Vectors hide behind `EmbeddingStore`:**
  ```ts
  interface EmbeddingStore {
    upsert(movieId: string, model: string, vec: Float32Array): Promise<void>;
    get(movieId: string, model: string): Promise<Float32Array | null>;
    knn(query: Float32Array, model: string, k: number, filter?: KnnFilter): Promise<KnnHit[]>;
  }
  ```
  v1: `SqliteBlobEmbeddingStore` — Float32 BLOBs, in-memory cosine (fine to ~50K vectors).
  Future: `PgVectorEmbeddingStore` — native `vector(384)` + `<->` operator. Or `SqliteVecEmbeddingStore` if we stay on SQLite at scale. Same interface, swap at module bind time.

### Lazy-fill on metadata events

The existing `metadata.service.ts` is the natural insertion point. After `getMovieDetails()` finalises a movie, fire `MOVIE_METADATA_UPDATED` via the existing `EventsService` (already used by grouping).

Subscribers in the recommendations module:
- `ExternalRecsCacheJob` — persist TMDB similar/recs from the response payload (no extra HTTP call — they're already in `append_to_response`).
- `TraktRelatedFetchJob` — if Trakt configured, enqueue (rate-limited).
- `EmbeddingJob` — enqueue plot embedding (local, fast).
- `LlmFeaturesJob` — if an LLM is configured AND auto-enrich opted in, enqueue feature extraction.

All jobs are idempotent (`WHERE source = ? AND model = ? AND updated_at > stale_threshold` short-circuits). Stale data (default 30 days) triggers refresh. The admin's "Refresh metadata" button fires the same event — there's no parallel pipeline.

### Settings UX — Connections + Matching

Two new admin pages.

**`Settings → Connections`** — a grid of cards, one per registered provider:
- Icon, display name, one-line description.
- Status pill: *Not configured* / *Active* / *Cooled down (resets in 1h 12m)* / *Error*.
- **Configure** button → modal with a form auto-generated from the provider's `configFields`.
- **Test** button → calls `healthCheck()`, shows result.
- Sparkline of last 7 days from `provider_events`.

**`Settings → Matching`** — pipeline tuning:
- Strategy weights — slider per strategy (TMDB sim, Trakt, content-vector, embedding, LLM rerank). Presets: *Conservative* / *Adventurous* / *Custom*.
- Diversity (MMR λ) slider.
- Quality floor (min IMDb / TMDB rating).
- Exclusions: same-group, already-watched, per-director cap, per-actor cap.
- Multi-input policy: *Centroid* / *Union of neighbours* / *Auto* (variance-aware).
- LLM monthly cost ceiling (USD).
- Auto-enrichment toggles: "Run embeddings on scan", "Fetch external recs on scan", "Extract LLM features on scan", "Refresh stale data every N days".

Both pages render usefully with **nothing** configured — they're the on-ramp.

### Observability & cost tracking

```sql
CREATE TABLE provider_events (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  event_type   TEXT NOT NULL,        -- 'call' | 'error' | 'rate_limit' | 'budget_exhausted'
  status_code  INTEGER,
  duration_ms  INTEGER,
  cost_usd     REAL,
  payload      TEXT,                 -- JSON, secrets redacted
  occurred_at  TEXT NOT NULL
);
CREATE INDEX provider_events_provider_idx ON provider_events(provider_id, occurred_at DESC);
```

Surfaced as:
- Per-card sparkline on Connections page.
- Admin Dashboard tab "Providers": call volume (7d/30d), error rate, p95 latency, quota progress, monthly $ spent vs ceiling, recent errors with one-click retry / disable.

Retention: 90 days of raw events; older rolled up nightly into a daily summary table (`provider_events_daily`).

### Graceful degradation contract

Every recommendation request answers something, even with **zero** providers configured. The orchestrator tries in this order:

1. **Local strategies** — `content-vector`, `embedding` (if model loaded), group-based cold-start fallback. Always available.
2. **Cached external data** — `movie_external_recs`, populated whenever metadata is fetched. Free to consume.
3. **Live external calls** — TMDB live `/similar`, Trakt `/related`. Only if provider configured + not cooled-down + under quota. Skipped silently otherwise.
4. **LLM re-rank** — only if `LLMClient` configured + within budget. Top candidates from 1–3 only.

The endpoint returns results plus a `usedSources: string[]` array the UI can surface as small attribution badges ("*TMDB · MiniLM · Trakt*"). If everything fails the response includes a `reason` field the UI can react to ("Try refreshing this movie's metadata to get suggestions").

---

## 7. Free-tier reality check

| Source | Free quota | Daily query budget on small server |
|---|---|---|
| TMDB | ~40 req/10 s/IP, no daily cap | Effectively unlimited |
| Trakt | ~1 req/sec app-level | ~50K/day — way more than we need |
| TasteDive | 300 req/day | Need caching; fine for "similar movie" panel on detail page |
| MovieLens | Offline dataset (free) | N/A |
| Local embeddings (MiniLM/Nomic) | Free | CPU-bound, ~50 movies/sec |
| OpenAI `text-embedding-3-small` | Paid | ~$0.01 for a 5K-movie library, one-time |
| Claude Haiku re-rank | Paid | ~$0.001 per rec call with prompt caching |

Honest take: even the heaviest "AI-everywhere" config costs cents-per-month for a personal library. The free local stack is also genuinely competitive — local embeddings + cached TMDB/Trakt gets you 80% of the quality with $0 ongoing.

---

## 8. Recommended phased rollout

### Phase 0 — Provider platform (foundation, 2–3 days)

Build the abstractions, admin UX, and cross-cutting plumbing before any user-facing recommender lands. After Phase 0, every subsequent phase is "implement one provider, plug it in" — never "thread API keys through five files".

- `ProvidersModule` with `Provider` interface hierarchy, `ProviderRegistry`, `RateLimitService`, `ProviderCredentialsService`, `ProviderEventsService`.
- Three new tables: `provider_credentials`, `provider_usage`, `provider_events`.
- Admin page `Settings → Connections` (renders empty until Phase 1 registers TMDB).
- Admin page `Settings → Matching` (renders defaults until Phase 1 wires strategies).
- `EventsService.MOVIE_METADATA_UPDATED` event emitted from `metadata.service.ts` (no subscribers yet — added in Phase 1).
- Unit tests for the registry, rate-limit math, credential masking, budget enforcement.

No user-visible recommendation feature in this phase — it's purely architectural groundwork. See `FIND_SIMILAR_PLAN.md` Phase 0 for the file-by-file checklist.

### Phase 1 — "free quality" (1–2 days of work)

- Register `TmdbRecommender` and a content-vector pseudo-provider (no API, just local feature scoring) through Phase 0's registry.
- Persist TMDB `/similar` + `/recommendations` into `movie_external_recs` during the existing metadata fetch path (no extra API calls — they're already in `append_to_response`).
- Build the `content-vector` strategy from `movie_metadata` columns (genre, cast, director, keywords, year, runtime). Pure SQL + JS; no new deps.
- Implement `composite-scorer` with weighted combination and MMR diversity.
- Add `GET /recommendations/movie/:id` and the "Similar" rail on `MovieDetail`.
- Filters: exclude same-group, cap per-director, quality floor.

Result: a recommendation system better than what TMDB returns alone, with zero new dependencies and zero cost.

### Phase 2 — "multi-input + Trakt" (2–3 days)

- `POST /recommendations/multi` (centroid + MMR).
- Wire into Playlist view ("Add similar").
- Add Trakt provider (optional, gated on API key in `config.yml`).
- Cache strategy: respect Trakt rate limit, persist to `movie_external_recs`.

### Phase 3 — "embeddings" (3–5 days)

- Bundle `@xenova/transformers` + `all-MiniLM-L6-v2` for fully-local plot embeddings.
- `EmbedMoviesJob` runs incrementally during library scan.
- Store as BLOB; full-scan cosine in-memory until library size warrants `sqlite-vec`.
- Add embedding distance as a new strategy in the composite.

### Phase 4 — "LLM features + re-rank" (gated on user-provided API key)

- One-time `LlmFeaturesJob`: tone/pace/themes/audience extraction.
- `llm-rerank` strategy: optional final pass, returns ranked candidates with one-line "why" explanations.
- Surface explanations in the UI.

### Phase 5 — "collaborative filtering"

- Only if/when multi-user federation reaches enough scale.
- `CooccurrenceJob`, item-item CF strategy, hybrid blend with α tied to support.

---

## 9. Open questions to decide before building

1. **Where do "similar" results come from — local library only, or external catalog too?** Most useful for streaming is *local first* (results you can actually play), with an optional "explore beyond" section showing external matches you don't have yet (good wishlist source).
2. **Per-user personalisation, or shared per-server?** Phase 1 can be shared (cheaper, simpler). Per-user comes naturally when CF arrives.
3. **Where do API keys live?** TMDB / OMDB already in `config.yml`. Trakt should join them. LLM keys should be per-user *settings* (since the user pays).
4. **Is "show me films I don't have" desirable UX?** If yes, every result needs a clear "in library / not in library" badge plus a "request" or "add to wishlist" action.

---

## 10. TL;DR

- The single highest-ROI move is **caching what TMDB already gives us** and **combining it with a content-vector strategy built from columns we already store**. No new APIs, no new models, no new deps — and it will beat using TMDB `/similar` alone.
- Add **local plot embeddings** (MiniLM, in-process) when phase-1 quality plateaus. Free, ~80 MB, no API call.
- Use **LLMs surgically**: as a re-ranker on cheap candidates and as a one-time feature extractor — never as the primary recommender.
- **Trakt** is the best second external source for diversity; **MovieLens tag-genome** is the best offline corpus.
- **Collaborative filtering** only pays off at multi-user scale — defer.
- For **playlist / collection** input: centroid + MMR, with a variance check to fall back to union-of-neighbors when inputs are heterogeneous.


## Secrets & credentials

> **🔐 API credentials never go in source-tracked files** — not
> in `config.yml`, not in this docs tree, not in `.env` files
> committed to git. They live in the database (`provider_credentials`
> — see §6.5) and are managed exclusively through **Settings →
> Connections**.
>
> If a credential ever appears in a tracked file, treat it as
> **burned** and rotate at the provider. (The Trakt credentials
> previously pasted here have been removed — they should be
> considered compromised and regenerated at
> <https://trakt.tv/oauth/applications>.)

| Provider | Where to get a key | Notes |
|---|---|---|
| TMDB | <https://www.themoviedb.org/settings/api> | Free, instant, already integrated. |
| OMDB | <https://www.omdbapi.com/apikey.aspx> | Free 1000/day, already integrated. |
| Trakt | <https://trakt.tv/oauth/applications> | Free. App-level calls only need the `client_id` as `trakt-api-key`; OAuth is optional. Use the OOB redirect `urn:ietf:wg:oauth:2.0:oob` unless wiring user OAuth. |
| Anthropic (Claude) | <https://console.anthropic.com/> | Paid; optional. Used for re-rank + LLM features + explanations. |
| OpenAI | <https://platform.openai.com/api-keys> | Paid; optional embeddings provider. |
| TasteDive / Qloo | <https://tastedive.com/account/api_access> | Free 300/day. |