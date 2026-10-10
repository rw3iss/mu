# Music Support — Audit & Implementation Plan

Status: **in progress** (started 2026-10-10) · Date: 2026-10-09 · Scope: add an optional **Music** media type
(artists, albums, tracks) next to Movies, sharing infrastructure without coupling
the two features.

## Implementation status

> **COMPLETED 2026-10-10** — see §14 Close-out.

| Phase | Status | Commit |
|---|---|---|
| 0 — Groundwork | DONE 2026-10-10 — feature flags, JobTypeRegistry, `media_sources.kind`, polymorphic `entity_*` tables + backfill (verified on prod: counts match), PlayerControls split, PlayerAdapter, AudioEngine source bus, MediaImporter/VideoImporter | `68f3208`…`1243358`, deployed `4ce3558` |
| 1 — Catalogue | DONE 2026-10-10 — music schema + FTS5, AudioImporter (tags, grouping, compilations, art, duplicates), music jobs, Settings → Music, Setup Libraries step, installer prompts, Jobs kind filter, scan quick action | `0ec7901`, `4ce3558`, `dca325c` |
| 2 — Playback (+ waveform seek bar) | DONE 2026-10-10 — capability probe, progressive streaming (original / cached FLAC / Opus-AAC), waveform peaks + seek bar, ingest transcodes, LRU cache eviction, audio player (A/B gapless, art surfaces, list panel, shuffle/repeat, ReplayGain, MediaSession, video interplay) | `920aac9`, `a176088`, `0ec7901` |
| 3 — Browse & detail | DONE 2026-10-10 — browse mode toggle + routing, music library tabs, artist/album/track pages, generalised favorite/rating/comments/playlists/options menu, music home rails, audio playlists | `2522959`, `bb4dbb3`, `f5d5c30` |
| 4 — Metadata & lyrics | DONE 2026-10-10 — shared MusicBrainz client, album matching + candidates (AlbumMatchModal), Cover Art Archive, Wikidata/Wikipedia artist bio + image, LRCLIB lyrics (synced view, fetch button, editing), admin quick actions, album merge/split tools (`album_aliases`). BYPASSED: AcoustID fingerprinting + Last.fm (need keys the provider platform doesn't hold yet; optional per plan) | `4716ab0`, `226f403`, `0fa194a` |
| 5 — Upload & offline | DONE 2026-10-10 — `POST /music/upload` (track / folder / zip, built-in zip reader with zip-slip + count + size caps, targeted import), signed offline download URLs, real Service Worker (`music-offline` cache, Range/206), Downloads list + per-device budget, LRU, Keep pins | `a961c4c`, `54652a4` |
| 6 — Search & discovery | DONE (2026-10-10) — shared search orchestrator + source registry; federated music search (SSE); `mb:` stub pages; Discover (local content vector + ListenBrainz); album→film cross-links. Scrobbling + LLM rerank deferred (see §10) | |

Open-question assumptions in §12 were accepted as written (2026-10-10).

---

## 1. Goals and non-goals

**Goals**

1. Music is **optional**. The admin can enable or disable it at install time, in
   first-run Setup, and later in Settings. When disabled, no music UI, routes, jobs,
   scans or providers are active.
2. Movies and Music are **independent features** built on a **shared media core**.
   Neither feature imports the other. Each can be disabled without breaking the other
   (Movies stays on by default).
3. Music has **parity with Movies** for: library browse, search and filters,
   playlists, favorites (artists, albums, tracks), ratings (artists, albums, tracks),
   comments, history and resume, admin jobs, upload, metadata lookup, and later
   discovery.
4. Playback **defaults to the original quality** (FLAC plays as FLAC when the browser
   can decode it). The server transcodes only when a format will not play, or when the
   user or admin chooses a lower quality.
5. One **global player shell** serves both kinds. It has different control groups,
   panels and artwork per kind, and the same modes (full, split, mini, closed).
6. A global **Movies | Music browse mode** in the header. It scopes the Library,
   search, Discover, the dashboard rails and the sidebar.
7. **Offline download** of music in the browser, with admin-controlled quality and
   cache limits.

**Non-goals (this plan)**

- Podcasts and audiobooks. The `MediaKind` design leaves room for them; they are
  not specified here.
- Music videos as their own entity type. A music video is a movie file; we can link
  it to a track later.
- DRM or licensing enforcement.
- A native mobile app. The browser/PWA is the client.

---

## 2. Audit — what exists today

### 2.1 Summary

The infrastructure is generic, but **the identity is "movie" everywhere**. Most work is
to put the generic parts behind a media-neutral interface, then add a Music
implementation next to the Movie one.

| Area | Media-neutral today (reuse) | Hard-wired to movies (generalise) |
|---|---|---|
| Schema | `media_sources`, `scan_log`, `settings`, `user_settings`, `favorites` (polymorphic `entity_type/entity_id`), `notifications` (JSON `data`), `playlists` (header), `job_history`, `audio_profiles`, provider tables | `movies`, `movie_files` (video columns), `user_ratings`, `user_watchlist`, `user_watch_history`, `movie_comments`, `playlist_movies.movie_id`, `stream_sessions`, `media_cache`/`transcode_cache` (keyed by `movie_file_id` despite the names), `search_cache` (type enum movie/person) |
| Library | `media_sources` rows; job framework; watcher self-heal | `scanner.service.ts` walks `SUPPORTED_VIDEO_EXTENSIONS`, parses "Title (Year)", applies a 50MB / 300s floor; watcher `extSet` is video-only; upload checks `VIDEO_EXTS`, 50GB cap |
| Jobs | `JobManagerService.registerHandler/enqueue`, in-memory and BullMQ providers | `JOB_TYPE` lives in `library-jobs.service.ts`; `IO_HEAVY_TYPES` / `ENCODE_TYPES` are hard-coded lists |
| Metadata | `ProviderRegistry` (capability lookup), `MergeEngine` pattern (per-field precedence), `MusicBrainzClient` (rate limiter, User-Agent) | `MetadataService` methods are all movie-keyed; `CanonicalField` is movie-centric; `MusicBrainzClient` exposes only `findSoundtrack` |
| Streaming | `DirectPlayService.serveFile` (byte ranges); browser-audio codec list | `determineStreamMode` returns TRANSCODE when `codecVideo` is null → audio files would go to HLS; `direct/:fileId` reads `movie_files`; MIME map is video-only; sessions are movie-keyed |
| Search | SSE orchestration pattern, `search_cache` table | `federated-movie-search.service.ts` hard-wires `runTmdb/runOmdb/runTrakt`; cache type enum |
| Recs | `SimilarityStrategy[]` pattern | All strategies take movie seeds |
| Settings | `settings.get/set`, per-user allowlist (`USER_SETTING_KEYS`) | No feature flags; Setup DTO only takes movie paths |
| Permissions | 3-role model, `@RequireAction` | Actions are `edit:movie` / `delete:movie` |
| Client player | Mode machine (hidden/full/mini/split), persistence, transport/seek/volume, queue mechanics, progress/resume, `AudioEngine` (typed on `HTMLMediaElement`), MediaSession | `globalMovieId/globalMovie`, `moviesService`, `InfoPanel` (cast), subtitles, quality, sprites, PiP, `VideoEnhancer`, live-video mini thumbnail. `PlayerControls.tsx` is a 2044-line monolith |
| Client pages | `MediaCard` (has `posterShape: 'square'`), `MediaRow` (square/circle thumbs), `Collapse`, `Tabs`, `MultiSelect`, `RatingWidget`, `ToggleButton` | `FavoriteButton` (`person\|movie`), `CommentsPanel(movieId)`, `MoviePlaylists`, `ResultCard`, `MovieOptionsMenu`, `MovieGrid`, `ResultFilterBar` (movie filter keys), `EntitySearchInput` (`movie\|person`) |
| Install | ffmpeg/ffprobe already handle every audio format we need | Prompts and config know only video sources |

### 2.2 Specific findings worth fixing first

These are coupling defects, not just missing features. They shape the refactor order:

1. **`determineStreamMode` treats "no video codec" as "must transcode".** Any audio
   file would be sent to HLS, which also silences the Web Audio effects (the
   `blob:`/MediaSource problem). Music must never use HLS. It must use progressive
   HTTP with byte ranges.
2. **`AudioEngine` binds to one element for its lifetime.** That is fine for video.
   **Gapless music needs two elements** (current + preloaded next). The engine needs a
   "source bus" that accepts several elements.
3. **`PlayerControls.tsx` (2044 lines)** mixes transport, seek bar, settings submenus,
   effects, queue and PiP in one component. A second media kind cannot get its own
   toolbar until this is split into control-group components.
4. **Concurrency type lists are hard-coded** in `in-memory-job-provider.ts`. A new
   `audio-transcode` job would silently count as "light" and run with no I/O cap.
5. **`media_cache` / `transcode_cache` have generic names but movie keys.** Renaming
   avoids confusion when music caches are added.
6. **`pages/Search.tsx` and `components/player/VideoPlayer.tsx` are dead code.** Remove
   them before the refactor so nobody extends the wrong file.
7. **`config.schema.ts` `media.supportedExtensions` is declared but never read.**
   Either wire it in (one list per kind) or delete it.

---

## 3. Architecture

### 3.1 Principles

- **Shared core, pluggable kinds.** One `MediaKind` discriminator
  (`'video' | 'audio'`) and one `EntityRef` (`{ type, id }`) flow through the
  cross-cutting features (ratings, comments, favorites, playlists, history, queue,
  search). Kind-specific behaviour sits behind interfaces with one implementation
  per kind (strategy pattern), registered at module init.
- **Open/closed.** Adding Music must not edit Movie logic. It adds new
  implementations of the core interfaces. Movie code changes only where it is first
  moved behind the interface (one-time refactor, Phase 0).
- **Feature flags at the edge.** One `FeatureFlagsService` is the source of truth.
  Guards, the scanner, the job scheduler and the client read it. A disabled kind
  registers nothing that runs.
- **Efficiency.** Music libraries are row-heavy (a 50k-track library is normal,
  versus a few thousand movies). Use FTS5, keyset pagination, denormalised album
  aggregates, and artwork thumbnails at fixed sizes.

### 3.2 Module layout (server)

```
MediaCoreModule  (always loaded)
  ├─ FeatureFlagsService        features.movies / features.music
  ├─ media-sources              + kind column
  ├─ ScanOrchestrator           walks sources, dispatches to MediaImporter by kind
  ├─ JobManager (existing)      + JobTypeRegistry (io-heavy / encode metadata per type)
  ├─ DirectPlayService          byte-range serving, MIME map for audio + video
  ├─ ArtworkService             image store + resized variants
  ├─ Entity services            ratings, comments, favorites, playlists, play history
  │                             all keyed by EntityRef
  └─ ProviderRegistry (existing) + music capabilities

MoviesModule     (existing code; implements core interfaces for kind 'video')
  VideoImporter · MovieMetadataPipeline · MovieStreamAdapter · movie search

MusicModule      (new; registered only if features.music)
  AudioImporter · MusicMetadataPipeline · AudioStreamAdapter · music search
  artists / albums / tracks / track_files · lyrics · AudioTranscodeService
```

**Rule:** `MoviesModule` and `MusicModule` import `MediaCoreModule` only, never each
other. A lint rule (Biome `noRestrictedImports`, or a small path check in CI) enforces
this.

### 3.3 Core interfaces

```ts
type MediaKind = 'video' | 'audio';
type EntityType = 'movie' | 'person' | 'artist' | 'album' | 'track';
interface EntityRef { type: EntityType; id: string }

/** One per kind. ScanOrchestrator routes files by the source's kind. */
interface MediaImporter {
  kind: MediaKind;
  extensions: readonly string[];
  accepts(file: FileStat): boolean;              // size/duration floors per kind
  import(sourceId: string, path: string): Promise<ImportResult>;
  purgeOrphans(): Promise<number>;
}

/** One per kind. The stream controller asks the adapter for a playable URL. */
interface StreamAdapter {
  kind: MediaKind;
  start(ref: EntityRef, user: JwtUser, opts: StreamOptions): Promise<StreamSessionDto>;
  reportProgress(sessionId: string, positionSeconds: number): Promise<void>;
}

/** Job metadata used by the in-memory provider instead of hard-coded lists. */
interface JobTypeSpec { type: string; ioHeavy: boolean; encode: boolean; feature?: 'movies' | 'music' }
```

Entity services (ratings, comments, …) take an `EntityRef` and an
`EntityResolver` (one per type) that answers "does it exist, what is its title and
art" for notifications, search results and comment links.

---

## 4. Data model

### 4.1 Music catalogue (new tables)

| Table | Key columns | Notes |
|---|---|---|
| `artists` | `id`, `name`, `sort_name`, `mbid`, `type` (person/group/orchestra/choir), `country`, `begin_year`, `end_year`, `bio`, `image_id`, `disambiguation` | Unique on `mbid` when set |
| `albums` (release groups) | `id`, `title`, `sort_title`, `mbid_release_group`, `primary_type` (album/EP/single/compilation/live/soundtrack), `secondary_types` JSON, `year`, `original_year`, `art_id`, `track_count`, `total_seconds`, `rating_avg`, `rating_count` | Aggregates are denormalised and updated by triggers or on write |
| `album_releases` | `id`, `album_id`, `mbid_release`, `label`, `catalog_no`, `country`, `media_format`, `disc_count` | Several editions of one album |
| `album_artists` | `album_id`, `artist_id`, `role`, `position` | Ordered credits; "Various Artists" = `is_compilation` on album |
| `tracks` | `id`, `album_id`, `release_id`, `title`, `disc_no`, `track_no`, `duration_seconds`, `mbid_recording`, `isrc`, `explicit`, `bpm`, `key` | |
| `track_artists` | `track_id`, `artist_id`, `role` (primary/featured/composer/producer/…), `position` | Classical: composer/performer roles |
| `track_files` | `id`, `track_id`, `source_id`, `file_path` (unique), `file_size`, `file_modified_at`, `container`, `codec`, `bitrate`, `sample_rate`, `bit_depth`, `channels`, `lossless`, `replaygain_track`, `replaygain_album`, `available`, `fingerprint` | Several files per track (FLAC + MP3) |
| `music_genres`, `album_genres`, `artist_genres` | | Tag-style, many-to-many |
| `lyrics` | `track_id` (PK), `plain`, `synced_lrc`, `source`, `language`, `fetched_at`, `edited_by` | User edits are allowed |
| `music_identities` | `entity_type`, `entity_id`, `source`, `external_id` | MBID, Discogs, Last.fm, Spotify ids |
| `music_match_candidates` | | Or reuse `metadata_match_candidates` with `entity_type` |
| `artwork` | `id`, `kind` (album/artist), `source`, `original_path`, `hash`, `width`, `height` | Resized variants on disk: 64/256/600/1200 px |

Indexes: `tracks(album_id, disc_no, track_no)`, `track_files(track_id)`,
`album_artists(artist_id)`, `track_artists(artist_id)`, and FTS5 virtual tables
`music_fts(name/title, artist names, album title)`, kept in sync by triggers.

### 4.2 Cross-cutting tables → polymorphic

Plan: **new polymorphic tables + backfill**, then switch code, then drop old tables a
release later. This is safer than renaming columns in place under SQLite.

> **Correction (2026-10-10).** `foreign_keys = ON` in `DatabaseService`, and a
> polymorphic `entity_id` cannot carry an FK to several tables. The new tables
> therefore have **no FK to the entity tables**; the old `ON DELETE CASCADE`
> becomes `EntityLifecycleService.purge(ref)`, called wherever a movie (or later an
> artist/album/track) is hard-deleted. Comment reactions also need their own table
> (`entity_comment_reactions`), because `comment_reactions.comment_id` references
> `movie_comments`. The backfill runs **once**, gated by a `_migrations` row —
> re-copying on every migrate would resurrect rows deleted from the new tables.

| New table | Replaces | Shape |
|---|---|---|
| `entity_ratings` | `user_ratings` | `user_id, entity_type, entity_id, rating, rated_at`, unique `(user_id, entity_type, entity_id)` |
| `entity_comments` | `movie_comments` | `entity_type, entity_id, parent_id, user_id, body, time_seconds?` (+ existing `comment_reactions` keyed on comment id) |
| `playlist_items` | `playlist_movies` | `playlist_id, item_type, item_id, position, added_at, remote_*`. Playlists gain `kind` (`video`/`audio`/`mixed`, default per creator's mode) |
| `play_history` | `user_watch_history` | `user_id, entity_type, entity_id, position_seconds, completed, play_count, last_played_at` |
| `entity_watchlist` | `user_watchlist` | Music equivalent is "Save for later" |
| `favorites` | (exists) | Extend `FavoriteEntityType` to `artist/album/track` |
| `search_cache` | (exists) | Widen the `type` and `source` enums |
| `stream_sessions` | (exists) | Add `entity_type`; rename `movie_file_id` → `file_id` + `file_kind` |
| `media_cache`, `transcode_cache` | (exist) | ~~Add `file_kind`~~ **BYPASSED:** music uses its own `cache/music/` transcode cache (§5.4) and does not use the NVMe hot cache, so these stay video-only |

Migration steps (one `scripts/migrate.js` release each):

1. Create the new tables. Backfill from the old ones with `entity_type='movie'`.
2. Code reads and writes only the new tables. Old tables stay, unused.
3. Drop the old tables after one release.

`media_sources` gets `kind TEXT NOT NULL DEFAULT 'video'`.

---

## 5. Ingestion, cataloguing and encoding

### 5.1 Sources and scanning

- **Music folders are separate sources** (`media_sources.kind = 'audio'`), managed in
  Settings → Music → *Music Folders* (corrected 2026-10-10: one Music tab instead of
  sections spread over Library/Encoding/Playback). One path should not be both kinds. If it is,
  each importer only takes its own extensions.
- `ScanOrchestrator.scanSource` walks with the importer's extension set
  (`SUPPORTED_AUDIO_EXTENSIONS`: `mp3 flac m4a aac alac ogg oga opus wav aiff aif wma ape wv dsf dff`)
  and calls `importer.import()`. The watcher builds its `extSet` per source kind.
- **AudioImporter** per file:
  1. Read tags with [`music-metadata`](https://github.com/Borewit/music-metadata) (pure JS,
     reads ID3v1/v2, Vorbis comments, MP4 atoms, APE, embedded pictures). Use ffprobe
     as the fallback for stream facts.
  2. Group into albums by `(album artist, album title, mbid if present, folder)`.
     Folder grouping solves untagged albums and splits same-named albums.
  3. Upsert artist → album → track → track_file in one transaction. `findOrCreate` by
     MBID first, then normalised name. Duplicate guard: same track + same
     duration ±2s + same quality → attach as an extra `track_file`, as we now do for
     movies.
  4. Artwork: embedded picture → `cover.jpg`/`folder.jpg` in the directory → Cover Art
     Archive later. Hash it and store it once in `artwork`.
  5. Emit `LIBRARY_TRACK_ADDED`, coalesced per album, to enqueue
     `music-metadata` (per album, not per track) and, when needed, `audio-transcode`.
- **Floors per kind.** The movie floors (50MB / 300s) must not apply. Audio uses
  its own `music.minDurationSeconds` (default 5s) to skip silence and hidden-track
  stubs.

### 5.2 Upload

`POST /music/upload` reuses the streaming upload pipeline (no buffering, traversal
guard), plus:

- **Single track or folder:** written under the chosen music source as
  `<Artist>/<Album>/<file>`, or verbatim when a folder structure is given.
- **Zip:** streamed to a temp file, then extracted with `yauzl` (streaming). Checks:
  zip-slip guard, entry count cap, uncompressed-size cap (zip-bomb guard), and audio +
  image + `.cue`/`.lrc` entries only. Then the folder path above.
- `finalize` triggers a targeted scan of the written paths only, not a full source
  scan.

> **STATUS 2026-10-10 — DONE with changes.** Code: `music/upload/` (separate
> `MusicUploadController`, `edit:media`). Endpoints: `GET /music/upload/targets`
> (enabled `audio` sources), `POST /music/upload/preflight {sourceId, names}` →
> `{conflicts}`, `POST /music/upload` (multipart, `sourceId` + `relativePath` +
> `uploadId` + `fileTotal` fields **before** the file; 20 GB per request) →
> `{ok, written[], skipped[], bytes}`, `POST /music/upload/finalize {sourceId, uploadId,
> rootName}` → `{ok, files}`. Corrections: (a) **no `yauzl`** — it is not installed, so
> `zip-reader.ts` is a small built-in central-directory reader (ZIP64 aware; `stored` +
> `deflate` via `zlib`; encrypted / other methods rejected). Guards: unsafe names
> reject the whole archive before anything is written, max 5000 entries, max 25 GB
> declared *and* actual inflated size (an entry that inflates past its declared size
> is cut off), symlink entries and disallowed types skipped, existing files never
> overwritten. A single-root zip extracts as that folder, otherwise into a folder named
> after the zip. (b) Loose tracks: placed at `<AlbumArtist|Artist>/<Album>/<file>` from
> tags; a file with neither tag stays at the source root. (c) `finalize` runs
> `AudioImporter.importFile` on the audio paths the batch wrote (in the background),
> stamps `track_files.uploaded_by` (column already existed), then emits
> `UPLOAD_COMPLETED {kind:'audio', imported, failed}`. `AudioImporter` now dedupes
> concurrent imports of one path (the watcher sees the same files). Client:
> `MusicUploadModal` (Music home + Library header, `can('edit:media')`), sharing the
> movie upload's background progress widget.

### 5.3 Metadata pipeline

| Need | Provider | Key? | Notes |
|---|---|---|---|
| Release/recording/artist identity | **MusicBrainz** | No | Refactor `soundtrack/musicbrainz.client.ts` into a shared `providers/sources/musicbrainz` client (keep its 1 req/s limiter and User-Agent); `SoundtrackService` becomes a consumer |
| Album art | **Cover Art Archive** | No | By MBID; sizes 250/500/1200 |
| Untagged files | **AcoustID** + `fpcalc` (Chromaprint) | Free key | Optional; installer offers the `chromaprint-tools` package |
| Artist bio, tags, similar artists | **Last.fm** | Free key | Optional; also enables scrobbling later |
| Artist bio/images (fallback) | Wikidata / Wikipedia | No | Wikidata source already exists |
| Lyrics (plain + synced) | **LRCLIB** | No | Open database with LRC timestamps |
| Discovery | ListenBrainz | Optional token | Phase 6 |

Pipeline per album: tags → MusicBrainz release search scored by (artist, title,
track count, per-track duration deltas, year) → pick the release, or write
candidates when the confidence is low (reuse the existing match-candidates UI) →
fetch release group, recordings, artist credits → merge with the **MergeEngine**
using a music `CanonicalField` set (tag values win for title and track numbers the
user has edited; providers win for MBIDs, art and bio).

New provider capabilities: `enrich-music`, `lyrics`, `fingerprint`, `recommend-music`.

> **Status (2026-10-10) — server built; some of the plan above changed:**
> - The shared client is `providers/sources/musicbrainz/musicbrainz.client.ts` (`MusicBrainzModule`, a Nest singleton). Soundtrack and music use **one** 1.1 s throttle queue. The soundtrack-specific code moved to `soundtrack/soundtrack-lookup.ts`.
> - The matcher does **not** use the MergeEngine or `@RegisterProvider()`. The keyless sources (MusicBrainz, CAA, LRCLIB, Wikidata/Wikipedia/Commons) need no credentials, so they are plain injectables in `music/metadata/clients.ts`. Merge rules are in `MusicMetadataService`: tags keep titles and track numbers; MB fills the release-group MBID, type, secondary types, `originalYear`, year only when empty, the `album_releases` row (label, catalog no, format, disc count), artist MBIDs (never taken from another row) and recording MBIDs (only when the track lists line up). Genres are added, not replaced.
> - Scoring (`music/metadata/album-match.ts`) uses title 0.35, artist 0.25, track count 0.15, year 0.10, Official status 0.05 and MB relevance 0.10. A gate applies when title or artist < 0.5. The top 2 hits are then looked up, and per-track duration agreement counts for 20%. **Auto-apply** needs ≥ 0.80 and a 0.05 lead over the best hit from a *different* release group. Otherwise the best release per group (top 10, ≥ 0.35) goes into the new `album_match_candidates` table (`matched_by` = `auto`/`manual`). A forced refresh never replaces a manual match.
> - Cover Art Archive tries `front-1200`, then `front-500`, for the release first and then the release group. It only fills missing art, and is skipped when the admin removes `coverartarchive` from `artPreference`. `force` replaces existing art.
> - Artist info: the MBID comes from tags or the match, or from an MB artist search (score ≥ 95 and the exact normalised name). Then MB `url-rels` → the Wikipedia REST summary (bio) and the Wikidata P18 → Commons image. **Last.fm is skipped**: the provider platform has no Last.fm credential yet.
> - Lyrics: LRCLIB `/api/get` (with duration), falling back to `/api/search`. A miss is stored as an empty row and re-queried after 30 days. A `source='user'` row is never overwritten (SQL `setWhere` guard plus a re-check after the fetch). Gated on `fetchLyrics`.
> - **AcoustID fingerprinting: deferred** (needs a key and `fpcalc`).
Each registers with `@RegisterProvider()` and appears in Settings → Connections
automatically.

### 5.4 Playability and encoding policy

Music does **not** need conversion when the browser can decode it. The client sends
its capabilities on stream start (we already do this for HEVC):

```ts
// client: audio capability probe, sent as ?caps=flac,opus,alac,…
const probe = (t: string) => new Audio().canPlayType(t) !== '';
```

| Source | Chrome/Edge | Firefox | Safari | Default action |
|---|---|---|---|---|
| MP3, AAC/M4A, WAV | ✓ | ✓ | ✓ | Direct play |
| FLAC | ✓ | ✓ | ✓ (11+) | Direct play (original quality) |
| Ogg Vorbis / Opus | ✓ | ✓ | ✓ (17+ Opus in CAF/WebM partial) | Direct play when probe says yes |
| ALAC (m4a) | ✗ | ✗ | ✓ | Transcode → FLAC (lossless to lossless) |
| AIFF | ✗ | ✗ | ✓ | Transcode → FLAC |
| WMA, APE, WavPack, DSD (dsf/dff) | ✗ | ✗ | ✗ | Transcode → FLAC (DSD: → 24/88.2 FLAC) |

**Quality profiles** (admin sets the default and the maximum; users pick any profile up
to the maximum):

| Profile | Output | Use |
|---|---|---|
| `original` (default) | Source file, or lossless FLAC when the source won't play | Home network |
| `lossless` | FLAC (re-encode only if needed) | |
| `high` | Opus 256 kbps (AAC 256 for Safari < 17) | Remote |
| `normal` | Opus 160 kbps | |
| `low` | Opus 96 kbps | Mobile data |

**Delivery.** Always progressive HTTP with byte ranges through `DirectPlayService`,
never HLS (it would break Web Audio effects and gapless). Transcodes are **cached
files**, keyed `(track_file_id, profile)`, under `cache/music/<fileId>/<profile>.<ext>`
and written to `.part` then renamed. On a cache miss:

1. Unplayable formats are transcoded **at ingest** by a background `audio-transcode`
   job, so the first play is instant.
2. Bitrate profiles are transcoded **on demand**. A 4-minute track encodes to Opus in
   about a second, so the request can wait for it. Very long tracks
   (> `music.onDemandMaxSeconds`, default 20 min) get a
   live chunked ffmpeg pipe without range support until the cached file lands.

> **STATUS 2026-10-10 — corrections.** (a) `stream_sessions` keeps its FK to
> `movies`, so music sessions are **stateless** (`<trackId>.<nonce>` ids, self-describing
> file URLs) and progress is written straight to `play_history`. (b) The live chunked
> pipe for very long tracks was **dropped**: every miss is build-then-serve (an
> 80-minute track builds in seconds; requests are de-duplicated). `onDemandMaxSeconds`
> remains in settings but is unused. (c) Albums carry a `group_key` column for the
> grouping rule.

**Cache management.** A `music-cache-evict` scheduled job: LRU under
`music.transcodeCacheMaxGb`. Ingest-time transcodes for unplayable formats are never
evicted while the source exists.

**ReplayGain.** Tags are read at ingest; the player applies a gain node
(track or album mode, user setting) inside the AudioEngine.

### 5.5 Jobs

New `JOB_TYPE`s, registered by `MusicModule` with `JobTypeSpec` metadata:

| Type | ioHeavy | encode | Purpose |
|---|---|---|---|
| `music-scan` | – | – | Scan one audio source *(2026-10-10: not a separate type — the generic `scan` job dispatches by `media_sources.kind`)* |
| `music-metadata` | – | – | Per-album match → release-group genres → CAA art if missing → album artists' bio/image. Queued idle-only, priority 85, for each NEW album |
| `music-artwork` | – | – | Fetch missing album art from CAA (matches first if never searched) |
| `music-lyrics` | – | – | LRCLIB lyrics. Queued idle-only, priority 90, for each new track when `fetchLyrics` is on; also bulk or on demand |
| `audio-transcode` | ✓ | ✓ | Unplayable → FLAC; profile pre-builds |
| `music-fingerprint` | ✓ | – | AcoustID for untagged files |
| `music-cache-evict` | – | – | Scheduled LRU |

> **STATUS 2026-10-10.** Registered: `music-waveform` (new — waveform peaks),
> `audio-transcode`, `music-cache-evict` (hourly), `music-metadata`, `music-lyrics`.
> BYPASSED: `music-scan` (audio sources use the existing scan job, routed by
> `source.kind`), `music-artwork` (folded into `music-metadata`), `music-fingerprint`
> (AcoustID deferred — see Phase 4 status).

The in-memory provider reads `ioHeavy`/`encode` from the `JobTypeRegistry` instead of
the hard-coded lists. Music caps: `music.maxConcurrentJobs` (default 2) as a per-feature
sub-cap, so a big music import cannot starve movie jobs. The Jobs panel gets a
*Movies / Music / All* filter. The badge mapping (`jobListAction`) gets the new types.

---

## 6. Client

### 6.1 Browse mode

- `state/browseMode.state.ts`: `browseMode: Signal<'movies' | 'music'>`, persisted
  with `useUiSetting('browse_mode')`. If only one feature is enabled, the mode is fixed
  and the toggle is hidden.
- **Header toggle** (`TopBar.tsx`, before the search form): a large two-segment
  control, *Movies | Music*. Only one is active. Switching keeps you on the
  equivalent page (`/library` → `/music`, `/discover` → `/music/discover`; detail
  pages go to the mode's home).
- **Routes**: separate route trees on shared page shells.

| Movies | Music |
|---|---|
| `/` dashboard | `/music` dashboard |
| `/library` | `/music/library` (tabs: Artists · Albums · Tracks · Genres) |
| `/movie/:id` | `/album/:id`, `/artist/:id`, `/track/:id` |
| `/person/:id` | — (artists cover this) |
| `/discover` | `/music/discover` |
| `/playlists` | `/playlists?kind=audio` (shared page, filtered) |
| `/favorites`, `/history` | same pages, filtered by mode |

  Separate paths keep deep links and back-navigation correct. `browseMode` follows the
  URL, so a pasted `/album/…` link switches the mode by itself.
- **Sidebar/MobileNav**: `NavItem.mode?: 'movies' | 'music'`; the list is computed
  from `browseMode`. *Watchlist* becomes *Saved* in music mode.
- **Search**: `TopBar` placeholder and target follow the mode. In music mode the
  header search goes to `/music/library?q=` and the dropdown streams from
  `/search/music/stream` (artists, albums and tracks grouped).

### 6.2 Shared components to generalise (once)

| Component | Change |
|---|---|
| `FavoriteButton` | `entityType` union + `artist/album/track` |
| `CommentsPanel` | `ref: EntityRef` instead of `movieId`; `time_seconds` only for video/track |
| `RatingWidget` | Already generic; wrap in `EntityRating({ref})` that loads/saves `entity_ratings` |
| `MoviePlaylists` → `EntityPlaylists` | `ref: EntityRef`; "Add to playlist" filtered by playlist kind |
| `MovieOptionsMenu` → `EntityOptionsMenu` | Action registry per entity type (Play, Play Next, Add to Queue, Add to Playlist, Rate, Favorite, Download, Go to Artist/Album) |
| `ResultFilterBar` | Takes a `FilterField[]` schema instead of movie-specific `hide` keys |
| `ResultCard` / `MediaCard` | Use `posterShape="square"` for albums, circle for artists |
| `MediaRow` | Track rows (number, title, artists, duration, rating, ⋯) |
| `EntitySearchInput` / `useSearchStream` | Type union + `artist/album/track` |
| `Collapse`, `Tabs`, `MultiSelect`, `SmartImage`, `EmptyState` | Reuse as-is |

### 6.3 Music pages

- **Artist** (template: `PersonDetail`): hero (image, name, country, years, genres,
  ★ rating, favorite), Bio (Collapse), *Popular tracks* (top 10 by plays + rating),
  *Discography* rails grouped by album / EP / single / compilation / appears on,
  *Similar artists*, Comments.
- **Album** (template: `MovieDetail`): hero (art 300px, title, artist links, year,
  type, label, total time, ★, favorite, Play / Shuffle / Add to queue), tracklist by
  disc (track no., title, featured artists, duration, per-track ★, ⋯ menu), Credits,
  *Other editions* (album_releases), *More by artist*, Playlists, File info (per
  track_file: codec, bit depth, sample rate, size), Comments.
- **Track** (created dynamically for every track, no extra data needed): header
  (art, title, artists, album link, duration, ★, favorite, Play), **Lyrics** (synced
  LRC highlights the current line while this track plays; edit box for users with
  `edit:media`), Credits (composer, producer, …), *Appears on* (other albums with the
  same recording MBID), Comments with optional timestamps (like movie comments).
- **Music library**: tabs Artists (circle grid) · Albums (square grid, sort by
  artist / title / year / added / rating) · Tracks (virtualised table) · Genres.
  Same filter bar and view toggles as Movies.
- **Music dashboard**: Continue listening (last albums), Recently added albums,
  Most played, Favorites, plus the existing rail infrastructure.

### 6.4 Player

**Decision:** one `GlobalPlayer` **shell** plus two kind-specific bodies, not two
separate players. The mode machine, persistence, keyboard handling, MediaSession,
queue and audio engine are shared. Only toolbar groups, panels and the media surface
differ.

```
state/player/
  playerShell.state.ts   playerMode, activeKind, activeRef, open/close/minimise/split
  adapters/
    videoAdapter.ts      loadMeta (movie), startStream, onEnded, toolbar, panels
    audioAdapter.ts      loadMeta (track/album), startStream, gapless, toolbar, panels
  queue.state.ts         QueueItem { ref: EntityRef, title, subtitle, artUrl, durationSeconds }
                         separate queues per kind; repeat (off/all/one) + shuffle for audio
```

```ts
interface PlayerAdapter {
  kind: MediaKind;
  loadMeta(ref: EntityRef): Promise<NowPlayingMeta>;   // title, subtitle, art, links
  startStream(ref: EntityRef): Promise<StreamSessionDto>;
  onEnded(): void;                                      // video: next in queue; audio: gapless advance
  toolbar: ControlGroup[];                              // ordered groups for the bar
  panels: PanelSpec[];                                  // collapsible side/list panels
  surface: 'video' | 'artwork';                         // what fills the stage / mini corner
}
```

`playMovie(id)` becomes `playMedia(ref)`. `playMovie` stays as a thin wrapper so
existing call sites keep working.

**Split `PlayerControls.tsx` into control groups** (prerequisite, Phase 0):
`SeekBar`, `TransportGroup`, `VolumeControl` (exists), `EffectsButton`, `QueueButton`,
`SettingsMenu` (with pluggable submenus), `PipButton`, `FullscreenButton`,
`InfoButton`, `ShareMenu`, `SnippetButton`.

| Group | Video | Audio |
|---|---|---|
| Transport (prev/next) | ±10s skip | Prev/next track, ±10s on long press |
| Shuffle / repeat | – | ✓ |
| Seek bar | Sprite previews, comment markers | Waveform rendering for seek, lyric markers |
| Effects | EQ, compressor, enhance, video | EQ, compressor, enhance (video tab hidden) |
| Settings submenu | Quality, subtitles, audio track, snippet, shared session | Stream quality, ReplayGain mode, crossfade (later), download for offline |
| PiP / fullscreen | ✓ | – (fullscreen = "maximise") |
| Queue | Queue panel | Panel with tabs: Up next · Album · Playlist · Recommended · Lyrics |
| Info | Movie info panel | Track info panel (credits, album, artist) |

**Surfaces**

- *Mini (corner)*: video shows the live `<video>`; audio shows album art with a
  small progress ring, title and play/pause. Same corner position and size settings.
- *Full*: video fills the stage; audio shows large art, blurred art backdrop,
  title/artist, and the lyrics panel by default.
- *Split*: content on one side, the player stack on the other; for audio the list
  panel fills the extra height.
- *Closed*: stops playback. Minimising or navigating keeps music playing.
  Starting a video while music plays pauses the music, and it resumes when the video
  closes (setting: `music.resumeAfterVideo`, default on). Starting music while a video
  plays asks first, with the existing interrupt-action setting.

**Media elements and the audio engine**

- Video keeps the shared `<video>` element.
- Audio uses **two `<audio>` elements** (A/B) owned by the audio adapter: the current
  one and the preloaded next one, which is swapped in at `ended` for gapless playback.
- `AudioEngine` gets a **source bus**: `attachSource(el)` creates one
  `MediaElementSourceNode` per element into a shared input gain, so EQ, compressor and
  ReplayGain apply to both elements and the A/B swap does not rebuild the chain. This
  also lets the snippet recorder tap "pre-effects" cleanly.
- `MediaSession`: artwork from album art (several sizes), next/previous track
  actions, position state.
- Also add a 'waveform' view and parsing of the audio files into a waveform "image" that can be shown on the player control bar, as the seek bar for playing audio.

### 6.5 Offline downloads (music)

- A real Service Worker (the current one is a pass-through) with a `music-offline`
  cache. Downloads are stored in **Cache Storage** (keyed by the stream URL plus a
  profile marker) and served with correct `Range` support from the SW.
- "Download" on a track / album / playlist → background fetch of the
  `download` profile → progress in the Downloads list (Settings → Playback → Offline).
- The player checks the offline cache first (the SW does this transparently), so
  played-before music doesn't stream again.
- Per-device limits: `maxOfflineGb` (user, capped by admin), LRU eviction, "Keep
  forever" pin per album/playlist, "Clear offline music".
- Auth: download URLs are short-lived signed tokens, so cached responses don't embed a
  long-lived JWT.

> **STATUS 2026-10-10 — DONE with changes.**
> - **Server** (`music/offline/`): `GET /music/offline/policy` →
>   `{allowed, profile, maxOfflineGbPerDevice}` (allowed = `allowDownloads` and the
>   user's role in `offline.roles`); `POST /music/offline/token {trackIds[] (≤500),
>   caps}` → `{items: [{trackId, trackFileId, url, profile, codec, durationSeconds}],
>   missing, expiresAt, policy}`; `GET /music/offline/files/:trackFileId?t=` — public at
>   the JWT layer, the token is the credential. Token = `base64url(json{f,p,c,u,e}).
>   HMAC-SHA256`, key derived from `auth.jwtSecret`, valid 30 min, bound to file +
>   profile + caps; outstanding links stop working when the admin turns downloads off.
>   Downloads use the admin `downloadProfile`.
> - **Service Worker** (`public/sw.js`): API and other traffic is not intercepted;
>   navigations and `/assets/*` are network-first with a `mu-shell-v1` fallback so the
>   app can open offline. Any `GET …/music/files/<id>` is served from `music-offline`
>   when that track file is downloaded — **keyed by track file id only**
>   (`/__mu-offline/track-file/<id>`), so it matches whatever profile/caps URL the
>   player asks for (the download profile wins over the stream profile for downloaded
>   tracks). Range → 206/416, no Range → 200 with `Accept-Ranges`. `/music/art/` falls
>   back to the cache when offline. Cache hits are posted to pages for LRU.
> - **Client** (`state/musicOffline.state.ts`): the **page** downloads (not Background
>   Fetch) — downloads run while Mu is open. Manifest in localStorage
>   (`services/music-offline-index.ts`). Budget = min(user `music.offlineMaxGb`, admin
>   `maxOfflineGbPerDevice`); over budget → evict least-recently-played tracks not in a
>   **Keep** album/playlist. `navigator.storage.persist()` on first download; usage via
>   `estimate()`. "Download" in track/album option menus and album/playlist headers;
>   list + limit + "Clear offline music" in **Settings → Playback → Offline Music**.
>   Offline: `startStream` falls back to a local session and `resolveTrack` to the
>   stored summary, so queued downloaded tracks play without the server.

---

## 7. Settings

### 7.1 Feature flags

| Key (app setting) | Default | Where |
|---|---|---|
| `features.movies` | `true` | Settings → Music → Features |
| `features.music` | `false` (installer/Setup decides) | Settings → Music → Features; Setup; installers |

> **STATUS 2026-10-10.** The switches live at the top of **Settings → Music** (not
> Server). Env defaults `MU_FEATURE_MOVIES` / `MU_FEATURE_MUSIC` accept `1/0/true/false`.

Disabling Music: its routes return 404 (`@RequireFeature('music')` guard), the
scanner skips `audio` sources, `MusicModule` job handlers refuse new work, scheduled
music jobs are not registered, and the client hides every music entry point. **Data
is kept**, so re-enabling is instant. A separate "Delete music library data" action
does the destructive cleanup.

> **STATUS 2026-10-10 — DONE.** Settings → Music → Danger Zone → *Delete Music Library Data* (`POST /music/admin/delete-library {confirm:'DELETE'}`); files on disk are kept.

### 7.2 Admin settings (shown only when Music is enabled)

> **STATUS 2026-10-10 — DONE, reorganised.** Everything below is one **Settings → Music**
> tab (Features, Music Folders, Import, Encoding, Playback, Offline). Quick actions are
> a *Music* group on the Admin page (`POST /music/admin/*`). The per-folder scan
> interval / watch toggle reuse the source defaults.

- **Library → Music Folders**: list of `audio` sources (reuses `MediaPathList` with
  `kind`), scan interval, watch on/off, `music.minDurationSeconds`, grouping rule
  (tags / folder / tags+folder), "Prefer embedded art / folder art / Cover Art Archive".
- **Encoding → Music**: default profile (`original`), max profile, transcode
  unplayable formats at ingest (on), lossless target (FLAC level 5), Opus/AAC
  bitrates per profile, `music.maxConcurrentJobs`, `music.transcodeCacheMaxGb`,
  `music.onDemandMaxSeconds`.
- **Playback → Music** (admin defaults; users override in their own Playback tab):
  default stream profile, ReplayGain mode (off/track/album), gapless (on),
  crossfade seconds (0), resume after video (on).
- **Music → Offline**: allow downloads (on), download profile (`high`), max
  offline GB per device (default 10), allowed for roles.
- **Connections**: AcoustID, Last.fm, Discogs keys (optional); MusicBrainz and LRCLIB
  need none.
- **Admin quick actions**: Scan Music Library, Refresh Music Metadata, Fetch Missing
  Album Art, Fetch Missing Lyrics, Re-encode Unplayable Music, Clear Music Transcode
  Cache. All use the existing confirm-dialog + "started" toast pattern.
  *(2026-10-10, server: `POST /music/admin/{scan,refresh-metadata,fetch-art,fetch-lyrics,reencode-unplayable,clear-cache}`, `admin:server`, no body → `{ started, count }`. `refresh-metadata?scope=all` forces every album; the default is unmatched albums only. `fetch-lyrics` returns 400 when `fetchLyrics` is off. `clear-cache` runs synchronously, and `count` = the number of files removed.)*

### 7.3 Per-user settings (allowlist additions)

`music.streamProfile`, `music.replayGain`, `music.gapless`, `music.crossfadeSeconds`,
`music.offlineMaxGb`, `browse_mode` (UI setting).

---

## 8. Install and first run

> **STATUS 2026-10-10 — DONE with changes.** `install.sh`/`install.ps1` ask "Enable
> Music?" and write a `features:` block to config.yml; music folder paths are added
> later in Settings → Music or on the Setup page (no path prompt). `setup-fedora.sh`
> has `--music/--no-music` (writes `MU_FEATURE_MUSIC` to `.env`); `setup.sh` prompts.
> The chromaprint offer is deferred with AcoustID.

- **`install.sh` / `install.ps1`**: a Phase 3 prompt next to the IMDB datasets prompt —
  "Enable Music support? [y/N]" — then "Music folder path(s)". If yes: offer
  `chromaprint` (`fpcalc`) for fingerprinting (dnf `chromaprint-tools`, apt
  `libchromaprint-tools`, brew `chromaprint`, Windows zip). Writes `features.music`
  and the paths into the generated config/DB seed. ffmpeg needs no change.
- **`setup-fedora.sh`**: a `step "Music support"` after the FFmpeg step, with
  `--music` / `--no-music` flags.
- **`setup.sh`**: an optional prompt before the service prompt.
- **Setup page** (`pages/Setup.tsx`): the *media* step becomes *Libraries* with two
  sections — Movies (on by default) and Music (off) — each with its own folder list.
  `POST /auth/setup` gains `enableMovies`, `enableMusic`, `musicPaths`, and creates
  sources with the right `kind`.
- **`config.schema.ts`**: `features: { movies, music }` as env-level defaults
  (`MU_FEATURE_MUSIC=1`); the DB setting wins once set.

---

## 9. Permissions

Generalise to `edit:media` / `delete:media` (aliases for the existing movie actions
during migration), plus `edit:lyrics` (default: contributor and admin). Viewers keep
`view:library`, which covers both kinds. No per-kind view permission in v1.

---

## 10. Search and discovery

Status 2026-10-10: **implemented** (Phase 6). Corrections to the original plan are noted inline.

- **Federated music search** (`search/federated-music-search.service.ts`, same SSE event
  shape as movies): `GET /search/music/stream?q=` (SSE) and `GET /search/music?q=` (JSON),
  404 while Music is off. Sources: local FTS5 (first, never cached), MusicBrainz, Last.fm
  (optional), Discogs (optional). MusicBrainz is three sources (artist, release-group,
  recording searches) that share the app-wide 1 req/s throttle; each is cached 7d in
  `search_cache` under its own type (`artist`/`album`/`track`). Last.fm / Discogs run only
  when a `provider_credentials` row exists (`lastfm.apiKey`, `discogs.token`); otherwise they
  are skipped silently. Results carry `kind` and are grouped artists / albums / tracks on the
  client. Dedup key order: MBID → local id → normalised `(artist, title, year)` (tracks drop
  the year; artists use the name). Dedup is multi-key: hits sharing any key merge, so a local
  album without an MBID still merges with its MusicBrainz twin.
- **Orchestrator refactor** — *correction*: sources are not discovered from the provider
  registry's `search` capability (TMDB/OMDb/Trakt are not provider-platform providers).
  Instead a search-specific `SearchSourceRegistry` holds a per-domain source list
  (`movie` / `person` / `music`) and one `runFederatedSearch` orchestrator runs all three.
  The movie/people SSE contract and tests are unchanged.
- **Stub pages**: non-library MusicBrainz results open `/album/mb:<releaseGroupMbid>` and
  `/artist/mb:<mbid>` (title, artist, year, genres, Cover Art Archive cover, tracklist of the
  earliest official release / studio discography, "View on MusicBrainz", "Open in library"
  when the MBID is owned). Endpoints: `GET /music/mb/release-group/:mbid`,
  `GET /music/mb/artist/:mbid` (cached 7d). Non-library tracks link to their album stub.
- **Discover music**: `POST /music/discover {seeds, filters, limit}` → grouped
  `{artists, albums, tracks, strategies}` with `inLibrary` flags; seeds are local ids or
  `mb:<mbid>`, picked via search or `GET /music/discover/seeds` (favourites + recent albums).
  Strategies: local content vector over genres / era / artist overlap (weights 0.6 / 0.15 /
  0.25), and ListenBrainz Labs similar-artists (keyless; verified 2026-10-10) for seed artist
  MBIDs, blended noisy-OR. Filters: genre, year range, in-library only. *Corrections*: Last.fm
  similar artists was not added (needs a key; ListenBrainz covers the keyless case); the LLM
  rerank is **not** used because `AnthropicClient.rerank` takes movie-shaped seeds — a
  music prompt is a follow-up.
- **Cross-links**: the Movie *Soundtrack* section links each track to the local track page
  (Phase 3), and the Album page shows "Soundtrack of <film>" via
  `GET /music/albums/:id/films` — exact match on the `soundtrack_cache` release MBID, else a
  soundtrack-looking album (MB secondary type or title hint) whose stripped title equals a
  library movie title, year ±1.
- **Deferred**: scrobbling (Last.fm / ListenBrainz submit) — optional in the roadmap, not built.

---

## 11. Roadmap

Each phase ships on its own and leaves the app working. Estimates are focused
engineering days.

| Phase | Content | Est. |
|---|---|---|
| **0 — Groundwork (no user-visible change)** | Delete dead code (`Search.tsx`, `VideoPlayer.tsx`). `FeatureFlagsService` + guard. `media_sources.kind`. `JobTypeRegistry` replaces hard-coded lists. Polymorphic `entity_*` tables + backfill + switch-over. Split `PlayerControls` into control groups. `PlayerAdapter` shell with the video adapter only. `AudioEngine` source bus. `MediaImporter` interface; existing scanner becomes `VideoImporter`. | 10–14 |
| **1 — Catalogue** | Music schema + FTS5. `AudioImporter` (tags, grouping, artwork, duplicates). Music sources in Settings and Setup. Installer prompts. `music-scan` jobs + Jobs filter. Scan quick action. | 7–9 |
| **2 — Playback** | Audio capability probe. `AudioStreamAdapter` + direct play + MIME map. Ingest transcodes for unplayable formats; on-demand profiles + cache + eviction. Audio player adapter: A/B gapless, art surfaces, toolbar, queue tabs, shuffle/repeat, ReplayGain, MediaSession. Video/music interplay rules. | 9–12 |
| **3 — Browse & detail** | Browse mode toggle + routing. Music library tabs. Artist / Album / Track pages. Generalised Favorite, Rating, Comments, Playlists, Options menu. Music dashboard rails. History and "continue listening". | 10–12 |
| **4 — Metadata & lyrics** | Shared MusicBrainz client. Album matching + candidates UI. Cover Art Archive. Last.fm/Wikidata bios. LRCLIB lyrics + synced display + editing. Optional AcoustID fingerprinting. | 7–9 |
| **5 — Upload & offline** | Music upload (track/folder/zip, safety caps). Real Service Worker, offline downloads, per-device limits and settings. | 6–8 |
| **6 — Search & discovery** | Federated music search (SSE). Search orchestrator refactor. Discover music + soundtrack cross-links. Optional scrobbling. | 6–8 |

Total ≈ 55–72 days. Phases 0–2 (≈ 26–35 days) give a usable music player on a
scanned library.

---

## 12. Risks and open questions

| # | Risk / question | Mitigation / proposal |
|---|---|---|
| 1 | Polymorphic migration of ratings, comments, playlists and history touches live data | New tables + backfill + dual read for one release; DB backup in the migration script; row-count assertion before switch-over |
| 2 | `PlayerControls`/`GlobalPlayer` refactor regresses video playback | Phase 0 has no new features; the video adapter must reproduce today's toolbar exactly; manual checklist covering mini/split/full, subtitles, queue, effects, PiP |
| 3 | Album grouping errors (compilations, multi-disc, same title, "Various Artists") | Group by tags + folder; MBID wins when present; admin "Merge albums" / "Split album" tools in Phase 4 |
| 4 | Classical music (composer vs performer, works, movements) | `track_artists.role`; works deferred |
| 5 | MusicBrainz 1 req/s limit on a large first import | Match per album, not per track; queue with backoff; tags-only catalogue first, enrichment trickles in |
| 6 | Gapless on Safari/iOS (media element switching gaps) | Preload next element early; accept small gaps on iOS; crossfade setting as a fallback |
| 7 | Offline storage quotas (iOS ~1GB, eviction under pressure) | Show quota from `navigator.storage.estimate()`; request `persist()`; pin important albums |
| 8 | Disk usage of transcode caches | Ingest transcodes only for unplayable formats; LRU for profile caches with an admin cap |
| 9 | One path configured as both a movie and a music source | Importers filter by extension; Settings warns when paths overlap |
| 10 | Lyrics copyright | LRCLIB is community-sourced; stored per instance, not redistributed; admin can disable lyric fetching |
| 11 | Should playlists mix kinds? | Proposal: playlists have a `kind`; `mixed` allowed but not default |
| 12 | Separate play counts per user vs global "popular" | Store per user in `play_history`; popular = aggregate query with a cached materialised count |

---

## 13. Definition of done (v1 = Phases 0–3)

Status 2026-10-10. [x] = built and verified by tests / API smoke tests on a copy of the
prod DB; *(browser)* = needs a manual browser check (no Playwright by policy).

- [x] Music can be enabled/disabled in installer, Setup and Settings; disabled = no music routes (404 verified), UI, jobs or scans.
- [x] Movies behave exactly as before — test suite green, movie search/stream endpoints smoke-tested, polymorphic backfill counts match on prod. *(browser regression checklist: user)*
- [x] Admin adds music folders; scan catalogues artists/albums/tracks with art (verified with generated FLAC/AIFF files).
- [x] FLAC served as FLAC when the browser reports support; unplayable formats (AIFF/ALAC/WMA/APE/DSD) via cached FLAC (verified for AIFF). *(browser)*
- [x] Music player: mini/split/full/close; art surface; queue with Up next/Album/Playlist tabs; shuffle/repeat; gapless (A/B); EQ/compressor via the AudioEngine source bus. *(browser)*
- [x] Header Movies|Music toggle scopes Library, search, dashboard and sidebar. *(browser)*
- [x] Artist, Album and Track pages with ratings, favorites, comments (timestamped on tracks) and playlists.
- [x] Music jobs appear in Admin → Jobs with a Movies/Music filter.

---

## 14. Close-out

> **COMPLETED 2026-10-10.** All seven phases (0–6) implemented, tested (233 server
> tests) and deployed to prod (Music stays **off** until enabled in Settings → Music).

**Deliberately not done**
- AcoustID fingerprinting, Last.fm bios/similar, Discogs, scrobbling — need API keys the
  provider platform has no forms for yet; all optional in the plan.
- Crossfade — the plan marks it "later"; the A/B engine gives gapless instead.
- LLM rerank for music discovery — the existing rerank client is movie-specific.
- Background Fetch for offline downloads (downloads run while the app is open).
- `stream_sessions` keeps its movie FK; music sessions are stateless (see §5.4 status).
- The live-pipe fallback for very long tracks (build-then-serve instead).

**What to watch**
- First large music import: MusicBrainz is 1 req/s — metadata trickles in as idle-only jobs.
- Transcode cache size (`music.transcodeCacheMaxGb`) and the ingest-time FLAC copies of unplayable formats (never evicted).
- The new service worker (`public/sw.js`): network-first for the app shell; if a stale shell ever appears, bump its cache version.
- Album grouping mistakes → Album page *Merge… / Split…* (merged folders are aliased).
- Old movie-only user-data tables are unused and can be dropped in a later release.
