# Importing Plex & Jellyfin libraries into Mu

> **Status:** planning / design proposal — no code yet.
> **Audience:** engineers implementing the import feature; admins evaluating scope.

This document is split into three parts:

1. **Background research** — how Plex and Jellyfin store and export library data today.
2. **Mapping & strategy design** — how their data corresponds to Mu's schema, conflict resolution, schema-version handling.
3. **Feature spec** — module layout, wizard UX, CLI entry point, milestones.

A note on accuracy: Plex and Jellyfin both evolve their formats, and Plex in particular has historically published very little official spec for its database. Wherever the design depends on a specific format detail, the plan calls out that the implementer must verify against a current export from a current server version before relying on it. Where a strategy can degrade gracefully when we don't recognize the schema version, we say so explicitly.

---

## Part 1 — Background research

### 1.1 Jellyfin

Jellyfin is open source and its formats are well documented or readable from source. There are three usable shapes of "exported data":

#### A. NFO files alongside media (the easy path)

Jellyfin can be configured to **save metadata to NFO files** next to each media file (Dashboard → Libraries → *each library* → "Save artwork into media folders" + "Save metadata as NFO"). This is the **Kodi/XBMC NFO standard**, which is the de-facto format across Kodi, Emby, Jellyfin, and Plex (with the XBMCnfoMoviesImporter agent).

Layout for a movie:

```
/movies/Inception (2010)/
  Inception (2010).mkv          <- the media file
  Inception (2010).nfo          <- metadata, sibling to the media file
  poster.jpg / Inception (2010)-poster.jpg
  fanart.jpg / Inception (2010)-fanart.jpg
  Inception (2010)-thumb.jpg
  Inception (2010).en.srt       <- external subs
```

A typical NFO XML payload:

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie>
  <title>Inception</title>
  <originaltitle>Inception</originaltitle>
  <sorttitle>Inception</sorttitle>
  <year>2010</year>
  <plot>...</plot>
  <tagline>Your mind is the scene of the crime.</tagline>
  <runtime>148</runtime>
  <mpaa>PG-13</mpaa>
  <premiered>2010-07-16</premiered>
  <studio>Warner Bros.</studio>
  <country>USA</country>
  <genre>Action</genre>
  <genre>Sci-Fi</genre>
  <director>Christopher Nolan</director>
  <writer>Christopher Nolan</writer>
  <actor><name>Leonardo DiCaprio</name><role>Cobb</role><order>0</order></actor>
  <uniqueid type="imdb" default="true">tt1375666</uniqueid>
  <uniqueid type="tmdb">27205</uniqueid>
  <ratings>
    <rating name="imdb" max="10"><value>8.8</value><votes>2200000</votes></rating>
    <rating name="tmdb" max="10"><value>8.4</value><votes>30000</votes></rating>
  </ratings>
  <trailer>plugin://plugin.video.youtube/?action=play_video&amp;videoid=YoHD9XEInc0</trailer>
  <fileinfo><streamdetails>...</streamdetails></fileinfo>
  <userrating>9</userrating>      <!-- per-user, may not be present -->
  <playcount>2</playcount>         <!-- per-user, may not be present -->
  <lastplayed>2024-08-12</lastplayed>
