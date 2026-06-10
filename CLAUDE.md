# CineHost (Mu)

Self-hosted movie streaming and management platform.

## Project Structure

```
/                           # Project root
├── src/                    # Source code root (this is the pnpm workspace root)
│   ├── packages/
│   │   ├── server/         # @mu/server — NestJS + Fastify backend
│   │   ├── client/         # @mu/client — Preact + Vite frontend
│   │   └── shared/         # @mu/shared — Shared types and utilities
│   ├── plugins/            # Plugin directory (server + client code per plugin)
│   ├── scripts/            # Install, scaffold, and utility scripts
│   ├── deploy.sh           # Deploy script (pull, build, restart)
│   ├── stop.sh             # Stop server process
│   ├── restart.sh          # Restart without rebuilding
│   └── package.json        # Workspace root with all top-level scripts
├── data/                   # Runtime data (DB, config, logs, cache) — not in git
│   ├── config/config.yml   # Server configuration (port, API keys, media sources)
│   ├── db/mu.db            # SQLite database
│   └── logs/server.log     # Production server log
└── assets/                 # Static assets (logos, etc.)
```

## Tech Stack

- **Server**: NestJS 11, Fastify 5, TypeScript, Drizzle ORM, SQLite (better-sqlite3)
- **Client**: Preact 10, Preact Signals, Vite 6, SCSS Modules, HLS.js
- **Shared**: TypeScript types and utilities shared between server and client
- **Build**: Turborepo, pnpm workspaces
- **Linting**: Biome (tabs, single quotes, trailing commas, semicolons)
- **Streaming**: FFmpeg via fluent-ffmpeg for HLS transcoding, direct play for compatible formats
- **Package Manager**: pnpm 9.x
- **Node**: >= 20.0.0

## Development

All commands run from `src/`:

```bash
cd src

# Install dependencies
pnpm install

# Run dev (server + client concurrently)
pnpm dev

# Run server only (port 4000 by default)
pnpm dev:server

# Run client only (Vite dev server)
pnpm dev:client

# Build everything
pnpm build

# Lint and format
pnpm check            # biome check --write (lint + format)
pnpm lint:fix          # biome lint --write
pnpm format            # biome format --write
```

## Database

SQLite via Drizzle ORM. Single canonical DB at **`<projectRoot>/data/db/mu.db`** — relative paths in `.env` / config anchor to project root, not cwd, so the file is invariant to which command starts the server.

Schema files in `packages/server/src/database/schema/`.

```bash
cd src
pnpm db:migrate        # Apply schema (node scripts/migrate.js — RELIABLE)
pnpm db:push           # drizzle-kit push --force (introspection workflow only)
pnpm db:generate       # drizzle-kit generate migration SQL
pnpm db:seed           # Seed initial data
pnpm db:studio         # Open Drizzle Studio GUI
pnpm db:reset          # Delete canonical DB files (then run migrate + seed)
```

**Use `pnpm db:migrate` for ordinary schema changes.** It runs the inline migration script (`scripts/migrate.js`) which:
- Resolves the canonical DB path from `PROJECT_ROOT` (invariant to cwd).
- Applies `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` against that single DB.
- Warns if it spots stray DB files left over from the old cwd-dependent setup (`src/data/db/mu.db`, `src/packages/server/data/db/mu.db`).

`pnpm db:push` (drizzle-kit) is kept for the introspection workflow but isn't the primary path — drizzle-kit can silently no-op for additive column changes on SQLite, which is what burned us originally.

## Server Architecture

NestJS modules in `packages/server/src/`:

| Module | Purpose |
|--------|---------|
| `auth` | JWT authentication, user sessions. localBypass works only during initial setup; once a user exists, every request needs a JWT cookie. |
| `users` | User management. Admin-only CRUD with last-admin protection (cannot demote/delete the only admin). |
| `common/permissions` | Three-role model (`admin`/`contributor`/`viewer`) + `PermissionsService` + `@RequireAction(action)` decorator + global `RequireActionGuard`. See `docs/users-and-permissions.md`. |
| `library` | Media source scanning, file discovery. **Direct uploads** (`library-upload.{service,controller}.ts`, `edit:movie` = contributor/admin): `POST /library/upload` streams one file per request (multipart, fields before file) to `<sourcePath>/<relativePath>` — folders rebuilt verbatim; never buffered (50GB cap, `MAX_UPLOAD_BYTES`); path-traversal guarded; `preflight` rejects existing names; `finalize` enqueues a scan + emits `WsEvent.UPLOAD_COMPLETED`. Movies get `movies.uploaded_by` (uploader id) via a `LIBRARY_MOVIE_ADDED` listener matching the written path. **nginx must allow it**: `client_max_body_size 0` + `proxy_request_buffering off` (set by `nginx-setup.sh`). |
| `movies` | Movie CRUD, detail endpoints |
| `metadata` | TMDB/OMDB metadata fetching |
| `stream` | HLS transcoding, direct play, subtitle management |
| `plugins` | Plugin system (load, enable, API registry) |
| `jobs` | Background job queue (pre-transcode, scans). Pluggable backend: `in-memory` (default) or `bullmq` (Redis). |
| `providers` | Provider platform — registry, credentials, rate limiter, audit log. Powers Connections settings page. |
| `recommendations` | Strategy-based similar-movies / personalised / trending. Uses provider platform for external sources. |
| `admin` | Admin-only endpoints |
| `remote` | Remote server federation |
| `settings` | App-wide settings |
| `media` | Poster/backdrop image proxying |
| `uploads` | Public user-file store. `UploadsService.saveImage(buffer, mime, subdir)` writes under `<dataDir>/uploads/<subdir>/` and returns a `/uploads/...` URL served verbatim by Fastify static (`main.ts`). Avatars use `avatars/`; reuse the pattern for future chat/comment media. `@Global`. Feedback attachments (image/video) use `feedback/`. |
| `stream/memory-cache` | **Page-cache residency manager** (`MemoryCacheService`, `@Global`). Movie files are NEVER buffered into the Node heap (multi-GB → OOM). Instead it works WITH the OS page cache: `touch(path)` warms a file into RAM (`vmtouch -t` = `fadvise(WILLNEED)`, or a sequential-read fallback) on play / sprite / convert; bounded by the `encoding.memoryCacheMaxGb` admin budget, it evicts the LRU file (`vmtouch -e` = `fadvise(DONTNEED)`). `forget(path)` releases a converted/deleted original. **Disabled (no-op) unless the admin sets the GB budget** in Settings → Encoding ("Maximum Cache Memory"). Status at `GET /stream/memory-cache/status`. Needs `vmtouch` for active eviction (`sudo dnf install vmtouch`); warm-only without it. |
| `people` | Canonical person rows (TMDB-backed, cached). Powers `/person/:key` detail page; key format: `tmdb:<id>` or `name:<slug>`. |
| `favorites` | Polymorphic favorites (person/movie). Per-user in-memory key cache busted on mutation; `GET /favorites/keys` for client hydration. |
| `imdb-datasets` | Local IMDB bulk-dataset syncs (`title.ratings` + `title.basics` movie subset → `imdb_ratings`/`imdb_titles`, ~250MB). Nightly 3AM job, **idle-gated** (`idleOnly` jobs wait until no other job runs). Enable via `imdb.datasets.enabled` setting OR `MU_IMDB_DATASETS=1` env. `LocalImdbSearchService` powers instant offline title search (rating/genres inline) in the metadata search modal + federated search (`imdb` source). |
| `search` | Federated search (movies + people) over local DB + TMDB + OMDB + Trakt. SSE-streaming via `@Sse('/search/{movies\|people}/stream?q=')` with JSON fallback. Persistent 7d `search_cache` table keyed by (type, normalized_query, source). |
| `feedback` | User feedback. `POST /feedback` (any authed user, multipart with optional `screenshot` image stored inline as a base64 data URL); `GET/DELETE /feedback[/:id]` admin-only (`admin:server`). New feedback fires an `EmailService` admin notification (fire-and-forget). `feedback` table. |
| `email` | Outbound email (global module). Renders local HTML templates (`email/templates/*.template.ts` via `renderTemplate`) and sends via **Brevo OR Resend** (`email.provider`, fetch, no extra dep). `sendFeedbackNotification` → admin (needs `email.adminEmail`); `sendFeedbackReply` → the submitter (resolution/reply, throws on failure so the admin sees it). `isConfigured` = enabled+adminEmail (notifications); **`canSend`** = enabled + the provider's API key (replies — does NOT need adminEmail). `email.replyTo` sets Reply-To (e.g. ryan@…). Config keys: `email.enabled/provider(brevo\|resend)/fromAddress/fromName/replyTo/adminEmail/brevoApiKey/resendApiKey` in `config.yml` (secrets, not committed). Disabled no-op stub by default; never throws on the notification path. |

