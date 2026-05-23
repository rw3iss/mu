# Mu

**A lightweight, self-hosted movie streaming and management platform.**

Stream your local movie collection to any device, fetch metadata and ratings automatically, share your library with others, and manage everything from a single server you control.

---

## Features

### Library & Metadata
- **Library scanning** -- point at directories of movie files and Mu indexes them automatically with real-time file watching
- **Automatic metadata** -- posters, cast, ratings, genres, keywords, and content ratings from TMDB, OMDB/IMDb, and Rotten Tomatoes
- **Discovery** -- related movies, personalized recommendations, browse by person/genre/decade
- **Playlists** -- manual and smart playlists with filter rules (genre, year, rating, etc.)
- **Ratings** -- rate movies on a 0.0-10.0 scale, view aggregated scores from IMDb, Rotten Tomatoes, Metacritic
- **Library sharing** -- share your library with other Mu instances over the network

### Streaming & Transcoding
- **HLS adaptive streaming** -- FFmpeg transcoding with automatic format detection, or zero-overhead direct play for compatible formats
- **Chunked transcoding** -- movies are transcoded in independent chunks for fast startup, seek support, and crash recovery (configurable chunk size)
- **Smart seek** -- seeking to an untranscoded position reprioritizes encoding chunks so playback resumes quickly without wasting completed work
- **Resumable transcoding** -- interrupted transcodes resume automatically on server restart, prioritizing recently watched movies
- **Hardware acceleration** -- NVENC, QSV, VAAPI support with automatic software fallback when hardware encoding fails
- **Multiple quality levels** -- 480p through 4K, selectable per-stream, capped at source resolution
- **Pre-transcoding** -- movies are transcoded in the background ahead of playback for instant streaming
- **Cache validation** -- detects and repairs broken or incomplete transcode caches on startup
- **Graceful shutdown** -- running transcode jobs are cleanly interrupted and resumed on next start
- **Encoder health banner** -- if hardware encoding breaks (NVENC DLL init failure, missing capable device, etc.) a dismissable banner appears in the corner with a "Retry GPU" button; the warning re-fires on each new failure but never re-pesters after dismissal
- **Friendly job errors** -- FFmpeg failures are translated into plain-English explanations in the admin Jobs panel ("Source file appears corrupt — the Matroska/MKV header is missing or damaged", "Hardware encoder unavailable", etc.) instead of opaque exit codes
- **Path-safe input** -- file paths containing FFmpeg-reserved characters (square brackets in scene-release tags, etc.) are wrapped in the `file:` protocol so they don't get parsed as filter syntax

### Player
- **Persistent overlay player** -- video stays playing during navigation, with mini and full modes
- **Resume playback** -- pick up where you left off, persisted across refreshes and restarts
- **Subtitles** -- embedded and external subtitle support (SRT, VTT, ASS), online search via OpenSubtitles, upload, appearance customization (font size, color, shadow, background, line spacing, timing offset, vertical position)
- **Parametric EQ** -- 10-band graphic EQ + amp slider, lazy Web Audio attach (zero overhead until enabled), saveable profiles
- **EQ Spectrum visualizer** -- real-time FFT analyser rendered behind the slider grid, log-spaced and aligned to band frequencies (toggle with the **Spectrum** pill)
- **Auto-EQ** -- sample the live audio for 1–10 seconds, compute the average energy at each band, and drive every slider to its flattening offset; a 0.1–1.0 **Factor** scales the strength of the correction (default 0.5 — full strength tends to over-correct)
- **Dynamic range compressor** -- threshold/ratio/knee/attack/release, parallel dry/wet mix, makeup gain, saveable profiles
- **Compressor curve visualizer** -- live transfer-curve display behind the parameter sliders showing 1:1 reference, knee region, threshold, the static curve, a moving live-signal dot, and a real-time gain-reduction meter
- **Auto-Compressor** -- measure peak / RMS / crest factor over a sample window and derive sensible threshold + ratio + makeup gain; the same **Factor** slider blends from "no compression" (neutral) to the computed values
- **Video effects** -- brightness, contrast, saturation, hue, sepia, grayscale, plus gamma, black level (SVG `<feComponentTransfer>`), unsharp-mask sharpen (SVG blur+composite), uniform crop (zoom past letterbox), and vertical scale (correct squished/stretched aspect)
- **Saveable effect profiles** -- name, save, load, clone, delete EQ / compressor / video presets independently, restored across refreshes
- **Skip controls** -- configurable skip forward/backward times
- **Keyboard shortcuts** -- full keyboard control for playback, seeking, volume, fullscreen