</movie>
```

Strengths of NFO:
- Open, plain XML, well-known schema.
- Sibling layout means a single drop of `<library_root>/` gives us **media path + metadata in one shot**.
- TMDB and IMDb IDs are present in `<uniqueid>` — the gold path for matching.

Caveats:
- `<playcount>` / `<lastplayed>` / `<userrating>` are written from the *primary* user's perspective. Multi-user watch history is **not** captured in NFO files — that lives only in Jellyfin's database.
- Some servers don't have NFO writing turned on, so the user may not have NFOs at all.
- Versioning is implicit; there's no `<schema-version>` tag. Different scrapers (Jellyfin native, Sonarr/Radarr, Kodi, MediaElch) emit slightly different field sets. Our parser must be **tolerant** — read every tag we recognize, ignore everything else.

#### B. Jellyfin database (the deep path)

Jellyfin stores authoritative data in SQLite, default location:

| Platform | Path |
|---|---|
| Linux (deb/rpm) | `/var/lib/jellyfin/data/library.db` and `/var/lib/jellyfin/data/jellyfin.db` |
| Docker | `/config/data/library.db`, `/config/data/jellyfin.db` |
| Windows | `%PROGRAMDATA%\Jellyfin\Server\data\` |
| macOS | `~/.local/share/jellyfin/data/` |

Tables of interest (names current as of Jellyfin ~10.8/10.9 — verify against the user's actual schema before parsing):

- `TypedBaseItems` — every "item" in the library (movies, episodes, etc.) with `Type`, `Path`, `Name`, `ProductionYear`, `OfficialRating`, `RunTimeTicks`, JSON-serialized `Data`, and `ProviderIds` (a string like `imdb=tt1375666;tmdb=27205`).
- `UserData` — per-user watch state: `key` (identifies the item), `userId`, `playCount`, `isFavorite`, `playbackPositionTicks`, `lastPlayedDate`, `played`.
- `Users` (in `jellyfin.db`) — user accounts; we'll need a mapping step from Jellyfin user IDs to Mu user IDs.

`Ticks` are .NET ticks (10,000,000 per second). Convert to seconds with `ticks / 10_000_000`.

#### C. Jellyfin official Backup plugin

The "Backup" plugin (`Jellyfin.Plugin.Backup`) produces a single `.zip` containing config, the database files above, plugins state, and metadata directories. **It does not include media files** — only references to them by path. This is the most complete export and the most natural file shape for an admin upload, but it requires the user to have the plugin installed.

#### D. API

For users with a running Jellyfin server, the REST API can produce equivalent data without files: `GET /Items?recursive=true&includeItemTypes=Movie&fields=...` plus `/Users/{id}/Items` for watch state. We **won't rely on this for v1** — the user may be importing from a server that's already shut down. But we should design the parser layer so that an "API source" adapter can feed the same normalizer later.

### 1.2 Plex

Plex is closed-source and historically reluctant to publish data formats. The export landscape has three tiers:

#### Tier 1 — Plex's own "Library Export" (Plex Pass, web UI)

Available since ~2019 to Plex Pass subscribers. Plex Web → library → ⋯ → Export Library. Produces an **XML or CSV file** describing the items, with field selection driven by a configurable "level" (Level 1: title/year; up to Level 9: everything). The level can be saved as a named preset.

A Level-9 movie row in XML looks roughly like:

```xml
<MediaContainer>
  <Video ratingKey="12345" guid="plex://movie/5d776b59ad5437001f79a91d"
         type="movie" title="Inception" originalTitle="Inception"
         contentRating="PG-13" summary="..." rating="8.8" audienceRating="8.4"
         year="2010" tagline="..." duration="8880000" originallyAvailableAt="2010-07-16"
         addedAt="1620000000" updatedAt="1700000000"
         studio="Warner Bros." viewCount="2" lastViewedAt="1723420800"
         userRating="9.0">
    <Genre tag="Action"/>
    <Director tag="Christopher Nolan"/>
    <Writer tag="Christopher Nolan"/>
    <Role tag="Leonardo DiCaprio" role="Cobb" thumb="..."/>
    <Country tag="United States of America"/>
    <Guid id="imdb://tt1375666"/>
    <Guid id="tmdb://27205"/>
    <Guid id="tvdb://..."/>
    <Media id="..." duration="8880000" bitrate="..." width="1920" height="1080"
           aspectRatio="2.35" audioChannels="6" audioCodec="dca" videoCodec="h264"
           videoResolution="1080" container="mkv">
      <Part id="..." key="..." duration="..." file="/data/Movies/Inception (2010)/Inception.mkv"
            size="..." container="mkv" videoProfile="high">
        <Stream id="..." streamType="1" .../>
        <Stream id="..." streamType="2" .../>
        <Stream id="..." streamType="3" language="English" .../>
      </Part>
    </Media>
  </Video>
  ...
