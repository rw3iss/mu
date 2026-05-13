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

### Interactive Installer (Linux / macOS / Windows Git Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/src/scripts/install.sh -o install.sh
bash install.sh
```

The installer checks prerequisites, lets you pick a release, configures API keys, and optionally sets up a systemd service (Linux).

### Interactive Installer (Windows PowerShell)

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rw3iss/mu/main/src/scripts/install.ps1" -OutFile install.ps1
.\install.ps1
```

### Manual Install

```bash
git clone https://github.com/rw3iss/mu.git
cd mu/src
pnpm install
pnpm build
pnpm start
```

The server starts on port **4000** by default. Open `http://localhost:4000` to create your admin account.

### Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

---

## Configuration

Mu is configured through (in priority order):

1. **Environment variables** (prefixed with `MU_`)
2. **Config file** (`data/config/config.yml`, auto-generated on first run)
3. **Settings UI** in the web interface

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
