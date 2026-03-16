# CineHost

**A lightweight, self-hosted movie streaming and management platform.**

CineHost is an all-in-one solution for organizing your local movie collection, streaming to any device, fetching metadata and ratings from TMDB/IMDb, discovering new movies, and managing your watch history -- all from a single server you control.

---

## Features

### Library Management
- **Scan local directories** for movie files (MP4, MKV, AVI, MOV, WebM, and more)
- **Real-time file watching** -- new, changed, or removed files are detected automatically
- **Automatic metadata** fetching from TMDB and OMDB (posters, cast, ratings, genres, etc.)
- **Multiple media sources** -- add any number of directories, network mounts, or external drives
- **Smart filename parsing** -- extracts title, year, and quality from most naming conventions

### Streaming
- **HLS adaptive streaming** with on-the-fly transcoding via FFmpeg
- **Direct play** for compatible formats (zero CPU overhead)
- **Hardware acceleration** -- NVENC, QSV, and VAAPI support
- **Multiple quality levels** -- 480p, 720p, 1080p, 4K, or original
- **Subtitle support** -- embedded and external (SRT, VTT, ASS), auto-converted to WebVTT
- **Multiple audio tracks** -- select language/dub in the player
- **Resume playback** -- pick up where you left off on any device

### Organization
- **Playlists** -- create custom playlists, drag-and-drop reorder
- **Smart Playlists** -- auto-generated lists based on filter rules (genre + year + rating)
- **Watchlist** -- "To Watch" list for movies you want to see
- **Watch History** -- full history with completion tracking
- **Internal ratings** -- rate movies on a 0.0--10.0 scale (decimal support, e.g., 7.3)
- **Bulk actions** -- multi-select movies to mark watched, add to playlist, refresh metadata

### Discovery
- **Related movies** -- find similar movies based on genre, cast, director, and keyword overlap
- **Personalized recommendations** -- taste profile built from your ratings
- **"Find me something new"** -- discover movies not in your library, filtered by genre/year/rating
- **Browse by person** -- actor and director filmography pages
- **Genre and decade browsing**

### Plugin System
- **Extensible architecture** -- plugins can add API routes, UI panels, scheduled tasks, and metadata sources
- **Built-in plugins**:
  - **TMDB Metadata** -- auto-fetch movie info, posters, cast, similar movies
  - **OMDB/IMDb Ratings** -- IMDb scores, Rotten Tomatoes, Metacritic; import your IMDb ratings
  - **Torrent Search** -- search configurable torrent sites for magnet links (display only)
  - **Rotten Tomatoes** -- critic and audience scores
- **Plugin management UI** -- enable/disable, configure settings, view activity

### Player
- Custom video player with full controls: quality, subtitles, audio, speed, PiP, fullscreen
- **Movie info flyout** -- slide-out panel showing details while watching
- **Keyboard shortcuts** -- Space (play/pause), F (fullscreen), M (mute), S (subtitles), I (info), arrow keys (seek/volume)
- **Mobile gestures** -- swipe for volume/brightness, double-tap to seek

### Mobile / PWA
- **Progressive Web App** -- install on phone home screen, works like a native app
- **Responsive design** -- optimized layouts for mobile, tablet, and desktop
- **Mobile rater** -- swipe-based interface to quickly rate unrated movies
- **Offline browsing** -- cached metadata available without network

### Admin & Server
- **Server dashboard** -- CPU, memory, disk usage, active streams, library stats
- **User management** -- create users with admin or standard roles
- **Media source management** -- add/remove directories, trigger scans
- **Log viewer** -- filterable server logs
- **Cache management** -- view stats, clear cache
- **Device management** -- see connected devices, revoke access

### Coming Soon
- MCP server for AI assistant integration (Claude, etc.)
- Embedding-based movie similarity (local ML model)
- Natural language search ("find me a 90s thriller")
- Chromecast / AirPlay casting
- TV show support

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, NestJS 11 + Fastify adapter, TypeScript |
| **Database** | SQLite (default, zero-config) via Drizzle ORM; PostgreSQL optional |
| **Cache** | In-memory LRU (default); Redis optional |
| **Frontend** | Preact + Signals, Vite, SASS/SCSS modules |
| **Streaming** | FFmpeg, HLS via hls.js |
| **Monorepo** | Turborepo + pnpm workspaces |