</MediaContainer>
```

Strengths:
- Official, structured, includes `viewCount`, `lastViewedAt`, `userRating`, full file paths, technical metadata, and **provider GUIDs** including TMDB and IMDb IDs.
- One file per library, easy to upload.

Caveats:
- Plex Pass only.
- The export is **per the user who triggered it** — there's no multi-user watch history in this export.
- Plex's GUID space evolved: older items have `guid="com.plexapp.agents.imdb://tt1375666?lang=en"`; newer items have `guid="plex://movie/..."` plus child `<Guid id="imdb://...">`. Our parser must extract IDs from **either** form.
- The export "level" affects which attributes are present. A Level-1 export has only title/year; Level-9 has everything. We can't tell the level from inside the file in a structured way — we have to detect by which fields are populated and report what we found.

#### Tier 2 — Webtools-NG / Webtools-NX (community)

Web GUI tool that talks to Plex's HTTP API and exports curated XML/JSON/CSV. Especially useful before Plex shipped its native exporter, and still preferred for some workflows because the user can pick fields. The format is a tool-specific superset of what Plex returns from its API. We'll **support only Plex's native export format in v1**; if a user has Webtools output we can document that they should re-export via Plex's native dialog.

#### Tier 3 — Plex's SQLite database

Located at `Plug-in Support/Databases/com.plexapp.plugins.library.db` under the OS-specific Plex data directory. Schema is undocumented and changes between Plex versions. Tables of interest (approximate names — verify against the actual file before relying on them):

- `metadata_items` — items.
- `media_items`, `media_parts`, `media_streams` — file/track info.
- `taggings` + `tags` — genres, actors, directors as a join.
- `metadata_item_settings` — per-account per-item viewCount, lastViewedAt, userRating.
- `accounts` — user accounts.

Strengths: complete, including multi-user watch state and watchlists.

Caveats: closed format, no version tag, schema drift between Plex versions. Anything we build against the DB has to be defensive. Realistically, **we should treat the DB as a Tier 3 (best-effort, opt-in, advanced)** strategy — not a primary one.

#### Tier 4 — Companion files on disk

Plex (with the appropriate agent settings) and many users via tools like Radarr write **NFO** files alongside media even on a Plex setup. If those exist, the **Jellyfin NFO importer reuses them** for free. This is a happy accident worth highlighting in the wizard ("we detected NFO files in this folder — would you like us to use those instead?").

### 1.3 Comparison

| Dimension | Jellyfin | Plex |
|---|---|---|
| Open-format export available? | Yes (NFO + JPG sidecars; opt-in) | Plex Pass only (XML/CSV) |
| Watch state in the export? | NFO: primary user only. DB: full multi-user. | XML export: triggering user only. DB: full. |
| Provider IDs (TMDB/IMDb)? | `<uniqueid>` tags | `<Guid id="...">` and/or legacy `guid="..."` |
| Schema version embedded? | No (NFO); schema versioning in DB via DB-internal tables. | No version field in XML; DB schema drifts unannounced. |
| Multi-user data in a single file? | Backup-plugin zip: yes. NFO: no. | XML export: no. DB: yes. |
| Posters/backdrops? | JPG/PNG sidecars next to media. | URLs in XML; bitmap blobs in DB. |
| TV / Music / Photos? | All supported. | All supported. |

---

## Part 2 — Mapping & strategy design

### 2.1 Mu's target schema (movies-only scope for v1)

We'll write into these existing tables (no schema changes required for v1):

- `movies` — core record. `imdbId`, `tmdbId` are the import keys.
- `movie_metadata` — extended/external metadata (genres, cast, ratings).
- `movie_files` — file path + technical metadata. Requires a `media_sources` row to attach to.
- `user_ratings` — per-user 0-10 rating.
- `user_watch_history` — per-user position + completion.
- `user_watchlist` — per-user watchlist (Plex Watchlist).
- `playlists` + `playlist_movies` — collections / playlists.

Things we **don't** have yet that Plex/Jellyfin do — see §3.7 *Gap analysis*. For v1 we'll silently skip those entities and surface their counts in the import report.

### 2.2 Field mapping table

This table is the contract between source data and our schema. The implementer should keep it in sync with the parser code.

| Mu field | Jellyfin NFO | Jellyfin DB | Plex XML | Plex DB |
|---|---|---|---|---|
| `movies.title` | `<title>` | `TypedBaseItems.Name` | `Video@title` | `metadata_items.title` |
| `movies.originalTitle` | `<originaltitle>` | `TypedBaseItems.OriginalTitle` | `Video@originalTitle` | `metadata_items.original_title` |
| `movies.year` | `<year>` | `TypedBaseItems.ProductionYear` | `Video@year` | `metadata_items.year` |
| `movies.overview` | `<plot>` | `TypedBaseItems.Overview` | `Video@summary` | `metadata_items.summary` |
| `movies.tagline` | `<tagline>` | `Data.Tagline` (JSON) | `Video@tagline` | `metadata_items.tagline` |
| `movies.runtimeMinutes` | `<runtime>` | `TypedBaseItems.RunTimeTicks` / 600000000 | `Video@duration` (ms) / 60000 | `metadata_items.duration` (ms) / 60000 |
| `movies.releaseDate` | `<premiered>` | `TypedBaseItems.PremiereDate` | `Video@originallyAvailableAt` | `metadata_items.originally_available_at` |
| `movies.contentRating` | `<mpaa>` | `TypedBaseItems.OfficialRating` | `Video@contentRating` | `metadata_items.content_rating` |
| `movies.imdbId` | `<uniqueid type="imdb">` | `TypedBaseItems.ProviderIds` (`imdb=...`) | `<Guid id="imdb://...">` or legacy `guid="...imdb://..."` | join via `metadata_items` provider columns |
| `movies.tmdbId` | `<uniqueid type="tmdb">` | `TypedBaseItems.ProviderIds` (`tmdb=...`) | `<Guid id="tmdb://...">` or legacy `guid="...themoviedb://..."` | "" |
| `movies.posterUrl` | sibling `poster.jpg` (we copy / re-host) | thumb path in `Data` | `Video@thumb` (HTTP URL on Plex) | bitmap blob → write to disk |
| `movies.backdropUrl` | sibling `fanart.jpg` | `Data.BackdropImageTags` | `Video@art` | "" |
| `movies.addedAt` | NFO mtime fallback | `TypedBaseItems.DateCreated` | `Video@addedAt` (epoch s) | `metadata_items.added_at` |
| `movie_metadata.genres` | `<genre>` (repeated) | `Data.Genres` | `<Genre tag>` | tag join |
| `movie_metadata.cast` | `<actor>` | `Data.People` | `<Role tag>` | tag join |
| `movie_metadata.directors` | `<director>` | `Data.People` (Director) | `<Director tag>` | tag join |
| `movie_metadata.writers` | `<writer>` | `Data.People` (Writer) | `<Writer tag>` | tag join |
| `movie_metadata.imdbRating` | `<ratings>` IMDb | `Data.CommunityRating` | `Video@rating` (audienceRating is TMDB-ish) | settings/ratings |
| `movie_files.filePath` | the NFO's sibling media file | `TypedBaseItems.Path` | `Part@file` | `media_parts.file` |
| `movie_files.durationSeconds` | from probe (post-import) | `RunTimeTicks` / 10000000 | `Part@duration` / 1000 | `media_parts.duration` / 1000 |
| `movie_files.codecVideo` etc. | from probe | `media_streams` | `<Stream streamType=1>` attrs | `media_streams` |
| `user_ratings.rating` | `<userrating>` (one user) | `UserData.Rating` (per user) | `Video@userRating` | `metadata_item_settings.rating` |
| `user_watch_history.completed` | `<playcount>` > 0 | `UserData.Played` | `Video@viewCount > 0` | `metadata_item_settings.view_count > 0` |
| `user_watch_history.positionSeconds` | `<resume><position>` (rare) | `UserData.PlaybackPositionTicks / 10000000` | `<View>` element if present, or `viewOffset` | `metadata_item_settings.view_offset` |
| `user_watch_history.watchedAt` | `<lastplayed>` | `UserData.LastPlayedDate` | `Video@lastViewedAt` (epoch s) | `metadata_item_settings.last_viewed_at` |
| `playlists.name` | n/a in NFO (collections live elsewhere) | `TypedBaseItems` rows of `Type=Playlist`/`BoxSet` | derived from collections / not in standard library export | dedicated tables |

For anything not in this table, the parser should preserve the source-native blob in `movie_metadata.extendedData` (already designed for this) so the data isn't lost.

### 2.3 Conflict resolution

When importing a movie that may already exist in Mu, we resolve identity in this priority order:

1. **TMDB ID** match — strongest signal, used as canonical key by Mu, TMDB, Plex (modern), Jellyfin.
2. **IMDb ID** match — stable, second-strongest.
3. **(title, year) exact match** — case-insensitive, after stripping diacritics and the hint "[2010]" / "(2010)" patterns from titles.
4. **Fuzzy (title, year ± 1)** — Levenshtein ≤ 2 on normalized title, year off-by-one to account for theatrical-vs-DVD release year discrepancies. **Always confirmed by the user**, never auto-applied.
5. **No match** — create new movie record.

Per-conflict resolution choices the wizard offers (default in **bold**):

| Strategy | Behavior |
|---|---|
| **Skip** | Leave existing Mu record untouched; record source data in import log. |
| Merge (fill blanks) | Update only fields where Mu's record is null/empty. Safe default for re-runs. |
| Overwrite | Replace Mu's metadata with the source's. Do **not** overwrite `movies.id`, `addedAt`, or any existing `movie_files`. |
| Keep both | Create a new Mu record. Useful for genuinely-different cuts (Director's Cut, etc.). |

Watch state, ratings, and watchlist entries are **always merged additively** (we never destroy a Mu user's data on import). For a (user, movie) pair where both exist:

- `user_ratings`: the import's rating wins **only if** the existing rating was the default unrated state, or the user explicitly chose "overwrite ratings" in the wizard.
- `user_watch_history`: keep the **furthest** position and the **most recent** `watchedAt`, sum `playCount` if we're tracking that field (we currently aren't — see gap analysis).

### 2.4 Schema versioning

Neither Plex's XML nor Jellyfin's NFO carries an explicit schema-version tag. We deal with this by:

1. **Format detection** runs first — sniff the file to decide which strategy to dispatch. Detection signals:
   - File extension + content peek for: `<MediaContainer>`/`<Video>` (Plex XML), `<movie>` (NFO), `library.db` magic bytes (SQLite), `.zip` containing `manifest.json` plus database files (Jellyfin Backup).
2. **A "compatibility profile" per strategy** that records which fields we extracted successfully and which were missing or unrecognized. This becomes part of the import report. If we see a field we don't recognize, we log it but never fail the import.
3. **Explicit "verified against version X" annotation** in each strategy module: a constant like `LAST_VERIFIED_AGAINST = { plex: '1.40.x', jellyfin: '10.9.x' }`. The README and wizard surface this so the admin knows what they're trusting.
4. **Version override:** the wizard's Advanced section lets the user pick a specific strategy variant — e.g. "Plex export — Level 9 (verified 1.40.x)" vs "Plex export — pre-2022 (legacy GUID format)". The default is **auto-detect**.
5. **Graceful fallback chain:**
   - Plex XML strategy fails to recognize the GUID format → fall back to title+year matching for those rows; flag them in the report.
   - Jellyfin NFO has unknown `<uniqueid type="...">` providers → store them in `extendedData` and continue.
   - Jellyfin DB schema differs → the parser opens the user's `library.db`, reads `sqlite_master`, and records which expected tables/columns are missing. If too many are missing, we abort with a useful error pointing the user at the NFO path or at filing an issue with the schema dump.

### 2.5 Asset handling (posters, backdrops, NFO sidecars)

Poster URLs in Plex XML are server-relative HTTP URLs that **only resolve while the source server is up**. We should not store them as live URLs. Strategy:

- During import, **download** the asset from the source server (if reachable) or **copy** from sibling files (Jellyfin), and write into our existing media-asset path used by `movies.posterUrl` / `backdropUrl`. The wizard asks whether the source server is still online and reachable; if no, we just record the metadata text fields and let our metadata refresh job pull fresh art from TMDB later (which is cheap).
- For Jellyfin Backup zips, the metadata directory is included — extract and use directly.

---

## Part 3 — Feature specification

### 3.1 Module layout

New NestJS module: `packages/server/src/imports/`

```
imports/
  imports.module.ts
  imports.controller.ts          # admin REST endpoints
  imports.service.ts             # orchestrates a job
  formats/
    format-detector.ts           # sniffs uploaded file, returns strategy id
    strategy.interface.ts        # ImportStrategy contract
    jellyfin-nfo.strategy.ts
    jellyfin-backup.strategy.ts
    jellyfin-db.strategy.ts      # advanced, opt-in
    plex-export-xml.strategy.ts
    plex-db.strategy.ts          # advanced, opt-in (Tier 3)
  matching/
    matcher.ts                   # TMDB → IMDB → title+year → fuzzy
    normalize.ts                 # title normalization helpers
  pipeline/
    plan.ts                      # produces an ImportPlan from parsed data
    execute.ts                   # writes the plan to DB inside a job
    asset-fetcher.ts             # poster/backdrop downloader
  models/
    parsed-movie.ts              # source-agnostic intermediate shape
    import-plan.ts
    import-report.ts