### Interface
- **Customizable appearance** -- theme (dark/light/auto), accent color, page/panel backgrounds, card spacing/radius/borders, font scaling (5 levels)
- **Responsive design** -- works on desktop, tablet, and mobile
- **PWA** -- installable on mobile devices
- **Processing indicators** -- movies being transcoded show status on cards and detail pages with real-time progress via WebSocket

### Favorites & People
- **Favorites** -- star any cast member, director, writer, or movie. One shared `<FavoriteButton>` (sizes mini/normal/large) appears next to movie titles, director names, and cast rows on both the Movie Details page and the playing-movie info flyout. Favorites are cached client-side as keyed Sets for O(1) `isFavorite()` checks.
- **Favorites page** -- search, sort (recent / name / role / year), filter by type (All / People / Movies / Actors / Directors / Writers), and toggle cards-vs-list view.
- **Person Details** -- click any cast row or director name to open a person page with profile photo, biography, birth/place facts, and known-for credits cross-referenced against your library. Backend fetches and caches from TMDB on demand (`/people/:key` where key is `tmdb:<id>` or `name:<slug>`).

### Administration
- **Admin dashboard** -- server stats, user management, media sources, log viewer, cache management
- **Bulk movie operations** -- multi-select cards (Edit toggle in Library and Search), bulk re-scan, refresh metadata, clear metadata, hide/unhide, mark watched/unwatched, remove from library, delete from disk; per-movie failures are isolated so one bad row doesn't kill the batch
- **Job history with friendly errors** -- the Admin → Jobs panel surfaces translated FFmpeg failure reasons (corrupt source, missing input, GPU unavailable, etc.) and offers a "Delete All" with confirm to clear history
- **Plugin system** -- extensible architecture with API endpoint registration, client-side UI slots, settings management, and scaffolding tools

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, NestJS 11 + Fastify, TypeScript |
| **Database** | SQLite via Drizzle ORM (zero-config) |
| **Frontend** | Preact + Signals, Vite, SASS modules |
| **Streaming** | FFmpeg, HLS via hls.js |
| **Audio** | Web Audio API (EQ, compressor, parallel compression) |
| **Monorepo** | Turborepo + pnpm workspaces |
| **Linting** | Biome (tabs, single quotes, trailing commas) |

---

## Requirements

- **Node.js** 20+
- **pnpm** 9+
- **FFmpeg** 5+ (for transcoding and media probing)
- **OS**: Linux, macOS, or Windows

### FFmpeg on Windows

Windows installations via WinGet (`winget install Gyan.FFmpeg`) create symlinks that can have permission issues when called from Node.js. The install script handles this automatically, but if transcoding fails with "Cannot find ffmpeg", copy the binaries manually:

```powershell
# Copy FFmpeg binaries to C:\ffmpeg
$src = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "ffmpeg.exe" |
  Where-Object { $_.DirectoryName -match 'bin$' } | Select-Object -First 1
Copy-Item "$($src.DirectoryName)\*.exe" "C:\ffmpeg\" -Force

# Add to system PATH permanently
[Environment]::SetEnvironmentVariable("PATH", "C:\ffmpeg;" + [Environment]::GetEnvironmentVariable("PATH", "Machine"), "Machine")
```

The server auto-detects FFmpeg at `C:/ffmpeg/ffmpeg.exe` on Windows. Restart after updating the PATH.

---

## Installation

### One-line install

