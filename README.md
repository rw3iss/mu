# CineHost

**A lightweight, self-hosted movie streaming and management platform.**

Stream your local movie collection to any device, fetch metadata and ratings automatically, share your library with others, and manage everything from a single server you control.

---

## Features

- **Library scanning** -- point at directories of movie files and CineHost indexes them automatically with real-time file watching
- **Automatic metadata** -- posters, cast, ratings, and genres pulled from TMDB, OMDB/IMDb, and Rotten Tomatoes
- **Streaming** -- HLS adaptive streaming with FFmpeg transcoding, or zero-overhead direct play for compatible formats
- **Hardware acceleration** -- NVENC, QSV, VAAPI, and VideoToolbox for fast transcoding
- **Multiple quality levels** -- 480p through 4K, selectable per-stream
- **Subtitles & audio** -- embedded and external subtitle support (SRT, VTT, ASS), multiple audio track selection
- **Resume playback** -- pick up where you left off, across devices
- **Library sharing** -- share your library with other CineHost instances over the network
- **Custom player** -- keyboard shortcuts, PiP, speed control, movie info flyout, EQ and audio compressor
- **Playlists** -- manual and smart playlists with filter rules (genre, year, rating, etc.)
- **Ratings** -- rate movies on a 0--10 scale, import IMDb ratings, view aggregated scores
- **Discovery** -- related movies, personalized recommendations, browse by person/genre/decade
- **PWA** -- installable on mobile, responsive design, swipe gestures
- **Admin dashboard** -- server stats, user management, media sources, log viewer, cache and device management
- **Plugin system** -- extensible architecture for custom metadata sources, routes, and scheduled tasks

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, NestJS 11 + Fastify, TypeScript |
| **Database** | SQLite via Drizzle ORM (zero-config) |
| **Frontend** | Preact + Signals, Vite, SASS modules |
| **Streaming** | FFmpeg, HLS via hls.js |
| **Monorepo** | Turborepo + pnpm workspaces |

---

## Requirements

- **Node.js** 20+
- **pnpm** 9+
- **FFmpeg** 5+ (for transcoding and media probing)
- **OS**: Linux, macOS, or Windows

---

## Installation

### Interactive Installer (Linux / macOS / Windows Git Bash)

Download and run the install script. It checks prerequisites, lets you pick a release, and walks you through configuration:

```bash
curl -fsSL https://raw.githubusercontent.com/rw3iss/cinehost/main/src/scripts/install.sh -o install.sh
bash install.sh
```

The installer will:
1. Check and optionally install Node.js, pnpm, and FFmpeg
2. Show available releases and let you choose one
3. Ask for install directory, data directory, and server port
4. Download, build, and generate a config with random secrets
5. Optionally open the firewall port and install a systemd service (Linux)

### Interactive Installer (Windows PowerShell)

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rw3iss/cinehost/main/src/scripts/install.ps1" -OutFile install.ps1
.\install.ps1
```

### Manual Install

```bash
git clone https://github.com/rw3iss/cinehost.git
cd cinehost/src
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

CineHost is configured through (in priority order):

1. **Environment variables** (prefixed with `MU_`)
2. **Config file** (`data/config/config.yml`, auto-generated on first run)
3. **Settings UI** in the web interface

### Config File

Located at `data/config/config.yml`. Auto-generated with random secrets on first start. Key sections:

```yaml
server:
  host: "0.0.0.0"
  port: 4000
  logLevel: info        # fatal | error | warn | info | debug | trace

auth:
  jwtSecret: "..."      # auto-generated, min 32 chars
  cookieSecret: "..."   # auto-generated, min 32 chars
  allowRegistration: true

media:
  libraryPaths: []      # directories to scan for movies
  scanIntervalMinutes: 60
  watchForChanges: true

transcoding:
  hwAccel: none         # none | vaapi | nvenc | qsv | videotoolbox

dataDir: "./data"
```

### Environment Variables

Override any config value with `MU_` prefixed env vars. Use double underscores for nested keys:

| Variable | Default | Description |
|----------|---------|-------------|
| `MU_SERVER__PORT` | `4000` | Server port |
| `MU_SERVER__LOG_LEVEL` | `info` | Log verbosity |
| `MU_TRANSCODING__HW_ACCEL` | `none` | Hardware acceleration |
| `MU_THIRD_PARTY__TMDB__API_KEY` | -- | TMDB API key for metadata |
| `MU_THIRD_PARTY__OMDB__API_KEY` | -- | OMDB API key for IMDb ratings |
| `MU_DATA_DIR` | `./data` | Data directory path |

Single underscores also work for flat keys: `MU_SERVER_PORT=4000`.

---

## Project Structure

```
cinehost/
  src/
  ├── packages/
  │   ├── server/        # NestJS + Fastify backend
  │   ├── client/        # Preact frontend (PWA)
  │   └── shared/        # Shared types and utilities
  ├── plugins/           # Built-in plugins (TMDB, OMDB, etc.)
  ├── scripts/           # Install and utility scripts
  ├── docker/            # Dockerfile + docker-compose
  └── data/              # Runtime data (gitignored)
      ├── config/        #   config.yml
      ├── db/            #   SQLite database
      ├── cache/         #   image and stream cache
      └── thumbnails/    #   extracted video thumbnails
```

---

## Development

### Prerequisites

Same as production: Node.js 20+, pnpm 9+, FFmpeg 5+.

### Getting Started

```bash
git clone https://github.com/rw3iss/cinehost.git
cd cinehost/src

# Install dependencies
pnpm install

# Start in development mode (server + client with hot reload)
pnpm dev
```

The dev server runs at `http://localhost:4000`. The Vite dev server proxies API requests to the NestJS backend.

### Build & Run (Production)

```bash
# Build all packages
pnpm build

# Start the server
NODE_ENV=production node packages/server/dist/main.js
```

Or use the helper scripts from the repo root:

```bash
bash deploy.sh     # git pull, install, build, restart
bash restart.sh    # stop + start (no rebuild)
bash stop.sh       # stop the running server
```

### Other Commands

```bash
pnpm test          # run tests
pnpm lint          # lint with Biome
pnpm db:generate   # generate DB migration after schema change
pnpm db:migrate    # apply migrations
pnpm db:studio     # open Drizzle Studio (DB browser)
```

### Server Management

The server writes a PID file to `data/mu-server.pid`. The deploy/restart/stop scripts use this to manage the process. Logs go to `data/logs/server.log` when started via the scripts.

For production deployments, the install script can set up a **systemd service** (Linux) that starts automatically on boot:

```bash
sudo systemctl status cinehost
sudo systemctl restart cinehost
sudo journalctl -u cinehost -f
```

---

## License

MIT