```

The `ImportStrategy` contract:

```ts
export interface ImportStrategy {
  readonly id: 'jellyfin-nfo' | 'jellyfin-backup' | 'jellyfin-db' | 'plex-export-xml' | 'plex-db';
  readonly displayName: string;
  readonly lastVerifiedAgainst: string;       // e.g. 'Jellyfin 10.9.x'
  detect(input: ImportInput): Promise<DetectResult>;       // confidence 0..1
  parse(input: ImportInput, opts?: ParseOptions): AsyncIterable<ParsedMovie>;
  // Stream so we don't blow memory on 10k-movie libraries.
}
```

The parser yields a normalized `ParsedMovie` regardless of source. The matcher and plan generator never see source-specific shapes — only `ParsedMovie`. This is the seam that lets us add new strategies later without touching the pipeline.

### 3.2 Pipeline phases

A single import goes through five phases, each surfaced in the wizard UI:

1. **Upload** — admin uploads a file (XML, NFO directory zip, Jellyfin Backup zip, raw `library.db`, etc.).
2. **Detect & parse (dry run)** — we choose a strategy, parse everything, build an `ImportPlan` of "create N new movies, update M existing, flag K conflicts". Nothing is written to the DB yet. Result is shown to the admin.
3. **Resolve conflicts** — admin picks per-conflict resolution (bulk default + per-row override).
4. **Execute** — runs as a background `JobManager` job (so it appears in Admin → Jobs alongside scans). Writes inside a transaction per batch of N movies; partial failures don't poison the rest.
5. **Report** — final import report with counts, failed rows, fields skipped, files we couldn't fetch.

Re-running a finished import with the same file is **idempotent** by default ("Merge — fill blanks"): unchanged Mu records stay untouched. This matters because the admin will inevitably re-run after fixing one issue.

### 3.3 REST API surface

```
POST   /admin/imports/upload          → returns importId, detected strategy, parse summary
GET    /admin/imports/:id             → status + plan
POST   /admin/imports/:id/resolve     → body: per-row decisions
POST   /admin/imports/:id/execute     → starts the job; returns jobId
GET    /admin/imports/:id/report      → final report
DELETE /admin/imports/:id             → discard upload + plan
```

All endpoints are `@Roles('admin')`. Uploads are streamed to a temp directory (`data/imports/<importId>/`) and cleaned up on success or after 24h.

### 3.4 Admin wizard UX

A new entry in Settings → Admin → "Import library". The wizard is five steps mapping to the pipeline phases:

1. **Choose source.** Grid of platform cards: *Jellyfin*, *Plex*, *Other (NFO files)*. Each card shows what file types it accepts and links to a help section in this doc.
2. **Upload.** Drag-drop or pick. For Jellyfin Backup zip / Plex DB the user is warned about size and that this can run for minutes. Strategy detection runs immediately on upload; if confidence is low, the wizard shows "We think this is X — pick a different one if not."
3. **Preview.** Counts (new / update / conflict / unmatchable), sample of 20 rows with their match decision, the strategy's `lastVerifiedAgainst` annotation, and a list of fields the parser found that we don't currently store (linked back to §3.7 gap analysis so it's clear they'll be skipped).
4. **Resolve conflicts.** Default resolution (Skip/Merge/Overwrite/Keep both) plus a table of every flagged row with per-row override and a "fuzzy match — confirm?" dialog for any title-match decision below the strict threshold.
5. **Run & monitor.** "Start import" button kicks off a job, the wizard pivots to a live progress view (same component as Admin → Jobs), and the final report appears when done with download links for: full report (CSV), failed rows (CSV), skipped fields (JSON).

### 3.5 CLI / npm script

For headless / first-time setup, the same pipeline is exposed as a CLI:

```bash
# From src/, after `pnpm install` and `pnpm build`:
pnpm import \
  --source jellyfin-nfo \
  --path /mnt/jellyfin-library \
  --user admin \
  --conflict merge \
  --dry-run

