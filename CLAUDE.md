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

SQLite via Drizzle ORM. Schema files in `packages/server/src/database/schema/`.

```bash
cd src
pnpm db:migrate        # Push schema changes (drizzle-kit push --force)
pnpm db:seed           # Seed initial data
pnpm db:studio         # Open Drizzle Studio GUI
pnpm db:reset          # Delete DB files (then run migrate + seed)
```

## Server Architecture

NestJS modules in `packages/server/src/`:

| Module | Purpose |
|--------|---------|
| `auth` | JWT authentication, user sessions |
| `users` | User management |
| `library` | Media source scanning, file discovery |
| `movies` | Movie CRUD, detail endpoints |
| `metadata` | TMDB/OMDB metadata fetching |
| `stream` | HLS transcoding, direct play, subtitle management |
| `plugins` | Plugin system (load, enable, API registry) |
| `jobs` | Background job queue (pre-transcode, scans) |
| `admin` | Admin-only endpoints |
| `remote` | Remote server federation |
| `settings` | App-wide settings |
| `media` | Poster/backdrop image proxying |

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

## FFmpeg

Required for transcoding. On Windows, auto-detected at `C:/ffmpeg/ffmpeg.exe`. On Linux/macOS, must be on PATH or at `/usr/bin/ffmpeg`.

Install scripts at `src/scripts/install.sh` (Unix) and `src/scripts/install.ps1` (Windows).

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

From your local machine:

```bash
# Full deploy (pull, install, build, restart)
echo 'bash deploy.sh' | ssh rw3iss@192.168.50.211

# Restart without rebuilding
echo 'bash $DEPLOY_DIR/src/restart.sh' | ssh rw3iss@192.168.50.211

# Stop server
echo 'bash $DEPLOY_DIR/src/stop.sh' | ssh rw3iss@192.168.50.211

# View logs
echo 'tail -50 /c/Users/rw3is/Documents/Sites/other/mu/data/logs/server.log' | ssh rw3iss@192.168.50.211
```

The local `src/deploy.sh` script is the canonical deploy script. The remote `~/deploy.sh` is an older copy — prefer running the repo version:

```bash
echo 'cd /c/Users/rw3is/Documents/Sites/other/mu/src && bash deploy.sh' | ssh rw3iss@192.168.50.211
```

### Deploy Flow

1. `git pull` on the remote
2. `pnpm install` + `pnpm build` (Turborepo builds shared, server, client)
3. Stops existing server (by PID file, then by port)
4. Starts `node dist/main.js` in production mode (detached, logs to `data/logs/server.log`)
5. Verifies process is alive after 3 seconds

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

### Deploy
- Use `echo 'cd /c/Users/rw3is/Documents/Sites/other/mu/src && bash deploy.sh' | ssh rw3iss@192.168.50.211` (canonical deploy)
- Git remote uses SSH URL: `git@github.com:rw3iss/cinehost.git` (repo was renamed to `mu` but SSH URL still works)
- `pnpm logs` tails local server log; `pnpm logs:prod` tails production via SSH