### Job Backend (pluggable)

`JobManagerService` is an abstract class. Concrete implementations:

- `InMemoryJobProvider` (`jobs/in-memory-job-provider.ts`) — default. Single-process priority queue + toad-scheduler. Zero external deps.
- `BullMqJobProvider` (`jobs/bullmq-job-provider.ts`) — Redis-backed via [BullMQ](https://docs.bullmq.io). Persistent, supports horizontal scaling.

Selected at bootstrap via `jobs.backend` in `config.yml` (`in-memory` or `bullmq`). The factory in `JobModule` instantiates the chosen backend; callers always inject `JobManagerService` and never know which one is active.

**Two-tier concurrency (in-memory provider).** `encoding.maxConcurrentJobs` (default 2) caps total running jobs; `encoding.maxConcurrentIoJobs` (default **1**) is a *second, lower* cap that applies only to whole-file disk-heavy types (`sprite-sheet`, `pre-transcode`, `convert-mp4`). `processQueue` scans the priority queue and skips a heavy job that's blocked by the I/O cap, still running light jobs (metadata/scan) past it — so a fresh-scan burst of sprite/transcode work serializes off one HDD instead of thrashing it and starving playback. Both are set in `Settings → Encoding`. (BullMQ uses its own per-queue concurrency and ignores these.)

To run additional worker processes (BullMQ only):
```bash
cd packages/server && pnpm worker:prod    # local
docker compose --profile workers up        # docker
```

### Provider Platform (`providers` module)

Cross-cutting framework for external integrations (TMDB, Trakt, OpenAI, Anthropic, …). Key pieces:

- `ProviderRegistry` — lookup by capability (`recommend`, `enrich`, `embed`, `rerank`, `explain`).
- `ProviderCredentialsService` — DB-backed credential storage with masking. **Secrets never live in config.yml or this repo.** Managed via `Settings → Connections`.
- `RateLimitService` — declarative `RateLimitSpec` per provider, persisted token-bucket state, monthly USD budget enforcement.
- `ProviderEventsService` — append-only audit log (call/error/rate_limit/budget_exhausted). Powers dashboard sparklines.

Adding a new external source = one class implementing `Recommender` / `Enricher` / `Embedder` / `LLMClient` + `@RegisterProvider()` decorator. Registry pickup + admin UI form generation is automatic.

## Client Architecture

Preact SPA in `packages/client/src/`:

| Directory | Purpose |
|-----------|---------|
| `pages/` | Route-level components (Library, MovieDetail, Settings, etc.) |
| `components/` | Reusable UI (player, movie cards, modals, common elements) |
| `state/` | Preact Signals global state (library, player, auth) |
| `services/` | API client services (movies, auth, plugins, etc.) |
| `audio/` | Web Audio API engine (EQ, compressor, dry/wet mix) |
| `hooks/` | Custom hooks (useUiSetting for localStorage persistence) |
| `plugins/` | Client-side plugin system (slot manager, client loader) |

The player is a persistent overlay (no route), managed by `globalPlayer.state.ts`. Video element stays in the DOM across mini/full transitions.

## Plugin System

Plugins live in `src/plugins/<plugin-id>/` with both server and client code:

```bash
# Scaffold a new plugin
pnpm plugin:generate my-plugin

# Generate typed client API from plugin schema (server must be running)
pnpm plugin:generate-client-api my-plugin
```

Each plugin has: `manifest.json`, `index.ts` (server), `client/index.tsx` (client UI slots).

## Configuration

Server config at `data/config/config.yml` (created on first run or by install script). Contains:
- Server port
- API keys (TMDB, OMDB, OpenSubtitles)
- Media source paths
- Auth settings
- `email` (optional): `enabled`, `provider` (`brevo`), `fromAddress`, `fromName`, `adminEmail`, `brevoApiKey` — for admin feedback notifications. Off by default; the Brevo key is a runtime secret kept here (config.yml is not committed).
- `cache.dir` (env `MU_CACHE_DIR`): cache root. When set, **all** caches (streams, images, sprites, subtitles, hot) anchor under it — point at an SSD/NVMe to keep cache I/O off a media HDD. Resolved in `config.loader.ts`; subdirs (`cache.streamDir`, `cache.subtitleDir`, `cache.hot.dir`) derive from it unless explicitly overridden.
- `cache.hot.*`: NVMe hot cache (`stream/media-cache/media-cache.service.ts`). `enabled`, `maxGb` (300), `slowDrives` (e.g. `["D:"]` — only stage HDD sources), `watchedTtlHours`/`unwatchedTtlHours`/`idleTtlHours`. See gotcha below.

## FFmpeg

Required for transcoding. On Windows, auto-detected at `C:/ffmpeg/ffmpeg.exe`. On Linux/macOS, must be on PATH or at `/usr/bin/ffmpeg`.

Install scripts: `src/scripts/install.sh` (Unix release installer), `src/scripts/install.ps1` (Windows), and **`src/scripts/setup-fedora.sh`** — the full Fedora/NVIDIA workstation setup that operates on a cloned repo (RPM Fusion + NVENC ffmpeg, NVIDIA driver, `video`/`render` groups, `.env` import, schema migrate, NVENC smoke test, firewall, `mu.service`). Idempotent; checks the DB and only creates the schema if missing (a copied `mu.db` is preserved). Both Unix installers now run `db:migrate` so the schema exists before first start (a fresh DB's admin is created via the Setup page — no default credentials are seeded).

## Setup, Service & nginx Scripts

Self-host convenience scripts (run from `src/`; documented in `README.md`):

- **`setup.sh`** (`pnpm setup`) — one-shot from a fresh clone: prereq checks → `pnpm install` → `pnpm build` → `pnpm db:migrate` → optional service install.
- **`scripts/service.sh`** (`pnpm service <install|uninstall|status|start|stop|restart|enable|disable|logs>`) — manages Mu as a systemd **user** service (`~/.config/systemd/user/mu-server.service`). User-scoped because the app lives under `/home` (`user_home_t`): SELinux forbids a **system** service (`init_t`) from exec'ing the nvm node / reading `.env` there (`203/EXEC`), even as root. Linger (`loginctl enable-linger`) gives boot-start; logs to the journal; unit uses `RequiresMountsFor` on data+cache so it waits for removable drives instead of shadowing an unmounted mount. `uninstall` removes only the unit (not app/data) — distinct from `scripts/uninstall.sh` which removes the whole install.
- **`scripts/nginx-setup.sh`** (`pnpm nginx:setup -- [--domain --port --client-dir --letsencrypt --email --no-static --yes]`) — creates an nginx reverse-proxy site, optional Let's Encrypt (webroot authenticator: `^~ /.well-known/acme-challenge/` served from `/var/www/certbot`, since the catch-all proxy would otherwise return the SPA to the challenge). Fedora-first (then Debian/Ubuntu, macOS, Windows best-effort). Sets the `httpd_can_network_connect` SELinux boolean (else proxy 502s); serves the client's `/assets/` from disk **only when the nginx user can read them**, else auto-falls back to pure proxy (the home-dir / `user_home_t` case — the node server serves its own static). LE needs DNS→host + router-forwarded **80 and 443 (pointed at nginx, not the app port)**.
- **`scripts/autodeploy.sh`** (`pnpm autodeploy <install|uninstall|status|start|stop|restart|logs|run>`) — installs the `mu-autodeploy` user service running `auto-deploy-watch.sh` (push-to-deploy; see Production Server § below). Cross-platform watcher; restarts the `mu-server` user service on Linux. Skips deploy when the working tree is dirty.
- **`scripts/deploy-fedora.sh`** (`pnpm deploy [-- --no-push]`) — low-downtime **manual** deploy to the Fedora box, the synchronous counterpart to the auto-deploy watcher. Pushes the current branch, then over one SSH session: pauses `mu-autodeploy` (no double-deploy), `git reset --hard`, **builds while the old server keeps serving**, migrates, then a single fast `systemctl --user restart mu-server`, and waits for HTTP 200/401. Build-first + the bounded shutdown (below) make the visible gap a few seconds, not the old ~90s. Env: `MU_REMOTE_HOST`, `MU_REMOTE_PATH` (repo root), `MU_DEPLOY_BRANCH`, `MU_PUBLIC_URL`.

**Restart downtime — root cause + fix.** Deploy downtime was never the build (that runs while the old server serves) — it was the **restart**: `app.close()` would hang (toad-scheduler, chokidar watchers, ffmpeg stdio pipes, the WS server keep the event loop alive), so the process ignored SIGTERM, ate systemd's `TimeoutStopSec` (45s) → SIGABRT → another 45s → SIGKILL ≈ **90s of dead air**. `main.ts` now registers its own SIGTERM/SIGINT handler that runs `app.close()` but **force-exits after a 5s grace window** (`MU_SHUTDOWN_GRACE_MS`), and the unit sets `TimeoutStopSec=15` as a backstop. SQLite (WAL) is crash-safe, so the hard exit can't corrupt the DB.

## Production Server

### Connection

```bash
ssh rw3iss@192.168.50.211
```

This is a Windows machine running Git Bash over SSH. Commands must be piped via stdin:

```bash
echo 'command here' | ssh rw3iss@192.168.50.211
```

### Remote Directory Layout

- **DEPLOY_DIR**: `/c/Users/rw3is/Documents/Sites/other/mu`
- **Deploy script**: `~/deploy.sh` (on the remote, pulls from this repo's main branch)
- **Server logs**: `$DEPLOY_DIR/data/logs/server.log`
- **PID file**: `$DEPLOY_DIR/data/mu-server.pid`
- **FFmpeg**: `C:/ffmpeg/ffmpeg.exe`
- **Server port**: 4000

### Deploying

> **⚠️ Current prod (Windows) does NOT use `deploy-remote.sh`'s restart path.**
> Prod runs in the **interactive desktop session (Session 1)** so NVENC can reach
> the GPU; the NSSM `mu-server` service was **deleted**. `deploy-remote.sh` /
> `deploy.sh` restart via `nssm restart mu-server`, which no longer exists and
> would relaunch in Session 0 (no GPU, wrong port). The canonical script below is
> kept for reference / the eventual Linux host, but on the current box deploy =
> sync + build + migrate, then **restart via the interactive "Mu Server" Task**
> (it executes in Session 1 even when triggered from SSH):
> ```bash
> # On prod, after git is synced + built + migrated:
> MSYS_NO_PATHCONV=1 schtasks /end /tn "Mu Server" 2>/dev/null || true; sleep 1
> powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"; sleep 2
> MSYS_NO_PATHCONV=1 schtasks /run /tn "Mu Server"   # lands in Session 1 (GPU)
> ```
>
> **Auto-deploy (push-to-deploy):** `src/scripts/auto-deploy-watch.sh` polls
> `origin/main` and runs the full sync→install→build (with the Turbo-cache
> `vite build` fallback)→migrate→restart flow on every new commit. It is
> **cross-platform**: on **Linux** it restarts the `mu-server` systemd *user*
> service and health-checks `http://127.0.0.1:4000/`; on **Windows (legacy)** it
> restarts the interactive "Mu Server" task. It **skips a deploy when the working
> tree is dirty** so local edits are never clobbered by `git reset --hard`.
>
> - **Linux (this box):** install as the `mu-autodeploy` user service with
>   `pnpm autodeploy install` (`scripts/autodeploy.sh` — also `uninstall|status|
>   start|stop|restart|logs|run`). Linger gives boot-start; it drives
>   `systemctl --user restart mu-server`.
> - **Windows (legacy):** wired as the "Mu Auto Deploy" logon Task via
>   `src/scripts/register-auto-deploy-task.ps1`.
>
> Log: `data/logs/auto-deploy.log`. With it running, just `git push` and the box
> updates itself within the poll interval (default 60s; `MU_DEPLOY_POLL_SECONDS`).

**The canonical script (reference / future Linux host) — `src/scripts/deploy-remote.sh`:**

```bash
# Canonical deploy: push current branch + remote deploy + external verify
bash src/scripts/deploy-remote.sh

# Skip the git push step (assume HEAD is already on origin)
bash src/scripts/deploy-remote.sh --no-push
```

That single command:
1. Refuses to run if the working tree has uncommitted changes.
2. Pushes the current branch to origin.
3. SSHes to prod and runs `src/deploy.sh`, which **force-syncs git to `origin/main`** (handles detached HEAD / leftover bisect state), reinstalls, rebuilds (always nukes `client/dist/` first to avoid Turbo's partial-restore bug), runs migrations, restarts the NSSM service, and verifies HTTP 200 locally on prod with one auto-retry.
4. After the remote returns, hits `https://mu.ryanweiss.net:4000/` externally and confirms 200.
5. Exits non-zero on any failure — never silently "succeeds" with a broken prod.

Environment overrides: `MU_REMOTE_HOST`, `MU_REMOTE_PATH`, `MU_PUBLIC_URL`.

#### Anti-patterns (do NOT do these)

The following ad-hoc forms used to be common; they all skip the canonical pipeline and have caused real outages (silent rollback to old commits, missing index.html, port-stuck restarts):

```bash
# ❌ Skips git pull — rebuilds whatever stale commit prod's git is on
echo 'cd … && rm -rf packages/client/dist && (cd packages/client && pnpm exec vite build) && nssm restart mu-server' | ssh rw3iss@192.168.50.211

# ❌ Calls deploy.sh but provides no external verification
echo 'cd /c/Users/rw3is/Documents/Sites/other/mu/src && bash deploy.sh' | ssh rw3iss@192.168.50.211
```

Always use `bash src/scripts/deploy-remote.sh` instead.

#### Other one-shots

```bash
# Restart without rebuilding
echo 'bash $DEPLOY_DIR/src/restart.sh' | ssh rw3iss@192.168.50.211

# Stop server
echo 'bash $DEPLOY_DIR/src/stop.sh' | ssh rw3iss@192.168.50.211

# View logs
echo 'tail -50 /c/Users/rw3is/Documents/Sites/other/mu/data/logs/server.log' | ssh rw3iss@192.168.50.211
```

### Deploy Flow (what `deploy.sh` does on the remote)

1. Stop the NSSM service; force-kill anything still holding port 4000.
2. `git fetch origin main && git checkout -f main && git reset --hard origin/main` — survives detached HEAD / local divergence.
3. `pnpm install` + `pnpm build` (Turborepo). `client/dist/` is **nuked first** so Turbo's partial-restore bug can't manifest.
4. If `dist/index.html` or `dist/assets/` is still missing post-build, falls back to a direct `pnpm exec vite build` and re-checks. Aborts non-zero if still bad.
5. Runs DB migrations (`scripts/migrate.js`).
6. Kills orphan Session-0 `node.exe` / `ffmpeg.exe`.
7. NSSM start; waits up to 15s for port bind; then `curl https://localhost:4000/` and confirms 200. If that fails, stops + kills orphans + retries once. If still failing, tails the log and exits non-zero.

## Coding Conventions

- Tabs for indentation, single quotes, trailing commas, semicolons (enforced by Biome)
- Line width: 100
- Server uses NestJS decorators and dependency injection
- Client uses Preact `class` attribute (not `className`)
- Client uses Preact Signals for state management, not React useState patterns
- SCSS Modules for component styling (`*.module.scss`)
- UI settings persisted to localStorage via `useUiSetting` hook

## Gotchas & Patterns

### Windows Production Server
- SSH commands must be piped via stdin: `echo 'cmd' | ssh rw3iss@192.168.50.211`
- NVENC hardware encoding fails with exit code 0xC0000142 (DLL init failure) — server auto-detects and falls back to software globally via `hwAccelBroken` flag
- FFmpeg paths must use forward slashes (`C:/ffmpeg/`) — backslashes fail with `existsSync`
- `stop.sh` grep pipelines need `|| true` to prevent `set -e` from killing deploy when port is already freed
- File paths with special characters (brackets `[`, multiple spaces) can cause FFmpeg failures

### Transcoding System
- Two modes: monolithic (legacy, single FFmpeg per movie) and chunked (new, independent chunks per movie)
- Chunked mode controlled by `useChunkedTranscoding` encoding setting (default: off)
- Chunk manager has its own priority queue separate from JobManagerService
- `validateCache()` must be fast — avoid per-segment `stat()` calls (use `.complete` marker trust)
- Pre-transcode jobs resume on startup; recently watched movies get priority 30 vs 45
- `getEncodingSettings()` is the single source of truth for codec settings — `hwAccelBroken` flag is checked there
- **MP4 direct-play conversion** (`stream/conversion/conversion.service.ts`): converts files to a faststart H.264/AAC MP4 so they direct-play natively (fixes EQ/Compressor — HLS `blob:` MediaSource silences Web Audio). `planConversion` decides per file: H.264→lossless remux; H.264+bad-audio→copy video, AAC audio; non-H.264→re-encode, **skipped** when predicted size > `originalSize × conversionGrowthThreshold` (default 1.25). `convertOriginalFile` (default ON) verifies the new file (ffprobe) then deletes the original and repoints the `movie_files` row; otherwise a cached `persistent/<fileId>/direct/direct.mp4` is served via the `direct/:fileId` route. Jobs: `JOB_TYPE.CONVERT_MP4` (HLS `pre-transcode` kept for the live cold path). New movies auto-convert when `autoConvertToMp4` is on; the whole existing library converts via the **Settings → Admin → Convert and Clear Cache** action (`POST /sources/convert-and-clear-cache`) — startup does NOT mass-delete originals. Completion emits `WsEvent.STREAM_SUPERSEDED {movieId,fileId}`; `useVideoEngine` reloads the playing `<video>` at position onto the new source. **Caveat**: conversion maps first video + first audio only — embedded subtitles are dropped and audio is downmixed to stereo. **Shrink oversized files**: `encoding.reencodeAboveMbps` (Settings → Encoding → "Shrink Files Above", 0=off) — `planConversion` returns action `shrink` for any H.264 file whose whole-file bitrate exceeds the ceiling (H.264 video is otherwise copied verbatim, so high-bitrate BluRay rips stay huge); `convertFile` re-encodes to AV1 (NVENC) or H.264 CRF, only when it would actually get smaller. **Dedup**: `convertFile` no longer writes a `(converted).mp4` sibling into the scanned dir when the canonical `<Title> (Year).mp4` already exists (that sibling used to be re-indexed by the scanner as a duplicate movie) — it skips with `reason: 'target-exists'`. "Re-encode Size Limit" was renamed "Re-encode Growth Limit" (`conversionGrowthThreshold`) — it's the don't-bloat guard, distinct from the shrink trigger.
- **NVMe hot cache** (`stream/media-cache/media-cache.service.ts`): on `WsEvent.STREAM_STARTED` for a **direct-play** session, if the source is on a slow drive (`cache.hot.slowDrives`) the full file is sequentially copied to `cache.hot.dir` (`<cacheRoot>/hot/<fileId>/source.ext`, `.part`→rename, size-verified, `media_cache` row `complete=1`). The `direct/:fileId` route serves the staged copy first (`getHotPath` → in-memory index, no DB on the hot path). Eviction is a scheduled job (`media-cache-evict`, 30 min): age policy (watched/unwatched/idle TTLs) + LRU under `maxGb`, never evicting a file with an active session. `markWatchedFully` fires from `updateProgress` when `completedNow`. Disabled by default — the staging copy itself reads the HDD once, so it's a net win only under concurrency.
- **Scheduled convert window** (`library/convert-sweep.service.ts`): the library-wide `CONVERT_MP4` sweep can be confined to a nightly window instead of running 24/7 (it saturates the media HDD → playback stutter). `encoding.convertSweep` = `{ enabled, startTime "HH:MM", durationHours }`, edited in **Settings → Encoding → Scheduled Conversion Window**. A 5-min `setInterval` enters the window → `enqueueConvertJobs()`, leaves → cancels pending/running convert jobs. Player buffer tiers (`useVideoEngine.ts` `BUFFER_CONFIGS`, default `large`) were bumped to absorb HDD seek stalls.
- **Library watchers self-heal** (`library/watcher.service.ts`): media sources live on **removable `/run/media` mounts** — a drive unmount/remount silently kills chokidar's watch (it keeps watching a dead inode). `ensureWatchersHealthy(reason)` reconciles live watchers vs enabled sources: creates missing, drops disabled/offline, and **re-arms on inode change** (remount), gap-rescanning any source that just (re)gained a watcher. It runs on startup, a **2-min periodic timer**, on source add/remove/update, and at the **start of both manual scan endpoints** (`POST /sources/scan`, `/sources/:id/scan`) so clicking "Scan" revives a dead watcher. Non-inotify filesystems (some FUSE/network shares): set `library.watchPolling` (+ `library.watchPollIntervalMs`, default 4000) — off by default since native inotify is far cheaper.
- **Subtitles** (`stream/subtitles/`): "Search Online" (OpenSubtitles/Subdl) **Download writes the file straight into the movie folder** (`<base>.<lang>[.<slug>].<ext>` via `SubtitleIngestionService.writeSidecar` — the `slug` is a slugified release name so **multiple same-language downloads coexist** instead of overwriting one `<base>.<lang>.<ext>`) + a row in `movie_files.subtitleTracks` JSON — never transient. `parseSubtitleFilename` folds the post-language segments into the track title (`EN · <release>`); `SubtitleTrackRow.fileName` holds the exact sidecar name (shown on hover in the Manage panel, drives precise per-file deletion + cleanup). **Default subtitle** is persisted there too: `SubtitleTrackRow.default` (at most one true), set via `PUT /subtitles/:movieId/:trackIndex/default`, surfaced in `listSubtitles` + the stream session's `subtitles[].default`. Client `restoreSubtitleChoice` auto-selects the server default when there's no per-browser `mu_subtitle_<movieId>` choice. **Admin cleanup**: `POST /subtitles/admin/cleanup-unused` (Settings → Admin → "Clean Up Unused Subtitles") deletes, for every movie with a default set, the *other* downloaded sidecar files (keeps embedded + the default). `setTracks` only persists `index/language/title/external/default` (drops `codec`/`forced`).
- **HEVC handling**: HEVC isn't browser-native, so by default it transcodes to an H.264 HLS *cache* (original kept). Two improvements: (1) **client HEVC direct-play** — the client sends `?hevc=1` when `canPlayType` says it can decode HEVC, and `determineStreamMode(file, {clientHevc})` serves HEVC-in-MP4 direct (native path, audio effects work); background callers omit it so a cache is still built for clients that can't (e.g. Chrome/Linux). (2) **`convertHevcToAv1`** (default off) — when on AND `getEffectiveHwAccel()==='nvenc'` (a genuinely usable GPU), `planConversion` returns `reencode-av1` and `convertFile` re-encodes HEVC→**AV1 MP4** (`av1_nvenc`, `-cq av1Cq` default 32) in place. AV1 is browser-universal + ~HEVC-efficient (no H.264 doubling) and is treated as DIRECT_PLAY. NVENC needs an **interactive desktop session** on Windows (the Session-0 NSSM service can't access the GPU → "No capable devices found").

### Client Player
- Player is a persistent overlay (no route) — `globalPlayer.state.ts` manages lifecycle
- On refresh, always create a fresh stream session — never restore stale session from localStorage
- HLS.js recovery: MAX_FULL_RELOADS=3 prevents infinite retry loops; recovery timers tracked via ref for cleanup on destroy
- `durationSeconds` from server response overrides HLS-reported duration (which grows during live transcoding)

### NestJS Dependency Injection
- Cross-module service injection requires the service to be exported from its module AND imported in the consuming module
- Use callback registration pattern (not `forwardRef`) when modules have circular dependencies (e.g., JobController needing LibraryJobsService)
- `forwardRef` only works within the same module's providers

### Edit Tool & Deep Indentation
- The Edit tool can fail to match strings with deep tab nesting (13+ levels) — use Python string replacement via Bash as fallback
- Always verify edits applied correctly with Read or Grep after deeply-nested changes

### Federated Search
- SSE-streaming via NestJS `@Sse('/search/{movies|people}/stream?q=')`. EventSource auto-reconnects; orchestrator is idempotent per query.
- Client API: `useSearchStream` hook + `EntitySearchInput` / `MovieSearchInput` / `PersonSearchInput` components in `client/src/components/common/EntitySearchInput`.
- Cross-source dedup key order: `imdbId` → `tmdbId` → `movieId` (local) → `slug(title)+year`. Merge unions sources, prefers populated fields, keeps highest matchScore.
- Per-source 5s timeout; failing source emits `error` event but does not block others. Trakt is credentials-gated — silently no-ops when not configured.
- `search_cache` table keyed by hash(type, normalized_query, source). 7d TTL enforced at read time. Local DB results are **never** cached so newly-scanned movies appear immediately.
- Non-library TMDB-only movies: navigate to `/movie/tmdb:<id>` → `MoviesService.findOrFetchByKey` writes a `source='bookmark'` stub row, then `MovieDetail` renders `PreviewActions` (no Play button; shows "View on TMDB" + Bookmark for later).

### Deploy
- **Cadence — batch pushes/deploys.** Commit piecemeal locally as work completes, but **push/deploy infrequently**: only on major changes, after ~3-4 accumulated changes, or when a coherent unit of work is done — not after every small edit (each deploy rebuilds + restarts prod). If unsure whether to push, **ask**. **Before pushing, check for other queued user requests and finish them first**, then run a single batched deploy covering everything.
- Canonical: `bash src/scripts/deploy-remote.sh`. Anything else (raw SSH + `bash deploy.sh`, ad-hoc `rm -rf dist && vite build && nssm restart` shortcuts) skips git-pull or external verification and has caused outages.
- Git remote uses SSH URL: `git@github.com:rw3iss/cinehost.git` (repo was renamed to `mu` but SSH URL still works)
- `pnpm logs` tails local server log; `pnpm logs:prod` tails production via SSH