---

## Requirements

- **Node.js** 20 or later
- **FFmpeg** 5 or later (for transcoding and media analysis)
- **pnpm** 9 or later (for package management)
- **OS**: Linux (recommended), macOS, or Windows (native or WSL)

### Hardware

| Spec | Minimum | Recommended |
|------|---------|-------------|
| CPU | 2 cores | 4+ cores (for transcoding) |
| RAM | 512 MB | 2 GB |
| Storage | 100 MB (app) | + space for media + cache |

---

## Installation

### Quick Install (Linux / macOS)

```bash
curl -fsSL https://get.mu.app/install | bash
```

This installs Node.js and FFmpeg if needed, downloads CineHost, generates a config file, creates a systemd service, and starts the server.

### Manual Install

```bash
# Clone the repo
git clone https://github.com/your-org/mu.git
cd mu

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Generate database
pnpm db:migrate

# Start the server
pnpm start
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

See [QUICKSTART.md](./QUICKSTART.md) for detailed setup instructions.

---

## Configuration

CineHost is configured through (in priority order):

1. **Environment variables** (prefixed with `MU_`)
2. **Config file** (`data/config/config.yml`, auto-generated on first run)
3. **UI Settings page** (writes to database)

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MU_SERVER_PORT` | `8080` | Server port |
| `MU_AUTH_LOCAL_BYPASS` | `true` | Skip login from localhost |
| `MU_THIRD_PARTY_TMDB_API_KEY` | - | TMDB API key for metadata |
| `MU_THIRD_PARTY_OMDB_API_KEY` | - | OMDB API key for IMDb ratings |
| `MU_TRANSCODING_HW_ACCEL` | `none` | Hardware accel (none/vaapi/nvenc/qsv) |
| `MU_DATABASE_TYPE` | `sqlite` | Database engine (sqlite/postgres) |
| `MU_CACHE_TYPE` | `memory` | Cache backend (memory/redis) |

