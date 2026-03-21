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

### Player
- **Persistent overlay player** -- video stays playing during navigation, with mini and full modes
- **Resume playback** -- pick up where you left off, persisted across refreshes and restarts
- **Subtitles** -- embedded and external subtitle support (SRT, VTT, ASS), online search via OpenSubtitles, upload, appearance customization (font size, color, shadow, background, line spacing, timing offset, vertical position)
- **Audio engine** -- parametric EQ with saveable profiles, dynamic range compressor with dry/wet mix, per-movie audio settings
- **Video effects** -- brightness, contrast, saturation, hue, sepia, grayscale with saveable presets
- **Skip controls** -- configurable skip forward/backward times
- **Keyboard shortcuts** -- full keyboard control for playback, seeking, volume, fullscreen

### Interface
- **Customizable appearance** -- theme (dark/light/auto), accent color, page/panel backgrounds, card spacing/radius/borders, font scaling (5 levels)
- **Responsive design** -- works on desktop, tablet, and mobile
- **PWA** -- installable on mobile devices
- **Processing indicators** -- movies being transcoded show status on cards and detail pages with real-time progress via WebSocket

### Administration
- **Admin dashboard** -- server stats, user management, media sources, log viewer, cache management
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
```

**Required:** `auth.jwtSecret` and `auth.cookieSecret` are the only required settings -- both are auto-generated on first run.

**Recommended:** TMDB and OMDB API keys enable automatic metadata fetching. Get free keys at [themoviedb.org](https://www.themoviedb.org/settings/api) and [omdbapi.com](https://www.omdbapi.com/apikey.aspx).

### Environment Variables

Override any config value with `MU_` prefixed env vars. Use double underscores for nested keys:

| Variable | Default | Description |
|----------|---------|-------------|
| `MU_SERVER__PORT` | `4000` | Server port |
| `MU_SERVER__LOG_LEVEL` | `info` | Log verbosity |
| `MU_TRANSCODING__HW_ACCEL` | `none` | Hardware acceleration |
| `MU_THIRD_PARTY__TMDB__API_KEY` | -- | TMDB API key |
| `MU_THIRD_PARTY__OMDB__API_KEY` | -- | OMDB API key |
| `MU_THIRD_PARTY__OPENSUBTITLES__API_KEY` | -- | OpenSubtitles API key |
| `MU_DATA_DIR` | `./data` | Data directory path |

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

# Logs
pnpm logs                     # tail local server log
pnpm logs:prod                # tail production server log via SSH

# Plugins
pnpm plugin:generate <id>     # scaffold a new plugin
pnpm plugin:generate-client-api <id>  # generate client API from plugin schema

# Server management (from src/)
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

### If you want to move the cache:
1. Copy data/cache/streams/ to the new location
2. Update cache.streamDir in data/config/config.yml (or env var MU_CACHE__STREAM_DIR)
3. Restart server — everything works because DB only stores relative path

---

## License

MIT