| OS | Command |
|---|---|
| **Linux** (Fedora, Ubuntu, Debian, Arch, Alpine, openSUSE) | `curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh \| bash` |
| **macOS** (Intel / Apple Silicon) | `curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh \| bash` |
| **Windows 10 / 11** (PowerShell) | `iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 \| iex` |
| **Docker** | `docker compose -f docker/docker-compose.yml up -d` |

The installer is interactive — it asks for your data directory, initial movies folder, port, max concurrent jobs, and whether to set up a system service. It auto-installs Node 20+, pnpm, FFmpeg, and build tools as needed. After install it prints the URL to open and (on Linux/macOS) shows the LAN IP + port-forwarding instructions for opening Mu to the wider internet.

<details>
<summary><strong>Reinstall / update in place</strong></summary>

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash -s -- --reinstall

# Windows
iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 -OutFile $env:TEMP\mu-install.ps1
& $env:TEMP\mu-install.ps1 -Reinstall
```

Pulls the latest source, re-installs dependencies, rebuilds, applies any new migrations, and restarts the service if one is installed. Your config, database, and cache are preserved.
</details>

<details>
<summary><strong>Uninstall</strong></summary>

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash -s -- --uninstall

# Windows
iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 -OutFile $env:TEMP\mu-install.ps1
& $env:TEMP\mu-install.ps1 -Uninstall
```

Stops + removes the service, then asks per-item whether to keep the database, cache, and install directory. Preserved data is moved to `~/mu-preserved-<timestamp>/` so nothing is lost by accident.
</details>

<details>
<summary><strong>Non-interactive install (CI / scripted)</strong></summary>

```bash
# Linux / macOS — accept all defaults
curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash -s -- --yes

# Custom install dir + branch
curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash -s -- \
  --yes --dir /opt/mu --branch main

# Windows
iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 -OutFile $env:TEMP\mu-install.ps1
& $env:TEMP\mu-install.ps1 -Yes -InstallDir C:\mu
```
</details>

<details>
<summary><strong>Manual install (git clone)</strong></summary>

If you'd rather drive the steps yourself:

```bash
git clone https://github.com/rw3iss/mu.git
cd mu/src
pnpm install
pnpm build
pnpm db:migrate
pnpm start
```

You'll need **Node 20+**, **pnpm 9+**, and **FFmpeg** on PATH (Windows: `C:\ffmpeg\ffmpeg.exe` works too).

The server listens on port **4000** by default. Open `http://localhost:4000` and create your admin account.
</details>

<details>
<summary><strong>What the installer does</strong></summary>

1. **Detects your OS and package manager** (dnf / apt / pacman / apk / zypper on Linux, brew on macOS, winget on Windows). Installs Homebrew if it's missing on macOS.
2. **Installs prerequisites**: git, Node 20+ (via NodeSource on Debian/Ubuntu so the default repo's old version isn't used), pnpm (via corepack), FFmpeg, and a C++ toolchain (`better-sqlite3` needs one).
3. **Asks for** install directory, data directory, initial media folder, HTTP port, max concurrent jobs, whether to set up a service (systemd / launchd / nssm), and whether to start immediately.
4. **Clones** the repo to your install dir (or pulls latest if `--reinstall`).
5. **Builds** the workspace (`pnpm install` + `pnpm build`).
6. **Writes** `data/config/config.yml` with generated JWT + cookie secrets and your answers. If a config already exists, it's preserved untouched.
7. **Applies the database schema** via the inline migration script.
8. **Installs the service** if you asked — `systemd` unit on Linux, `launchd` agent on macOS, `nssm` service on Windows.
9. **Starts the server** and prints: the localhost URL, the LAN URL, useful commands, and how to port-forward your router for outside-LAN access.
</details>

---

## Configuration

**You almost certainly don't need this section.** Mu is designed to be configured through the web UI after install — open `http://localhost:4000`, create your admin account, and head to **Settings**. From there you can:

- Add a media folder and scan it (Settings → Library).
- Paste TMDB / OMDB / OpenSubtitles / Trakt / Anthropic API keys (Settings → Connections — keys are stored encrypted in the database, never on disk).
- Tune the player, transcoder, scanning behavior, job concurrency, recommendation matching, and access controls.
- Add or remove users and roles (Settings → Users).

The installer auto-generates the only two required values (the JWT and cookie secrets) on first start, so a fresh install boots with zero manual config. **Everything below is for advanced or scripted setups** — running headless, baking config into containers, or overriding values before the UI is reachable.

<details>
<summary><strong>Show advanced configuration (config file + env vars)</strong></summary>

Mu resolves settings in this priority order: **environment variables → `data/config/config.yml` → Settings UI values stored in the database**. The UI is the source of truth for anything a human would normally change — file and env-var configuration is mainly useful for bootstrap and immutable infrastructure.

### Config File

Located at `data/config/config.yml`. Auto-generated with random secrets on first start. Key sections:

```yaml
server:
  host: "0.0.0.0"
  port: 4000
  logLevel: info

auth:
  jwtSecret: "..."              # auto-generated
  cookieSecret: "..."           # auto-generated
  allowRegistration: true

transcoding:
  hwAccel: none                 # none | vaapi | nvenc | qsv

thirdParty:
  tmdb:
    apiKey: ""                  # recommended - movie metadata, posters, cast
  omdb:
    apiKey: ""                  # recommended - IMDb, RT, Metacritic ratings
  opensubtitles:
    apiKey: ""                  # optional - online subtitle search

jobs:
  backend: in-memory            # in-memory | bullmq
  # BullMQ-only (ignored for in-memory backend):
  redis:
    url: redis://localhost:6379
  bullmq:
    queueName: mu-jobs
    concurrency: 2
```

**Required:** `auth.jwtSecret` and `auth.cookieSecret` are the only required settings -- both are auto-generated on first run.