See the full list in [DEV_IMPLEMENTATION.md](./.claude/plans/DEV_IMPLEMENTATION.md#11-environment-variables-reference).

### Settings UI

The Settings page in the web UI is organized into tabs:

- **Profile** -- username, email, avatar, password
- **Playback & Streaming** -- quality defaults, subtitle/audio language, autoplay, hardware accel
- **Library & Scanning** -- media sources, scan interval, auto-scan, metadata fetching
- **Server** -- host/port, log level, database info, cache info, restart
- **Ratings** -- display scale (5-star vs 10-point), default sort source, visible rating sources
- **API Keys** -- TMDB, OMDB, and other third-party API key management
- **Appearance** -- theme (dark/light/auto), poster size, default view, sidebar
- **Notifications** -- toggle desktop notifications per event type
- **Devices** -- authenticated devices list with revoke option

---

## Project Structure

```
mu/
├── packages/
│   ├── server/        # NestJS + Fastify backend (TypeScript)
│   ├── client/        # Preact PWA frontend (TypeScript + SASS)
│   └── shared/        # Shared types, constants, utilities
├── plugins/           # Built-in plugins
│   ├── tmdb-metadata/
│   ├── omdb-ratings/
│   ├── torrent-search/
│   └── rotten-tomatoes/
├── docker/            # Dockerfile + docker-compose
├── scripts/           # Install and utility scripts
└── data/              # Runtime data (DB, cache, config) -- gitignored
```

---

## Development

```bash
# Start dev mode (server + client with hot reload)
pnpm dev

# Run tests
pnpm test

# Lint
pnpm lint

# Generate DB migration after schema change
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Open Drizzle Studio (DB browser)
pnpm db:studio
```

The dev server runs at `http://localhost:3000` (Vite dev server), proxying API requests to `http://localhost:8080` (NestJS).

---

## API

All endpoints are under `/api/v1/`. Authentication is required unless noted.

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login (returns JWT cookie) |
| POST | `/auth/setup` | First-run admin setup |
| GET | `/movies` | List movies (paginated, filterable) |
| GET | `/movies/:id` | Movie details with metadata |
| POST | `/movies/:id/rate` | Rate a movie `{ rating: 7.3 }` |
| GET | `/stream/:movieId/start` | Start stream session |
| GET | `/playlists` | List playlists |
| GET | `/recommendations` | Personalized recommendations |
| GET | `/search?q=...` | Global search |
| GET | `/admin/status` | Server health (admin) |

Full API documentation: [DEV_HIGH_LEVEL.md](./.claude/plans/DEV_HIGH_LEVEL.md#15-api-design)

---

## Plugins

### Job System

CineHost includes a lightweight, in-process job system for background work. No external queue server is required -- jobs run inside the NestJS process using an in-memory priority queue with configurable concurrency.

#### Built-in Job Types

| Type | Trigger | Description |
|------|---------|-------------|
| `scan` | Manual (UI/API) or scheduled | Scans a media source directory for new/changed/removed files |
| `metadata` | Automatic on new movie | Fetches metadata from TMDB; if extended metadata is enabled, also fetches ratings from OMDB (IMDb, Rotten Tomatoes, Metacritic) |
| `thumbnail` | Automatic on new movie | Extracts a video frame via FFmpeg and stores it as the movie thumbnail |
| `cleanup` | Scheduled (daily) | Prunes completed/failed job records older than 24 hours |

#### How It Works

- **One-off jobs** are enqueued via `JobManagerService.enqueue()` and processed in priority order (lower number = higher priority) with up to 4 concurrent workers.
- **Scheduled jobs** use [toad-scheduler](https://github.com/kibertoad/toad-scheduler) to enqueue a job descriptor at a recurring interval (e.g., daily cleanup).
- **Events**: Job lifecycle events (`job:started`, `job:progress`, `job:completed`, `job:failed`) are broadcast via WebSocket so the frontend can show real-time status.
- **Automatic jobs**: When a new movie file is detected (via scan or file watcher), the system automatically enqueues a `metadata` job and a `thumbnail` job for that movie.

#### REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/jobs` | List jobs (filter by `?type=` and `?status=`) |
| GET | `/api/v1/jobs/scheduled` | List registered scheduled jobs |
| GET | `/api/v1/jobs/:id` | Get a single job's details |
| POST | `/api/v1/jobs/:id/cancel` | Cancel a pending job |
| POST | `/api/v1/jobs/prune` | Remove old completed/failed jobs |

#### Using from Plugins

Plugins can inject `JobManagerService` to register custom handlers and enqueue jobs:

```typescript
// Register a handler for a custom job type
jobManager.registerHandler('my-plugin:task', async (job, helpers) => {
  helpers.log('Working...');
  helpers.reportProgress(50);
  // ... do work using job.payload ...
  return { done: true };
});

// Enqueue a job
jobManager.enqueue({
  type: 'my-plugin:task',
  label: 'My custom task',
  payload: { key: 'value' },
});

// Schedule a recurring job
jobManager.schedule({
  name: 'my-plugin:nightly',
  intervalMs: 24 * 60 * 60 * 1000,
  job: { type: 'my-plugin:task', label: 'Nightly task' },
});
```

#### Configuration

The **Library** tab in Settings includes a "Download Extended Metadata" toggle. When enabled (default), newly scanned movies will automatically fetch ratings and reviews from third-party sources like IMDB, Rotten Tomatoes, and Metacritic.

---

### Creating a Plugin

1. Create a directory in `plugins/` with a `plugin.json` manifest:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "You",
  "entry": "index.ts",
  "permissions": ["network"],
  "settings": []
}
```

2. Export `activate` and optionally `deactivate` functions from your entry file:

```typescript
import { PluginContext } from '@mu/server/plugins';

export async function activate(ctx: PluginContext) {
  ctx.logger.info('Plugin activated');

  ctx.registerRoute('GET', '/hello', async () => {
    return { message: 'Hello from my plugin' };
  });

  ctx.events.on('library:movie-added', (movie) => {
    ctx.logger.info(`New movie: ${movie.title}`);
  });
}
```

3. Enable it in the Plugins page or add it to `plugins.enabled` in config.

---

## License

MIT