pnpm import \
  --source plex-export-xml \
  --file ~/Downloads/plex-export.xml \
  --conflict skip
```

Implemented as a small bin script in `packages/server/src/cli/import.ts` that boots the same `ImportsService` against the on-disk DB, runs all five phases, and prints the report to stdout (also writes to `data/imports/cli-<timestamp>/`). Wire into `package.json` as `"import": "node dist/cli/import.js"` once built.

The README gets a new section "Importing from Plex / Jellyfin" pointing at this doc and showing the two flows (admin UI, CLI).

### 3.6 Error handling and resilience

Per-row failures must never stop the whole import. The pipeline:

- Wraps each `ParsedMovie` in a try/catch. A failure is recorded as a row in the report with the source identifier and the error message.
- Persists the in-progress plan + decisions to disk (`data/imports/<importId>/plan.json`) so a server restart mid-execute can resume.
- Uses small DB transactions per N=100 rows, not one big transaction, so a poison row doesn't roll back hundreds of successes.
- Logs every parser-skipped field once per strategy run (deduped by field name) into the report's "unrecognized fields" section. This gives us a feedback loop: if a strategy version drifts, the admin's report will tell us what new tags the source uses, which goes straight into the next round of strategy work.

### 3.7 Gap analysis — what Plex / Jellyfin do that Mu doesn't

The parser will encounter and skip these for now. Each is a candidate for a future feature:

| Concept | Where it shows up | Notes for Mu |
|---|---|---|
| TV shows / Episodes | Both, primary content type | Largest gap. Would need new schema (`shows`, `seasons`, `episodes`, plus per-episode files and watch state). |
| Music / Photos | Both | Out of scope for a movie streamer; probably never. |
| Collections / Box sets | Plex Collections, Jellyfin BoxSet | Could map to `playlists` with a `kind=collection` flag, but loses smart-collection rules. |
| Smart playlists | Jellyfin | We have `playlists.isSmart` + `smartRules` already; need rule translator. |
| Multi-user watch state | Jellyfin DB / Plex DB | We support per-user watch history already; need a user-mapping step in the wizard. |
| Trailers | Both | We have `movies.trailerUrl`. Easy to import from `<trailer>` (NFO) and Plex extras. |
| Extras / Featurettes | Plex (`extras` directory), Jellyfin local trailers | No Mu schema for extras. Skip. |
| Subtitles (external sidecars) | Both | Mu's existing scanner handles `.srt`/`.ass` siblings. The importer just needs to leave the path alone. |
| Audio mixes / per-track preferences | Plex `Stream@selected` | Mu has `audio_profiles` but not per-movie selections. Skip. |
| Parental controls / per-user libraries | Both | Mu has roles; no parental gating. Skip. |
| Markers (intro / credits skip) | Plex chapters/markers, Jellyfin chapters | Mu has no chapter table. Skip. |
| Themes (intro music) | Both | Skip. |
| Watch-together / sync sessions | Both | Skip. |
| Live TV / DVR | Jellyfin, Plex | Out of scope. |

### 3.8 Milestones

A reasonable order to ship this:

1. **M1 — Jellyfin NFO importer (read-only preview).** Parse a folder of NFO files, produce an `ImportPlan`, render the wizard preview screen. No DB writes. *Smallest viable slice; validates the pipeline shape.*
2. **M2 — Conflict resolution + execute.** Hook up the matcher + executor for NFO. Produce the report.
3. **M3 — Plex Library Export XML importer.** Reuses the matcher/executor; just a new strategy. Asset downloader from a reachable Plex server.
4. **M4 — CLI entry point.** Same code, command-line UX.
5. **M5 — Jellyfin Backup zip.** Unpacks the zip, parses the embedded `library.db`, reuses the same intermediate shape.
6. **M6 — Jellyfin DB / Plex DB direct.** Tier-3 advanced. Surface schema-mismatch errors clearly.
7. **M7 — Hardening.** Resume after server restart, full report CSV downloads, schema-version detector polish.

Each milestone lands behind a feature flag in admin so partially-finished work doesn't ship to all admins at once.

---

## Open questions

1. **Asset hosting.** When we download posters from Plex during import, where do they live? We probably want to add them to the existing media-asset path used by metadata fetchers. Confirm with whoever owns `MetadataService` before M3.
2. **User mapping.** In multi-user imports, the wizard needs a step where the admin maps source user IDs to Mu user IDs. Default behavior: import everything as the admin user. Acceptable for v1?
3. **Source-of-truth ownership.** If a Mu admin imports from Plex, then later their Plex server fetches new metadata, do they want to re-run the import? Probably yes — that's why "Merge — fill blanks" is the default conflict mode. Worth a note in the wizard.
4. **`movies.id` stability.** Re-imports must not change `movies.id` for existing rows — playlists, ratings, history all reference it. The matcher must always **find first, insert only if no match**. Add a unit test that asserts this invariant.
5. **Storage.** Where do imported media files come from? The importer doesn't move/copy media — it expects the paths in the source export to be reachable from the Mu server. Make this explicit in the wizard ("Mu does not move your movies; the paths inside the export must be visible from this server").