**Recommended:** TMDB and OMDB API keys enable automatic metadata fetching. Get free keys at [themoviedb.org](https://www.themoviedb.org/settings/api) and [omdbapi.com](https://www.omdbapi.com/apikey.aspx).

### Environment Variables

Override any config value with `MU_` prefixed env vars. Use double underscores for nested keys:

| Variable | Default | Description |
|----------|---------|-------------|
| `MU_SERVER__PORT` | `4000` | Server port |
| `MU_SERVER__LOG_LEVEL` | `info` | Log verbosity |s
| `MU_TRANSCODING__HW_ACCEL` | `none` | Hardware acceleration |
| `MU_THIRD_PARTY__TMDB__API_KEY` | -- | TMDB API key |
| `MU_THIRD_PARTY__OMDB__API_KEY` | -- | OMDB API key |
| `MU_THIRD_PARTY__OPENSUBTITLES__API_KEY` | -- | OpenSubtitles API key |
| `MU_DATA_DIR` | `./data` | Data directory path |
| `MU_CACHE__STREAMDIR` | `./data/cache/streams` | Transcode cache directory |
| `MU_JOBS__BACKEND` | `in-memory` | Job queue: `in-memory` (default) or `bullmq` (Redis) |
| `MU_JOBS__REDIS__URL` | `redis://localhost:6379` | Redis URL (BullMQ only) |
| `MU_JOBS__BULLMQ__QUEUE_NAME` | `mu-jobs` | BullMQ queue name |
| `MU_JOBS__BULLMQ__CONCURRENCY` | `2` | Worker concurrency |

### Job Backends

Mu's job runner (scan, metadata, transcode, embedding, ...) is pluggable via `jobs.backend`:

| Backend | Pros | Cons | When to use |
|---|---|---|---|
| **`in-memory`** (default) | Zero deps, single binary, simple ops | Jobs lost on restart; single worker; no horizontal scaling | Standard self-hosted single-server install |
| **`bullmq`** | Redis-persisted; survives restarts; multiple worker processes / machines; native delayed retries | Requires Redis; extra infra to operate | Multi-instance setups, heavy rate-limited workloads, anywhere you need durable / distributed queueing |

Switching backends is non-destructive — the same `JobManagerService` interface is used everywhere, so handlers (scan, metadata, etc.) work identically across both. State is *not* migrated between backends though; in-flight jobs are lost when you flip.

### IMDB Datasets (offline ratings)

IMDB publishes free daily TSV bulk dumps at `datasets.imdbws.com`. Mu can sync the **ratings** table (`title.ratings.tsv.gz`, ~25 MB unpacked, ~1.4M titles) into a local SQLite table and serve all IMDB rating lookups from disk — no OMDB quota, no API latency, daily-fresh.

**What's pulled today:**

| Dataset | Size | What it powers |
|---|---|---|
| `title.ratings` | ~25 MB / 1.4M rows | IMDB rating + vote count per title (read-through cache in front of OMDB) |

**Enabling:**

- Answered "yes" to the *Enable IMDB datasets nightly sync* prompt during install → already on. The first sync runs in the background within a minute of boot; subsequent syncs run once every 24h.
- Toggling at runtime: *Settings → Matching → IMDB datasets (offline ratings) → Enable IMDB datasets sync*. The toggle writes `imdb.datasets.enabled` in the settings store, which the orchestrator picks up live (no restart).
- Manual *Sync now* button in the same panel for an out-of-band refresh.

**Storage & cost:** ~25 MB on disk for the ratings table + index. Sync downloads the gzipped TSV (~5 MB on the wire), streams it through `gunzip`, and upserts via a single transaction so a mid-sync crash leaves the previous data intact. Full sync of 1.4M rows takes ~5–10 minutes on a typical home connection — predominantly network time. Subsequent syncs are the same size since IMDB ships full daily snapshots (no delta format).

**How the read-through works:** `OmdbProvider.getByImdbId` checks the local table first. If it hits, the rating + vote count come from there (daily-fresh) and OMDB is still called for the rich fields (plot, Rotten Tomatoes, Metacritic, etc.). When OMDB is unconfigured or rate-limited, the local table serves the rating alone so movies aren't blocked from getting *something*. A new `getRatingByImdbId` fast-path is also available for callers that only need the rating.

**Future expansion** (not in this release): `title.basics`, `title.principals`, and `name.basics` for fully-local cast/crew lookups and bulk title search without TMDB. The `DatasetSync` interface and orchestrator are pluralised so each new dataset slots in without restructuring scheduling, status, or HTTP surfaces.

### Embeddings & Semantic Similarity

Mu computes a 384-dimensional plot embedding for every movie in your library and uses it for the `embedding` strategy in Discover (semantic "movies that feel like this one" matching, beyond shared cast/genres).

**Model:** `Xenova/all-MiniLM-L6-v2`, served locally via `@huggingface/transformers` (ONNX runtime). ~80 MB model file, downloaded on first use to `<dataDir>/models/`. No API key, no network calls after the first download — runs on CPU.

**Storage:** vectors live in `movie_embeddings` (one row per movie+model, Float32 BLOB). For libraries up to ~50K movies the in-process KNN scan finishes in ~50 ms per query. A `sqlite-vec` migration path is open if you outgrow that.

**Triggering:** the `EmbeddingListenerService` subscribes to `LIBRARY_MOVIE_ADDED` / `LIBRARY_MOVIE_UPDATED` and embeds in the background (single-flight per movie, skipped if the overview text hasn't changed). Disable globally via *Settings → Matching → Auto-enrichment → Plot embeddings* if your hardware is constrained.

**Cost profile:** ~100 ms per embed on a modern CPU; ~100 MB total disk for the model + ~200 MB for vectors across a 50K-movie library. No paid API spend.

**Weighting:** the embedding strategy is one of four blended in the composite scorer. Tune its share in *Settings → Matching → Strategy weights → Plot embedding*. Setting the slider to 0 disables it.

### Standalone Workers (BullMQ only)

With BullMQ active, you can run additional worker processes that pull jobs off the same queue — useful for CPU-heavy work (transcoding, embeddings) or to keep the HTTP server responsive under load.

```bash
# from src/
cd packages/server
pnpm worker:prod         # runs dist/worker.js — no HTTP, just pulls jobs
```

Or via Docker:

```bash
# in docker-compose.yml, uncomment the redis + mu-worker services, then:
docker compose --profile workers up

# scale workers horizontally
docker compose --profile workers up --scale mu-worker=3
```

Workers boot the same NestJS DI graph as the main server, so handlers and configuration stay in lockstep. Just run them against the same Redis + database.

</details>

---

## Development

### Getting Started

```bash
git clone https://github.com/rw3iss/mu.git
cd mu/src

pnpm install
pnpm dev          # server + client with hot reload
```

The dev server runs at `http://localhost:4000`.

### Commands

```bash
# Build & run
pnpm build                    # build all packages
pnpm start                    # start production server
pnpm dev                      # dev mode with hot reload
pnpm dev:server               # server only
pnpm dev:client               # client only

# Database
pnpm db:migrate               # apply schema changes
pnpm db:studio                # open Drizzle Studio (DB browser)
pnpm db:seed                  # seed initial data
pnpm db:reset                 # clear database

# Code quality
pnpm check                    # lint + format (Biome)
pnpm lint:fix                 # fix lint issues
pnpm format                   # format code

# Server settings (read/write settings outside the running server)
pnpm settings                 # list all settings
pnpm settings get <key>       # get a setting value
pnpm settings set <key> <val> # set a setting
pnpm settings delete <key>    # delete a setting

# Server management
pnpm status                   # show server mode, health, uptime
pnpm logs                     # tail local server log
pnpm logs:prod                # tail production server log via SSH
pnpm fix:ffmpeg               # kill orphaned FFmpeg, clear flags, restart
pnpm setup:service            # auto-start on boot (NSSM/systemd/launchd)
pnpm update                   # fetch latest release, migrate, restart
pnpm uninstall                # remove services and app

# Plugins
pnpm plugin:generate <id>     # scaffold a new plugin
pnpm plugin:generate-client-api <id>  # generate client API from plugin schema

# Deploy (from src/)
bash deploy.sh                # git pull, install, build, restart
bash restart.sh               # stop + start (no rebuild)
bash stop.sh                  # stop the running server
```

### Project Structure

```
mu/
  src/
  ├── packages/
  │   ├── server/        # NestJS + Fastify backend
  │   ├── client/        # Preact frontend (PWA)
  │   └── shared/        # Shared types and utilities
  ├── plugins/           # Plugin directory (server + client code per plugin)
  ├── scripts/           # Install, log, and utility scripts
  ├── docker/            # Dockerfile + docker-compose
  └── data/              # Runtime data (gitignored)
      ├── config/        #   config.yml
      ├── db/            #   SQLite database
      ├── cache/         #   transcode and image cache
      └── logs/          #   server logs
```


# How-To Extended:

### Server settings CLI

Manage server settings from the command line without the web UI:

```bash
# List all settings
pnpm settings

# View encoding settings
pnpm settings get encoding

# Enable NVENC hardware acceleration
pnpm settings set encoding '{"hwAccel":"nvenc","preset":"veryfast","quality":"1080p","rateControl":"crf","crf":23,"maxConcurrentJobs":2}'

# Switch to software encoding
pnpm settings set encoding '{"hwAccel":"none","preset":"veryfast","quality":"1080p","rateControl":"crf","crf":23,"maxConcurrentJobs":2}'

# Clear the hwAccelBroken flag (after fixing GPU issues)
pnpm settings delete hwAccelBroken

# Enable/disable background pre-transcoding
pnpm settings set library '{"persistTranscodes":true,"autoScanEnabled":true,"scanIntervalHours":6}'

# View all settings as a table
pnpm settings
```

There is also a browser console utility. Open the browser console (F12) and type `mu.help` for available commands.

### Custom Cache Directory

Transcoded streams are stored in `data/cache/streams/` by default. To use a different location (e.g. a larger drive):

**Option 1: Config file** — add to `data/config/config.yml`:
```yaml
cache:
  streamDir: /path/to/custom/cache/streams
```

**Option 2: Environment variable:**
```bash
MU_CACHE__STREAMDIR=/path/to/custom/cache/streams
```

**Moving an existing cache:**
1. Copy `data/cache/streams/` to the new location
2. Set the new path via config file or env var (above)
3. Restart the server

### GPU Encoding on Windows (NVENC)

Windows services run in **Session 0**, which has no GPU access. If Mu is running as an NSSM service with the default `SYSTEM` account, NVENC hardware encoding will fail and fall back to software (libx264).

To enable NVENC, configure the service to run as your user account:

```bash
# Set service to run as your user (enables GPU access)
nssm set mu-server ObjectName "DOMAIN\Username" "password"
nssm restart mu-server
```

Or re-run the service setup script, which will detect your GPU and offer this automatically:

```bash
pnpm setup:service
```

**Note:** The service account needs "Log on as a service" rights, which NSSM grants automatically. On Linux, systemd services already run as the installing user with full GPU access.

### Restart Windows service/server:
nssm stop mu-server      # stop the service
nssm start mu-server     # start the service
nssm restart mu-server   # restart the service


### Auto-start service on boot:
`pnpm setup:service` — Auto-start on boot
- Windows: creates NSSM service (installs nssm if needed), offers nginx too
- Linux: creates systemd unit, enables + starts
- macOS: creates launchd plist, loads it

`pnpm uninstall` — Clean removal
- Stops and removes all services (NSSM/systemd/launchd)
- Kills orphaned FFmpeg processes
- Optionally deletes data (DB, config, cache)
- Removes install directory

### Update installation to latest release:
`pnpm update` — Fetch latest release
- Downloads from GitHub releases API
- Creates timestamped backup
- Runs upgrade-patch.sh if present in the release
- Installs deps, builds, runs migrations, restarts

---


### GPU Doctor

If you're experiencing slow transcoding, encoding failures, or GPU-related issues, Mu includes a **GPU Performance Doctor** utility that can diagnose and fix common problems on any platform.

The scripts are located in `src/scripts/gpu-doctor/`. Pick the one for your environment:

```bash
# Linux / macOS / Git Bash / WSL
bash src/scripts/gpu-doctor/gpu-doctor.sh

# Windows PowerShell
.\src\scripts\gpu-doctor\gpu-doctor.ps1

# Windows CMD (or double-click)
src\scripts\gpu-doctor\gpu-doctor.bat
```

**What it checks:**

- **GPU detection** — NVIDIA via nvidia-smi, with AMD/Intel/Apple Silicon awareness
- **Thermals** — temperature, fan speed, thermal/power/HW throttle detection
- **NVENC encoder** — utilization %, active sessions, saturation warnings
- **VRAM pressure** — usage percentage with capacity warnings
- **GPU processes** — identifies apps (Blue Iris, OBS, etc.) competing for NVENC
- **FFmpeg** — version, NVENC/CUVID/CUDA availability
- **Power plan** — Windows plan, macOS Low Power Mode, Linux CPU governor
- **Driver version** — flags outdated drivers
- **Clock speeds** — current vs max boost

**What it can fix** (interactively, or automatically with `--auto`):

- Switch power plan to High Performance
- Raise GPU power limit to maximum
- Set CPU max processor state to 100%
- Enable GPU persistence mode (Linux)
- Set CPU governor to performance (Linux)
- Disable Low Power Mode (macOS)

**Flags:**

| Flag | Description |
|------|-------------|
| `--report-only` | Diagnostics only, no fix offers |
| `--auto` | Apply all safe fixes without prompting |
| `--json` | Machine-readable JSON output |

The bash script handles Windows (Git Bash/MSYS2/WSL), macOS, and Linux with platform-specific checks. The PowerShell script is Windows-native with identical analysis logic.


## License

MIT
