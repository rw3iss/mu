# Mu - Self-Hosted Movie Platform
## High-Level Architecture & Feature Plan

> A lightweight, self-hosted, all-in-one movie cataloguing, streaming, and discovery platform.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Development Stages](#4-development-stages)
5. [Stage 1 - Foundation & Core Server](#5-stage-1---foundation--core-server)
6. [Stage 2 - Library Management & Metadata](#6-stage-2---library-management--metadata)
7. [Stage 3 - Video Streaming Engine](#7-stage-3---video-streaming-engine)
8. [Stage 4 - Frontend Web UI (PWA)](#8-stage-4---frontend-web-ui-pwa)
9. [Stage 5 - Plugin System](#9-stage-5---plugin-system)
10. [Stage 6 - Recommendations & Discovery](#10-stage-6---recommendations--discovery)
11. [Stage 7 - Mobile Experience & PWA](#11-stage-7---mobile-experience--pwa)
12. [Stage 8 - MCP Server & Embeddings](#12-stage-8---mcp-server--embeddings)
13. [Stage 9 - Install System & Distribution](#13-stage-9---install-system--distribution)
14. [Database Schema Design](#14-database-schema-design)
15. [API Design](#15-api-design)
16. [Plugin Architecture](#16-plugin-architecture)
17. [Streaming Architecture](#17-streaming-architecture)
18. [Security & Auth](#18-security--auth)
19. [Caching Strategy](#19-caching-strategy)
20. [Deployment & Infrastructure](#20-deployment--infrastructure)
21. [Full Feature Matrix](#21-full-feature-matrix)

---

## 1. Project Overview

**Mu** is a self-hosted movie management and streaming platform, designed as a lightweight alternative to Plex/Jellyfin, with a focus on:

- **Minimal setup**: Single install script, SQLite by default, no Docker required
- **Movie organization**: Scan local directories, auto-fetch metadata, organize into collections/playlists
- **Streaming**: Efficient video streaming to any authenticated device (web/mobile)
- **Discovery**: Find related/recommended movies via metadata analysis, embeddings, and third-party APIs
- **Extensibility**: Plugin system for torrent search, rating imports, review aggregation, etc.
- **All-in-one**: One server process manages everything; spawns sub-processes as needed (transcoding workers, file watchers, etc.)

### Core Principles

1. **Lightweight first** - runs on modest hardware (Raspberry Pi 4+, old laptops, NAS devices)
2. **Zero-config default** - works out of the box with SQLite + in-memory cache; optionally upgrade to Postgres + Redis
3. **Single source of truth** - one codebase, monorepo structure, shared types between server and client
4. **Privacy-first** - all data stays local; third-party API calls are opt-in and cached aggressively
5. **Progressive enhancement** - start with core features, enable plugins/services as needed

---

## 2. Architecture Overview

```
                         +--------------------------+
                         |     Mu Server            |
                         |      (Node.js/TS)        |
                         |                          |
   Browser/Mobile  <---->|  HTTP API (NestJS+Fastify)|
   (Preact PWA)         |  WebSocket (live updates) |
                         |  Static file serving     |
                         |                          |
                         |  +--------------------+  |
                         |  |   Core Services    |  |
                         |  | - Auth             |  |
                         |  | - Library Manager  |  |
                         |  | - Metadata Fetcher |  |
                         |  | - File Watcher     |  |
                         |  | - Cache Manager    |  |
                         |  | - Plugin Manager   |  |
                         |  | - Stream Engine    |  |
                         |  | - Recommendation   |  |
                         |  +--------------------+  |
                         |                          |
                         |  +--------------------+  |
                         |  |   Sub-processes    |  |
                         |  | - FFmpeg workers   |  |
                         |  | - File scanner     |  |
                         |  | - Thumbnail gen    |  |
                         |  +--------------------+  |
                         |                          |
                         |  +--------------------+  |
                         |  |   Data Layer       |  |
                         |  | - SQLite (default) |  |
                         |  | - In-memory cache  |  |
                         |  | - File system      |  |
                         |  +--------------------+  |
                         +--------------------------+
                                    |
                         +----------+----------+
                         |                     |
                   +-----+------+    +---------+--------+
                   | Local Dirs |    | Third-Party APIs  |
                   | /movies/*  |    | TMDB, OMDB, etc.  |
                   +------------+    +------------------+
```

### Process Model

The main server process (Node.js) handles:
- HTTP API + WebSocket server
- Static file serving (built Preact app)
- Plugin lifecycle management
- Scheduling (periodic scans, cache cleanup)

Sub-processes (spawned and managed by main process):
- **FFmpeg transcoding workers** - forked per-stream for isolation
- **File scanner worker** - background directory scanning (runs in worker thread)
- **Thumbnail generator** - extract poster frames from video files when no metadata poster is available

### Monorepo Structure

```
mu/
├── packages/
│   ├── server/          # NestJS + Fastify server (TypeScript)
│   ├── client/          # Preact PWA (TypeScript + SASS)
│   ├── shared/          # Shared types, constants, utilities
│   ├── plugins/         # Built-in plugin packages
│   │   ├── torrent-search/
│   │   ├── imdb-ratings/
│   │   ├── rotten-tomatoes/
│   │   └── tmdb-metadata/
│   └── cli/             # CLI tool for install/management
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/
│   ├── install.sh       # Unix install script
│   └── install.ps1      # Windows install script (optional)
├── data/                # Default data directory (gitignored)
│   ├── db/              # SQLite database files
│   ├── cache/           # Cached images, metadata
│   ├── thumbnails/      # Generated thumbnails
│   └── config/          # Runtime config
├── turbo.json           # Turborepo config
├── package.json         # Root workspace
└── tsconfig.base.json   # Shared TS config
```

---

## 3. Technology Stack

### Backend
| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Runtime** | Node.js 20+ (LTS) | Stable, widely supported, good streaming primitives |
| **Framework** | NestJS 11 + Fastify adapter (`@nestjs/platform-fastify`) | Best of both worlds: NestJS provides opinionated structure (modules, DI, guards, interceptors, decorators) ideal for a large modular app with plugins, while the Fastify adapter delivers ~45K req/sec (2.5x faster than NestJS+Express). NestJS Dynamic Modules map directly to our plugin architecture. The DI container simplifies service composition. |
| **Language** | TypeScript 5.x | Type safety across the stack |
| **Database** | SQLite (better-sqlite3) | Zero-config, single-file, synchronous (fastest SQLite driver for Node.js), perfect for self-hosted. Heavy queries offloaded to worker threads to avoid blocking event loop |
| **ORM** | Drizzle ORM | TypeScript-first, schema-as-code, no code generation step, ~100x faster than Prisma for SQLite. Supports both SQLite and PostgreSQL with the same schema definitions, enabling easy upgrade path. Handles migrations natively. Minimal overhead over raw SQL. |
| **Cache** | LRU in-memory (lru-cache) | Zero-dependency, fast, configurable TTL and max size. Optional Redis upgrade via ioredis when `REDIS_URL` is set |
| **File Watching** | chokidar | Robust cross-platform file watching |
| **Video Processing** | fluent-ffmpeg + ffmpeg | Industry standard transcoding, HLS generation, thumbnail extraction |
| **WebSocket** | @fastify/websocket | Real-time updates (scan progress, now playing, library changes) |
| **Auth** | @fastify/jwt + @fastify/cookie | JWT tokens with refresh, stored in httpOnly cookies |
| **Validation** | Zod + @fastify/type-provider-zod | Runtime validation + TypeScript type inference |
| **Scheduler** | toad-scheduler | Lightweight cron-like scheduling for periodic tasks |
| **Process Management** | Node.js worker_threads + child_process | Worker threads for CPU tasks, child_process for ffmpeg |
| **Logging** | pino (built into Fastify) | Structured, fast, low-overhead logging |

### Frontend
| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Framework** | Preact 10.x + preact/signals | Tiny (3KB), React-compatible, signals for reactive state |
| **Routing** | preact-router or wouter | Lightweight client-side routing |
| **Styling** | SASS/SCSS modules | Scoped styles, variables, mixins, responsive design |
| **Build Tool** | Vite 6 | Fast HMR, optimal bundling, native SASS support |
| **Video Player** | hls.js + custom controls | HLS playback with custom UI overlay |
| **HTTP Client** | ky or native fetch wrapper | Lightweight HTTP client with interceptors |
| **Icons** | lucide-preact | Consistent, tree-shakeable icon set |
| **State** | @preact/signals + context | Minimal state management, signals for reactivity |

### Infrastructure
| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Monorepo** | Turborepo + pnpm workspaces | Fast builds, dependency hoisting, parallel tasks |
| **Docker** | Multi-stage Dockerfile | Optional containerized deployment |
| **Install** | Shell script + Node.js CLI | Cross-platform install without Docker dependency |

---

## 4. Development Stages

### Stage Overview

| Stage | Name | Priority | Description |
|-------|------|----------|-------------|
| 1 | Foundation & Core Server | **Critical** | Project setup, Fastify server, database, auth, config |
| 2 | Library Management & Metadata | **Critical** | Directory scanning, file watching, metadata fetching, internal movie DB |
| 3 | Video Streaming Engine | **Critical** | HLS transcoding, adaptive streaming, subtitle support |
| 4 | Frontend Web UI | **Critical** | Dashboard, library browser, movie details, player, settings |
| 5 | Plugin System | **High** | Plugin framework, built-in plugins (torrent, ratings, reviews) |
| 6 | Recommendations & Discovery | **High** | Related movies, recommendations, genre/actor/director search |
| 7 | Mobile Experience & PWA | **Medium** | Responsive mobile UI, offline support, PWA manifest |
| 8 | MCP Server & Embeddings | **Medium** | Embedding-based similarity, MCP integration, AI recommendations |
| 9 | Install System & Distribution | **Medium** | Install scripts, auto-update, system service setup |

---

## 5. Stage 1 - Foundation & Core Server

### 5.1 Project Scaffolding
- Initialize monorepo with Turborepo + pnpm workspaces
- Configure TypeScript with shared `tsconfig.base.json`
- Set up ESLint + Prettier for consistent code style
- Create `packages/shared` for shared types, constants, and utilities
- Configure path aliases across packages

### 5.2 NestJS + Fastify Server Bootstrap
- Initialize NestJS application with Fastify adapter (`@nestjs/platform-fastify`)
- Register Fastify plugins via adapter: CORS, helmet, static, cookie, multipart
- Configure NestJS modules: AuthModule, MovieModule, StreamModule, PluginModule, AdminModule, etc.
- Use NestJS guards for auth, interceptors for caching/logging, pipes for validation (Zod)
- Structured logging via Pino (Fastify built-in, exposed through NestJS logger)
- Implement graceful shutdown via NestJS lifecycle hooks (`onModuleDestroy`, `beforeApplicationShutdown`)
- Serve built Preact client as static files from `/` (SPA fallback via `@nestjs/serve-static`)

### 5.3 Configuration System
- Hierarchical config: defaults -> config file (`config.yml`) -> environment variables -> CLI flags
- Config file auto-generated on first run with sensible defaults
- Config schema validated with Zod at startup
- Key config values:
  - `server.host`, `server.port` (default: 0.0.0.0:8080)
  - `database.type` (sqlite | postgres), `database.path`
  - `cache.type` (memory | redis), `cache.redisUrl`
  - `media.directories[]` (array of watched paths)
  - `auth.secret`, `auth.localBypass` (skip auth from localhost)
  - `transcoding.hwAccel` (none | vaapi | nvenc | qsv)
  - `transcoding.maxConcurrent` (default: 2)
  - `thirdParty.tmdbApiKey`, `thirdParty.omdbApiKey`
  - `plugins.enabled[]`

### 5.4 Database Layer
- **Drizzle ORM** as TypeScript-first ORM (schema-as-code, same schema works for SQLite and PostgreSQL)
- SQLite as default via `better-sqlite3` (synchronous, fastest SQLite driver for Node.js)
- SQLite WAL mode enabled for concurrent read performance
- Heavy queries (scans, bulk metadata updates) offloaded to Node.js worker threads
- Migration system using Drizzle Kit (`drizzle-kit generate` + `drizzle-kit migrate`)
- Seed data for initial setup (default admin user, default settings)
- Database file stored in `data/db/mu.db`
- Upgrade path: set `database.type: postgres` in config to switch to PostgreSQL (same Drizzle schema, different driver)

### 5.5 Authentication & Authorization
- **Local bypass**: When accessing from `localhost` or `127.0.0.1`, optionally skip login (configurable)
- **JWT-based auth**: Access token (short-lived, 15m) + Refresh token (long-lived, 30d)
- Tokens stored in httpOnly secure cookies (not localStorage)
- User model: `id, username, email, password_hash, role (admin|user), avatar_url, created_at, updated_at`
- Roles: `admin` (full access, server management), `user` (library access, personal playlists/ratings)
- First-run setup wizard creates admin account
- API key auth option for programmatic access / plugin auth
- Device registration: Track authenticated devices with name, last active, IP

### 5.6 Caching Layer
- Unified cache interface (`ICacheProvider`) with two implementations:
  - `MemoryCacheProvider` - uses `lru-cache`, default, zero-config, configurable max entries (default 10,000) and TTL
  - `RedisCacheProvider` - uses `ioredis`, activated when `REDIS_URL` is set
- Cache namespaces to avoid collisions: `metadata:`, `poster:`, `search:`, `api:`, `stream:`
- TTL strategy per namespace:
  - Movie metadata: 7 days (rarely changes)
  - Search results: 1 hour
  - API rate limit counters: 1 minute
  - Poster/image URLs: 30 days
- Cache warming on startup for frequently accessed movies
- Cache invalidation on manual metadata refresh

### 5.7 WebSocket Server
- Real-time events pushed to connected clients:
  - Library scan progress and completion
  - New movies detected
  - Now playing status (which user is watching what)
  - Server health/status updates
  - Plugin activity notifications
- Client subscribes to channels (e.g., `library:updates`, `scan:progress`, `player:status`)

### 5.8 Background Task Scheduler
- `toad-scheduler` for periodic tasks:
  - Library re-scan (configurable interval, default: every 6 hours)
  - Metadata refresh for movies missing info (daily)
  - Cache cleanup / expired entry eviction (hourly)
  - Thumbnail generation queue processing (continuous when items queued)
  - Health check for watched directories (every 5 minutes)
- Task status exposed via API and admin dashboard

---

## 6. Stage 2 - Library Management & Metadata

### 6.1 Directory Management
- Admin can add/remove "media source" directories via API + UI
- Each source has: `id, path, label, scan_interval, enabled, last_scanned, file_count`
- Validate path exists and is readable on add
- Support local paths and network mounts (NFS, SMB/CIFS)
- Recursive scanning with configurable depth

### 6.2 File Scanner Service
- Runs as a worker thread to avoid blocking the main event loop
- Scans configured directories for video files:
  - Supported formats: `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.ts`
- Extracts file metadata:
  - File path, size, modified date, hash (for change detection)
  - Media info via `ffprobe`: resolution, codec, bitrate, duration, audio tracks, subtitle tracks
- Filename parsing to extract title, year, quality (e.g., `The Matrix (1999) 1080p.mkv`)
  - Use a robust parser (like `parse-torrent-title` or custom regex) to handle various naming conventions
- Deduplication by file hash or path
- Incremental scanning: only process new/changed files since last scan
- Progress reporting via WebSocket

### 6.3 File Watcher Service
- **chokidar** watches all configured media directories
- Events handled:
  - `add`: New file detected -> queue for scanning + metadata fetch
  - `change`: File modified -> re-scan metadata, update DB
  - `unlink`: File removed -> mark as unavailable (don't delete DB record, preserve ratings/metadata)
- Debouncing to handle rapid file changes (e.g., file still being copied/downloaded)
- Watcher health monitoring: restart if watcher crashes or directory becomes unavailable

### 6.4 Internal Movie Database
- When a movie file is scanned or any user action "touches" a movie, create/update a record in the internal `movies` table
- Core `movies` table (linking/reference table):
  - `id` (UUID), `title`, `original_title`, `year`, `overview`, `tagline`
  - `runtime_minutes`, `release_date`, `language`, `country`
  - `poster_url`, `backdrop_url`, `trailer_url`
  - `imdb_id`, `tmdb_id`, `omdb_id` (third-party reference columns)
  - `added_at`, `updated_at`
- `movie_files` table (links physical files to movie records):
  - `id`, `movie_id` (FK), `source_id` (FK to media source), `file_path`, `file_size`, `file_hash`
  - `resolution`, `codec_video`, `codec_audio`, `bitrate`, `duration_seconds`
  - `subtitle_tracks` (JSON), `audio_tracks` (JSON)
  - `available` (boolean - false if file was deleted but record preserved)
  - `added_at`, `file_modified_at`
- A movie can have multiple files (different qualities, formats)

### 6.5 Extended Metadata System
- `movie_metadata` table for all extended/variable info:
  - `id`, `movie_id` (FK), `key`, `value`, `source` (which plugin/API provided it), `fetched_at`
  - Flexible key-value design for varied metadata types
  - Example keys: `director`, `cast`, `genres`, `keywords`, `budget`, `revenue`, `production_companies`, `certification`, `content_rating`
- Alternatively, structured approach with dedicated columns + JSON overflow:
  - `id`, `movie_id` (FK)
  - `genres` (JSON array), `cast` (JSON array of {name, character, profile_url})
  - `directors` (JSON array), `writers` (JSON array)
  - `keywords` (JSON array), `production_companies` (JSON array)
  - `budget`, `revenue`, `certification`, `content_rating`
  - `imdb_rating`, `imdb_votes`, `tmdb_rating`, `tmdb_votes`
  - `rotten_tomatoes_score`, `metacritic_score`
  - `extended_data` (JSON - overflow for plugin-specific data)
  - `source`, `fetched_at`, `updated_at`
- **Decision: Use the structured approach** - it's more queryable and performant for common fields, with JSON overflow for extensibility

### 6.6 Third-Party Metadata Fetching
- **TMDB (The Movie Database)** - Primary metadata source
  - Free API, requires API key (easy to get)
  - Rich data: titles, overviews, posters, backdrops, cast, crew, genres, keywords, ratings, similar movies
  - Rate limit: ~40 requests/second
  - Search by title+year, or by TMDB ID
  - Fetch in batches during library scan
- **OMDB (Open Movie Database)** - Secondary/supplementary
  - Free tier: 1,000 requests/day
  - Good for IMDb ratings, Rotten Tomatoes scores, Metacritic
  - Links to IMDb IDs
- **Metadata fetch pipeline**:
  1. Parse filename for title + year
  2. Search TMDB by title + year -> get TMDB ID
  3. Fetch full details from TMDB (movie info, credits, images, similar)
  4. Fetch supplementary data from OMDB (IMDb rating, RT score, etc.)
  5. Download and cache poster/backdrop images locally
  6. Store all metadata in `movie_metadata` table
  7. If match is ambiguous, flag for manual resolution (UI prompt)
- **API Key Management**:
  - Store API keys in config file (encrypted at rest) or environment variables
  - Settings page in UI for entering/updating API keys
  - Key validation on save (test API call)
  - Rate limit tracking and automatic throttling

### 6.7 Poster & Image Management
- Download and locally cache poster images, backdrops, and actor photos
- Stored in `data/cache/images/` organized by movie ID
- Multiple sizes: thumbnail (150px), medium (300px), large (original)
- Image proxy endpoint: `/api/images/:movieId/:type/:size` - serves cached images or fetches on demand
- Fallback: extract a frame from the video file as poster if no metadata poster found
- Lazy deletion: images cleaned up when movie is permanently removed

---

## 7. Stage 3 - Video Streaming Engine

### 7.1 Streaming Strategy
- **Primary: HLS (HTTP Live Streaming)**
  - Industry standard, supported by all browsers via `hls.js`
  - Adaptive bitrate streaming (multiple quality levels)
  - Resumable, seekable, works over standard HTTP
- **Direct Play** (fallback/optimization):
  - If the client supports the source codec natively, serve the file directly via HTTP range requests
  - No transcoding overhead; ideal when formats match (e.g., H.264 MP4 to Chrome)
  - Codec detection on client side to determine if direct play is possible
- **Direct Stream** (partial transcode):
  - Remux without re-encoding when container format needs changing but codecs are compatible (e.g., MKV -> MP4 container swap)

### 7.2 Transcoding Pipeline
- **FFmpeg** as the transcoding engine (system dependency, checked at startup)
- On-the-fly transcoding: start streaming within seconds, transcode ahead of playback position
- Transcoding profiles:
  - **1080p** (default): H.264, AAC, ~5 Mbps
  - **720p**: H.264, AAC, ~2.5 Mbps
  - **480p**: H.264, AAC, ~1 Mbps
  - **Original**: Direct stream/play when possible
- Hardware acceleration support (configurable):
  - NVIDIA NVENC (`-hwaccel cuda`)
  - Intel QSV (`-hwaccel qsv`)
  - AMD VAAPI (`-hwaccel vaapi`)
  - Software fallback (libx264)
- Segment caching: transcoded HLS segments cached to disk temporarily to avoid re-transcoding on seek
- Max concurrent streams configurable (default: 2, limited by CPU/GPU)

### 7.3 Stream Management
- Each active stream is a managed child process (FFmpeg instance)
- Stream lifecycle:
  1. Client requests stream -> server checks codec compatibility
  2. If direct play possible: serve file with HTTP range requests
  3. If transcoding needed: spawn FFmpeg, generate HLS playlist + segments
  4. Client requests `.m3u8` manifest, then individual `.ts` segments
  5. Server tracks playback position for resume capability
  6. On disconnect/timeout: kill FFmpeg process, clean up temp segments
- Stream session tracking:
  - `stream_sessions` table: `id, user_id, movie_id, started_at, last_active, position_seconds, quality, transcoding`
  - Resume playback: store last position, offer "Resume from X" on next play
- Temp directory for HLS segments: `data/cache/streams/` (auto-cleaned)

### 7.4 Subtitle Support
- Extract subtitles from video files (embedded SRT, ASS, PGS)
- Serve subtitles via API endpoint: `/api/stream/:sessionId/subtitles/:track`
- Convert formats on-the-fly to WebVTT (browser standard)
- Support external subtitle files (`.srt`, `.vtt`, `.ass` alongside video file)
- Subtitle track selection in player UI
- Future: OpenSubtitles.org integration plugin for downloading missing subtitles

### 7.5 Audio Track Support
- Detect multiple audio tracks in source files
- Allow track selection in player UI (e.g., original language vs dubbed)
- FFmpeg maps selected audio track during transcoding

---

## 8. Stage 4 - Frontend Web UI (PWA)

### 8.1 Build & Tooling Setup
- **Vite 6** as build tool with Preact preset
- SASS/SCSS integration via Vite's built-in SASS support
- CSS modules for component-scoped styles
- Global SASS variables, mixins, and theme system in `src/styles/`
- SVG sprite system or `lucide-preact` for icons
- Path aliases: `@components`, `@pages`, `@services`, `@styles`, `@hooks`
- Environment variable injection for API base URL
- Production build: minified, code-split, gzipped, served by Fastify static

### 8.2 Application Shell & Layout
- **Top navigation bar**: Logo/brand, search bar, user menu (avatar, settings, logout)
- **Side navigation** (collapsible on mobile):
  - Dashboard / Home
  - Library (All Movies)
  - Playlists
  - Watchlist (To Watch)
  - History (Watched)
  - Discover / Recommendations
  - Plugins
  - Settings
  - Admin (if admin role) -> Server Dashboard
- **Content area**: Main page content with responsive grid/list layouts
- **Footer**: Minimal - version, server status indicator
- **Theme**: Dark mode default (movie-watching context), with light mode option

### 8.3 Pages & Views

#### 8.3.1 Dashboard / Home
- **Hero banner**: Random featured movie from library with backdrop, title, quick play button
- **Continue Watching**: Row of movies with progress bars (resume playback)
- **Recently Added**: Carousel/row of newly scanned movies
- **Recently Watched**: Row of last watched movies
- **Playlists**: Quick access to user's playlists
- **Recommendations**: "You might like..." row (based on ratings/watch history)
- **Library Stats**: Total movies, total watch time, storage used (small widget)

#### 8.3.2 Library / All Movies
- Grid view (poster cards) and List view (table with columns) toggle
- Sort by: Title, Year, Date Added, Rating (IMDB/internal), Duration, File Size
- Filter by: Genre, Year range, Rating range, Resolution, Watched/Unwatched, Has Subtitles
- Search bar with instant results (debounced, searches title + actors + directors)
- **Bulk selection mode**: Checkbox per movie, floating action bar appears:
  - "Mark as Watched" / "Mark as Unwatched"
  - "Add to Playlist..."
  - "Refresh Metadata"
  - "Delete from Library"
- Infinite scroll or pagination (configurable)
- Quick actions on hover: Play, Add to Watchlist, Rate (star widget)

#### 8.3.3 Movie Details Page
- **Backdrop header**: Full-width backdrop image with gradient overlay
- **Movie info section**:
  - Poster, Title, Year, Runtime, Certification/Rating
  - Genres (clickable tags -> filter library)
  - Internal rating (editable star/number widget, supports decimals e.g., 6.3)
  - External ratings: IMDb, Rotten Tomatoes, Metacritic (with logos)
  - Overview/Synopsis
  - Director(s), Writers (clickable -> search)
  - Cast list with photos (clickable -> search)
- **Action buttons**: Play, Add to Playlist, Mark Watched/Unwatched, Download (if enabled), Refresh Metadata
- **File info section** (collapsible): Resolution, codec, file size, audio tracks, subtitle tracks
- **Related/Similar movies** section (fetched from TMDB or recommendation engine)
- **Torrent search** (plugin, if enabled): Search button -> results panel with magnet links
- **Reviews** (plugin, if enabled): Aggregated reviews from IMDb/RT

#### 8.3.4 Movie Player Page
- **Full-screen optimized** video player with custom controls overlay
- **Control bar** (bottom):
  - Play/Pause, Seek bar with preview thumbnails, Volume, Current time / Duration
  - Quality selector (1080p/720p/480p/Original)
  - Subtitle track selector
  - Audio track selector
  - Playback speed (0.5x - 2x)
  - Fullscreen toggle
  - Picture-in-picture toggle
  - Cast button (Chromecast, if supported later)
  - **"Movie Info" button** -> triggers right-side flyout panel
- **Right-side flyout** (movie info):
  - Slides in from right, semi-transparent background
  - Shows: Title, Year, Director, Rating, Synopsis, Cast, Genres
  - Closeable (X button or click outside)
- **Keyboard shortcuts**:
  - Space: play/pause, F: fullscreen, M: mute, Left/Right: seek 10s, Up/Down: volume
  - S: toggle subtitles, I: toggle info flyout
- **Resume support**: If previously watched, prompt "Resume from X:XX?" or "Start from beginning"
- **Next in playlist**: If playing from a playlist, "Up Next" indicator + auto-play option
- **Watch progress**: Progress saved every 10 seconds, synced to server

#### 8.3.5 Playlists Page
- List of user-created playlists with poster mosaic thumbnails
- Create new playlist (name, description, optional cover image)
- Edit playlist: reorder movies (drag & drop), remove, rename
- Quick actions: Play All (sequential), Shuffle Play
- Smart Playlists (auto-generated):
  - "Unwatched" (all movies not yet watched)
  - "Top Rated" (internal rating > 7)
  - "Recently Added" (last 30 days)
  - Custom smart playlists with filter rules (genre + year + rating, etc.)

#### 8.3.6 Watchlist / To Watch
- Dedicated page for movies the user flagged as "want to watch"
- Add from movie details page or library bulk action
- Sort by date added, title, rating
- One-click "Start Watching" button

#### 8.3.7 Watch History
- Chronological list of watched movies
- Shows: poster, title, watched date, watch duration, completion %
- Filter by: fully watched, partially watched, date range
- Bulk actions: Clear history, Mark as unwatched

#### 8.3.8 Discover / Recommendations Page
- **"Find me something new"** section:
  - Based on: entire catalog, specific genre, specific movie(s)
  - Optional filters: genre, year range, minimum rating
  - Toggle: "Exclude already watched"
  - Results with "Add to Watchlist" and "Not Interested" buttons
- **Similar to [Movie]**: Enter/select a movie -> see similar movies (TMDB + internal)
- **Top Rated in Genre**: Genre selector -> top rated movies in that genre
- **Trending** (if TMDB API available): What's popular right now globally
- **Actors/Directors**: Browse by person -> see their filmography, filter by what's in library

#### 8.3.9 Search Page
- **Global search** accessible from top nav bar
- Search across: Movies (title, original title), Actors, Directors, Genres, Playlists
- Instant results as you type (debounced API calls)
- Results grouped by category (Movies, People, Genres)
- Search history (recent searches)

#### 8.3.10 Settings Page (tabbed sections)
- **Profile**: Username, email, avatar, password change
- **Playback & Streaming**: Default quality, default subtitle language, default audio language, autoplay next, playback speed default, skip intro (future), hardware acceleration preference, max concurrent streams
- **Library & Scanning**: Media source directories, scan interval, auto-scan on startup, filename parsing strategy, supported file extensions, metadata auto-fetch toggle, duplicate handling
- **Server**: Host/port, data directory, log level, database type (SQLite/Postgres), cache type (memory/Redis), server restart
- **Ratings**: Rating scale display (5-star vs 10-point), default sort by rating source (internal/IMDB/TMDB), show/hide specific rating sources
- **API Keys**: TMDB, OMDB, OpenSubtitles key management (input, validate, save) with status indicators
- **Appearance**: Theme (dark/light/auto), language (i18n), poster size, default view (grid/list), sidebar collapsed default
- **Notifications**: Desktop notifications for scan completion, new movies, recommendations, stream errors
- **Devices**: List of authenticated devices, revoke access, rename devices
- **Plugins**: Redirects to Plugins page (or inline enable/disable toggles)

#### 8.3.11 Plugins Page
- List of available plugins (built-in + any future third-party)
- Each plugin card shows: name, description, version, status (enabled/disabled), author
- Toggle enable/disable
- Plugin-specific settings (e.g., torrent search sites list, API keys)
- Plugin activity log

#### 8.3.12 Admin: Server Dashboard
- **Server status**: Uptime, CPU usage, memory usage, disk usage
- **Active streams**: Who is watching what, stream quality, bandwidth
- **Library stats**: Total movies, total size, movies by genre/year, missing metadata count
- **Recent activity**: Scan events, errors, user actions
- **Media sources**: Add/remove/edit watched directories, trigger manual scan
- **User management**: Create/edit/delete users, change roles
- **System logs**: Filterable server log viewer
- **Maintenance**: Clear cache, rebuild thumbnails, re-scan all metadata, database vacuum
- **Server controls**: Restart server (graceful), check for updates

### 8.4 Responsive Design System
- Breakpoints: Mobile (<768px), Tablet (768-1024px), Desktop (>1024px)
- Mobile: Single column, bottom tab navigation, touch-optimized controls
- Tablet: Two-column grid, side nav collapses to icons
- Desktop: Multi-column grid, full side nav, hover effects
- All layouts use CSS Grid + Flexbox
- Touch gestures on mobile: swipe to dismiss flyouts, pull to refresh

### 8.5 State Management
- **Preact Signals** for reactive state (lightweight, no boilerplate)
- Global state signals for: auth state, user profile, library data, playback state, theme
- Local component state for UI-only concerns
- Service layer (TypeScript classes) wrapping API calls
- Optimistic UI updates where appropriate (e.g., toggling watched status)

---

## 9. Stage 5 - Plugin System

### 9.1 Plugin Architecture Overview
- Plugins are self-contained packages that extend Mu functionality
- Each plugin is a directory/package with a manifest and entry point
- Plugins can:
  - Register API routes (under `/api/plugins/:pluginId/`)
  - Add UI components (rendered in designated plugin slots in the frontend)
  - Subscribe to system events (movie added, movie rated, scan complete, etc.)
  - Access core services (database, cache, metadata, etc.) via provided APIs
  - Add scheduled tasks
  - Provide custom metadata sources

### 9.2 Plugin Manifest (`plugin.json`)
```json
{
  "id": "torrent-search",
  "name": "Torrent Search",
  "version": "1.0.0",
  "description": "Search torrent sites for movie magnet links",
  "author": "Mu",
  "entry": "index.ts",
  "permissions": ["network", "ui:movie-details"],
  "settings": [
    {
      "key": "sites",
      "type": "string[]",
      "label": "Torrent Sites",
      "default": ["https://1337x.to", "https://yts.mx"]
    }
  ],
  "ui": {
    "movieDetails": {
      "component": "TorrentSearchPanel",
      "position": "after-actions"
    }
  }
}
```

### 9.3 Plugin API (provided to plugins)
```typescript
interface PluginContext {
  // Core services
  db: DatabaseService;          // Query builder access (scoped)
  cache: CacheService;          // Cache get/set with plugin namespace
  config: PluginConfigService;  // Read/write plugin settings
  logger: Logger;               // Plugin-scoped logger

  // System integration
  events: EventEmitter;         // Subscribe to system events
  registerRoute(method, path, handler);  // Add API endpoints
  registerScheduledTask(cron, handler);  // Add periodic tasks

  // Movie services
  movies: MovieService;         // Search, get, update movies
  metadata: MetadataService;    // Fetch/update metadata

  // HTTP client (for third-party API calls)
  http: HttpClient;             // Rate-limited, cached HTTP client
}
```

### 9.4 Built-in Plugins

#### 9.4.1 TMDB Metadata Plugin
- Auto-fetches metadata from TMDB when movies are added
- Provides: poster, backdrop, cast, crew, genres, keywords, similar movies, ratings
- Settings: API key, language preference, auto-fetch on add (boolean)

#### 9.4.2 OMDB / IMDb Ratings Plugin
- Fetches IMDb ratings, Rotten Tomatoes scores, Metacritic scores
- Can import user's IMDb ratings (CSV export from IMDb account)
- Settings: API key, import file path

#### 9.4.3 Torrent Search Plugin
- Searches configured torrent indexing sites for a movie
- Scrapes results and extracts magnet links
- Shows results on Movie Details page (when enabled)
- Settings: List of torrent site URLs/APIs, preferred quality, sort preference
- **Important**: Plugin just finds and displays magnet links. It does NOT download torrents itself. Users use their own torrent client.

#### 9.4.4 Rotten Tomatoes Plugin
- Fetches critic/audience scores and consensus
- Shows on Movie Details page
- Settings: API key (if available) or scraping configuration

#### 9.4.5 Subtitle Downloader Plugin (future)
- Search OpenSubtitles.org for missing subtitles
- Auto-download matching subtitles in preferred language
- Settings: OpenSubtitles API key, preferred language(s)

### 9.5 Plugin Lifecycle
1. **Discovery**: Scan `plugins/` directory and `node_modules/@mu-plugin-*`
2. **Validation**: Verify manifest, check permissions, validate entry point
3. **Registration**: Load plugin module, inject `PluginContext`
4. **Initialization**: Call plugin's `activate()` method
5. **Running**: Plugin routes active, event subscriptions live, scheduled tasks running
6. **Deactivation**: Call `deactivate()`, unregister routes/subscriptions

---

## 10. Stage 6 - Recommendations & Discovery

### 10.1 Recommendation Engine (Initial - Metadata-Based)
- **Content-based filtering** using metadata attributes:
  - Genre overlap scoring
  - Director/actor overlap scoring
  - Keyword/tag similarity
  - Year proximity
  - Rating similarity (user's internal ratings)
- **Weighted scoring formula**:
  - Genre match: 30%, Director/cast match: 25%, Keywords: 20%, Rating similarity: 15%, Year proximity: 10%
- Results filtered by: not in library (for discovery) or in library (for "what to watch next")
- API endpoint: `GET /api/recommendations?based_on=movie_id|catalog&exclude_watched=true&genre=action&limit=20`

### 10.2 "Find Me Something New" Feature
- Input: User's catalog (all or subset), optional filters
- Process:
  1. Analyze user's rated movies to build taste profile (preferred genres, directors, decades, etc.)
  2. Query TMDB for similar movies to top-rated entries
  3. Score and rank results by relevance to taste profile
  4. Filter out movies already in library (if configured)
  5. Return ranked results with explanation ("Because you liked X and Y")
- Caching: Cache recommendation results per user, invalidate on rating change or library update

### 10.3 Similar Movies
- For a given movie, find similar ones:
  1. TMDB "similar" and "recommendations" endpoints (cached)
  2. Internal metadata similarity (genre + director + cast overlap)
  3. Merge and deduplicate results
  4. Mark which ones are in user's library vs. not
- Displayed on Movie Details page

### 10.4 Browse by Person
- Actor and Director pages showing:
  - Photo, bio, filmography
  - Movies in user's library by this person
  - Other notable movies (from TMDB)
  - Filter by: in library, year, genre

### 10.5 Genre & Category Browsing
- Genre page with all genres and movie counts
- Click genre -> filtered library view
- Category pages: Decade (80s, 90s, 2000s), Country, Language

---

## 11. Stage 7 - Mobile Experience & PWA

### 11.1 PWA Configuration
- `manifest.json` with app name, icons, theme color, display: standalone
- Service worker for:
  - Offline access to cached movie metadata and posters
  - Background sync for ratings and watchlist changes made offline
  - Push notifications (new movies added, recommendations)
- Install prompt on supported browsers/devices
- Splash screen with app branding

### 11.2 Mobile-Specific UI Adjustments
- **Bottom tab navigation**: Home, Library, Search, Playlists, Profile
- **Touch-optimized**: Larger tap targets, swipe gestures, pull-to-refresh
- **Mobile movie cards**: Compact poster view, long-press for quick actions
- **Mobile player**: Full-screen by default, lock rotation, gesture controls:
  - Swipe up/down on left: brightness
  - Swipe up/down on right: volume
  - Double-tap left/right: seek backward/forward 10s
  - Swipe left/right: seek (scrub)

### 11.3 Mobile "Rater" Feature
- Dedicated mobile view for rating unrated movies
- Card-based interface: movie poster + title + year
- Swipe right to rate (number input overlay), swipe left to skip (move to end of queue)
- Quick and efficient way to rate your collection on the go
- Progress indicator: "15 of 42 unrated movies"

### 11.4 Mobile Streaming Considerations
- Auto-select lower quality on cellular connections
- Download for offline viewing (future enhancement)
- Background audio playback support
- Casting support (Chromecast, AirPlay) - future enhancement

---

## 12. Stage 8 - MCP Server & Embeddings

### 12.1 Embedding System
- Generate text embeddings for each movie based on:
  - Title + overview/synopsis
  - Genre keywords
  - Director/actor names
  - User reviews/notes (if added)
  - Combined into a single text document per movie
- Embedding model options:
  - **Local**: Use a lightweight model like `all-MiniLM-L6-v2` via `@xenova/transformers` (runs in Node.js, no external dependency)
  - **Remote**: OpenAI embeddings API (requires API key, more accurate)
- Store embeddings in a vector-capable format:
  - SQLite with a custom similarity function (cosine similarity via SQL UDF)
  - Or a lightweight vector store like `vectra` (file-based, zero-config)
- Embeddings generated on movie add, regenerated on significant metadata change

### 12.2 Embedding-Based Recommendations
- Cosine similarity between movie embeddings for "similar movies"
- User taste vector: average of embeddings for top-rated movies
- "Find new movies" = find movies with high similarity to taste vector but not in library
- Significantly more accurate than metadata-only matching

### 12.3 MCP Server Integration
- Mu exposes an MCP (Model Context Protocol) server
- MCP tools provided:
  - `search_movies(query)` - search user's library
  - `get_movie(id)` - get full movie details
  - `get_recommendations(movie_id?, filters?)` - get recommendations
  - `rate_movie(id, rating)` - rate a movie
  - `get_user_stats()` - user's watching stats and preferences
  - `find_similar(movie_id)` - find similar movies via embeddings
  - `add_to_watchlist(movie_id)` - add to watchlist
- Allows AI assistants (Claude, etc.) to interact with user's movie library
- MCP server runs as a subprocess, communicates via stdio or HTTP

### 12.4 AI-Powered Features (Future)
- Natural language movie search: "Find me a thriller from the 90s with a twist ending"
- Mood-based recommendations: "Something light and funny for tonight"
- Automatic movie categorization and tagging via LLM analysis of synopses

---

## 13. Stage 9 - Install System & Distribution

### 13.1 Install Script (`install.sh`)
- Single curl command: `curl -fsSL https://mu.app/install | bash`
- What it does:
  1. Detect OS and architecture
  2. Check/install system dependencies: Node.js 20+, FFmpeg, (optional) build tools for native modules
  3. Download latest Mu release tarball
  4. Extract to install directory (default: `~/.mu/` or `/opt/mu/`)
  5. Run `pnpm install --production` (or use pre-built bundles)
  6. Generate default config file
  7. Create systemd service file (Linux) or launchd plist (macOS) for auto-start
  8. Start the server
  9. Print access URL and first-run setup instructions
- Supports: Linux (Debian/Ubuntu, Fedora/RHEL, Arch), macOS, WSL
- Uninstall: `mu uninstall` command

### 13.2 CLI Tool (`mu`)
- Installed globally, provides management commands:
  - `mu start` / `stop` / `restart` / `status`
  - `mu config` - edit configuration
  - `mu scan` - trigger manual library scan
  - `mu users` - manage users
  - `mu logs` - view server logs
  - `mu update` - check for and install updates
  - `mu backup` / `restore` - database backup/restore
  - `mu version` - show version info

### 13.3 Docker Deployment (Alternative)
- **Dockerfile**: Multi-stage build (build client + server, production image with FFmpeg)
- **docker-compose.yml**: Single service (Mu) with volume mounts for media and data
- Optional services: Redis (if desired), PostgreSQL (if desired)
- Example `docker-compose.yml`:
  ```yaml
  services:
    mu:
      image: mu/mu:latest
      ports:
        - "8080:8080"
      volumes:
        - ./data:/app/data
        - /path/to/movies:/media/movies:ro
      environment:
        - TMDB_API_KEY=your_key_here
  ```

### 13.4 Auto-Update System
- Check for updates periodically (configurable, default: daily)
- Notify admin via dashboard + notification
- One-click update from dashboard or `mu update` CLI
- Automatic database migration on version upgrade
- Rollback support: keep previous version for quick rollback

---

## 14. Database Schema Design

### 14.1 Core Tables

```
users
├── id (UUID, PK)
├── username (UNIQUE, NOT NULL)
├── email (UNIQUE)
├── password_hash (NOT NULL)
├── role (ENUM: admin, user)
├── avatar_url
├── preferences (JSON - theme, language, default quality, etc.)
├── created_at, updated_at

movies
├── id (UUID, PK)
├── title (NOT NULL)
├── original_title
├── year (INT)
├── overview (TEXT)
├── tagline
├── runtime_minutes (INT)
├── release_date (DATE)
├── language (VARCHAR)
├── country (VARCHAR)
├── poster_url
├── backdrop_url
├── trailer_url
├── imdb_id (VARCHAR, INDEXED)
├── tmdb_id (INT, INDEXED)
├── content_rating (VARCHAR - PG, R, etc.)
├── added_at, updated_at

movie_metadata
├── id (UUID, PK)
├── movie_id (FK -> movies, UNIQUE)
├── genres (JSON ARRAY)
├── cast (JSON ARRAY of {name, character, profile_url, tmdb_id})
├── directors (JSON ARRAY)
├── writers (JSON ARRAY)
├── keywords (JSON ARRAY)
├── production_companies (JSON ARRAY)
├── budget (BIGINT)
├── revenue (BIGINT)
├── imdb_rating (DECIMAL 3,1)
├── imdb_votes (INT)
├── tmdb_rating (DECIMAL 3,1)
├── tmdb_votes (INT)
├── rotten_tomatoes_score (INT)
├── metacritic_score (INT)
├── extended_data (JSON - overflow for plugin data)
├── source (VARCHAR - which service provided this)
├── fetched_at, updated_at

movie_files
├── id (UUID, PK)
├── movie_id (FK -> movies)
├── source_id (FK -> media_sources)
├── file_path (TEXT, NOT NULL, UNIQUE)
├── file_name (VARCHAR)
├── file_size (BIGINT)
├── file_hash (VARCHAR)
├── resolution (VARCHAR - 1080p, 720p, 4K, etc.)
├── codec_video (VARCHAR - h264, h265, vp9, etc.)
├── codec_audio (VARCHAR - aac, ac3, dts, etc.)
├── bitrate (INT)
├── duration_seconds (INT)
├── subtitle_tracks (JSON ARRAY)
├── audio_tracks (JSON ARRAY)
├── available (BOOLEAN, DEFAULT true)
├── added_at, file_modified_at

media_sources
├── id (UUID, PK)
├── path (TEXT, NOT NULL, UNIQUE)
├── label (VARCHAR)
├── scan_interval_hours (INT, DEFAULT 6)
├── enabled (BOOLEAN, DEFAULT true)
├── last_scanned_at (TIMESTAMP)
├── file_count (INT, DEFAULT 0)
├── total_size_bytes (BIGINT, DEFAULT 0)
├── created_at, updated_at
```

### 14.2 User Data Tables

```
user_ratings
├── id (UUID, PK)
├── user_id (FK -> users)
├── movie_id (FK -> movies)
├── rating (DECIMAL 3,1 - supports 0.0-10.0, ie. 6.3)
├── created_at, updated_at
├── UNIQUE(user_id, movie_id)

user_watch_history
├── id (UUID, PK)
├── user_id (FK -> users)
├── movie_id (FK -> movies)
├── watched_at (TIMESTAMP)
├── duration_watched_seconds (INT)
├── completed (BOOLEAN)
├── position_seconds (INT - for resume)

user_watchlist
├── id (UUID, PK)
├── user_id (FK -> users)
├── movie_id (FK -> movies)
├── added_at (TIMESTAMP)
├── notes (TEXT)
├── UNIQUE(user_id, movie_id)

playlists
├── id (UUID, PK)
├── user_id (FK -> users)
├── name (VARCHAR, NOT NULL)
├── description (TEXT)
├── cover_url
├── is_smart (BOOLEAN, DEFAULT false)
├── smart_rules (JSON - filter rules for smart playlists)
├── created_at, updated_at

playlist_movies
├── id (UUID, PK)
├── playlist_id (FK -> playlists)
├── movie_id (FK -> movies)
├── position (INT - ordering)
├── added_at
├── UNIQUE(playlist_id, movie_id)
```

### 14.3 System Tables

```
settings
├── key (VARCHAR, PK)
├── value (JSON)
├── updated_at

plugins
├── id (VARCHAR, PK - plugin id from manifest)
├── name (VARCHAR)
├── version (VARCHAR)
├── enabled (BOOLEAN, DEFAULT false)
├── settings (JSON)
├── installed_at, updated_at

api_keys
├── id (UUID, PK)
├── user_id (FK -> users)
├── name (VARCHAR)
├── key_hash (VARCHAR)
├── last_used_at
├── created_at, expires_at

devices
├── id (UUID, PK)
├── user_id (FK -> users)
├── name (VARCHAR)
├── device_type (VARCHAR - web, mobile, tv)
├── ip_address (VARCHAR)
├── user_agent (TEXT)
├── last_active_at
├── created_at

stream_sessions
├── id (UUID, PK)
├── user_id (FK -> users)
├── movie_id (FK -> movies)
├── movie_file_id (FK -> movie_files)
├── quality (VARCHAR)
├── transcoding (BOOLEAN)
├── started_at
├── last_active_at
├── position_seconds (INT)
├── bandwidth_bytes (BIGINT)

scan_log
├── id (UUID, PK)
├── source_id (FK -> media_sources)
├── started_at
├── completed_at
├── status (ENUM: running, completed, failed)
├── files_found (INT)
├── files_added (INT)
├── files_updated (INT)
├── files_removed (INT)
├── errors (JSON ARRAY)

movie_embeddings (Stage 8)
├── id (UUID, PK)
├── movie_id (FK -> movies, UNIQUE)
├── embedding (BLOB - serialized vector)
├── model (VARCHAR - which embedding model used)
├── generated_at
```

---

## 15. API Design

### 15.1 API Structure

All API routes under `/api/v1/`. Authentication required unless noted.

### 15.2 Core Endpoints

```
Auth
├── POST   /api/v1/auth/login           - Login (returns JWT in cookie)
├── POST   /api/v1/auth/logout          - Logout (clear cookie)
├── POST   /api/v1/auth/refresh         - Refresh access token
├── GET    /api/v1/auth/me              - Current user profile
├── POST   /api/v1/auth/setup           - First-run admin setup (no auth)

Users
├── GET    /api/v1/users                - List users (admin)
├── POST   /api/v1/users                - Create user (admin)
├── GET    /api/v1/users/:id            - Get user
├── PATCH  /api/v1/users/:id            - Update user
├── DELETE /api/v1/users/:id            - Delete user (admin)
├── GET    /api/v1/users/:id/devices    - List user devices
├── DELETE /api/v1/users/:id/devices/:did - Revoke device

Movies
├── GET    /api/v1/movies               - List movies (paginated, sortable, filterable)
├── GET    /api/v1/movies/:id           - Get movie details (includes metadata, files, user rating)
├── PATCH  /api/v1/movies/:id           - Update movie metadata (manual edit)
├── DELETE /api/v1/movies/:id           - Remove movie from library
├── POST   /api/v1/movies/:id/refresh   - Re-fetch metadata from third party
├── GET    /api/v1/movies/:id/similar   - Get similar movies
├── GET    /api/v1/movies/:id/files     - List files for this movie
├── GET    /api/v1/movies/search        - Search movies (query, genre, year, actor, director)
├── GET    /api/v1/movies/recent        - Recently added movies
├── POST   /api/v1/movies/bulk          - Bulk operations (mark watched, add to playlist, etc.)

Ratings
├── POST   /api/v1/movies/:id/rate      - Rate a movie (body: { rating: 6.3 })
├── DELETE /api/v1/movies/:id/rate      - Remove rating
├── GET    /api/v1/ratings              - All user ratings (paginated)
├── GET    /api/v1/ratings/unrated      - Movies without user rating (for mobile rater)

Watch History
├── GET    /api/v1/history              - User's watch history (paginated)
├── POST   /api/v1/movies/:id/watched   - Mark as watched
├── DELETE /api/v1/movies/:id/watched   - Mark as unwatched
├── GET    /api/v1/history/continue     - Movies with incomplete watch (resume list)

Watchlist
├── GET    /api/v1/watchlist            - User's watchlist
├── POST   /api/v1/watchlist/:movieId   - Add to watchlist
├── DELETE /api/v1/watchlist/:movieId   - Remove from watchlist

Playlists
├── GET    /api/v1/playlists            - List user's playlists
├── POST   /api/v1/playlists            - Create playlist
├── GET    /api/v1/playlists/:id        - Get playlist with movies
├── PATCH  /api/v1/playlists/:id        - Update playlist (name, description, reorder)
├── DELETE /api/v1/playlists/:id        - Delete playlist
├── POST   /api/v1/playlists/:id/movies - Add movie(s) to playlist
├── DELETE /api/v1/playlists/:id/movies/:mid - Remove movie from playlist

Streaming
├── GET    /api/v1/stream/:movieId/start      - Initialize stream session (returns session ID + manifest URL)
├── GET    /api/v1/stream/:sessionId/manifest - HLS manifest (.m3u8)
├── GET    /api/v1/stream/:sessionId/segment/:n - HLS segment (.ts)
├── GET    /api/v1/stream/:sessionId/subtitles/:track - Subtitle track (WebVTT)
├── POST   /api/v1/stream/:sessionId/progress - Update playback position
├── DELETE /api/v1/stream/:sessionId          - End stream session
├── GET    /api/v1/stream/direct/:fileId      - Direct file streaming (range requests)

Library Management
├── GET    /api/v1/sources              - List media sources
├── POST   /api/v1/sources              - Add media source (admin)
├── PATCH  /api/v1/sources/:id          - Update source (admin)
├── DELETE /api/v1/sources/:id          - Remove source (admin)
├── POST   /api/v1/sources/:id/scan     - Trigger manual scan (admin)
├── GET    /api/v1/sources/:id/status   - Scan status

Recommendations
├── GET    /api/v1/recommendations               - General recommendations for user
├── GET    /api/v1/recommendations/similar/:id    - Similar to specific movie
├── GET    /api/v1/recommendations/discover       - Discover new movies (not in library)
├── POST   /api/v1/recommendations/based-on       - Recommendations based on movie subset

Search (global)
├── GET    /api/v1/search?q=...&type=movie|person|genre - Global search

Images
├── GET    /api/v1/images/:movieId/:type/:size    - Cached movie images

Plugins
├── GET    /api/v1/plugins              - List plugins with status
├── POST   /api/v1/plugins/:id/enable   - Enable plugin
├── POST   /api/v1/plugins/:id/disable  - Disable plugin
├── GET    /api/v1/plugins/:id/settings - Get plugin settings
├── PATCH  /api/v1/plugins/:id/settings - Update plugin settings
├── *      /api/v1/plugins/:id/*        - Plugin-registered routes (proxied)

Settings (admin)
├── GET    /api/v1/settings             - Get all settings
├── PATCH  /api/v1/settings             - Update settings
├── GET    /api/v1/settings/api-keys    - List configured third-party API keys (masked)
├── PUT    /api/v1/settings/api-keys/:service - Set API key for service

Server/Admin
├── GET    /api/v1/admin/status         - Server status (uptime, CPU, memory, disk)
├── GET    /api/v1/admin/streams        - Active streams
├── GET    /api/v1/admin/stats          - Library statistics
├── GET    /api/v1/admin/logs           - Server logs (paginated, filterable)
├── POST   /api/v1/admin/restart        - Restart server
├── POST   /api/v1/admin/cache/clear    - Clear cache
├── GET    /api/v1/admin/scan-log       - Scan history/log
```

### 15.3 WebSocket Events

```
Client -> Server:
├── subscribe(channel)      - Subscribe to event channel
├── unsubscribe(channel)    - Unsubscribe from channel
├── player:heartbeat        - Keep stream session alive, report position

Server -> Client:
├── library:movie-added     - New movie scanned
├── library:movie-updated   - Movie metadata updated
├── library:movie-removed   - Movie file no longer available
├── scan:started            - Scan started for source
├── scan:progress           - Scan progress (files processed / total)
├── scan:completed          - Scan finished
├── scan:error              - Scan error
├── stream:started          - Another user started streaming (admin view)
├── stream:ended            - Stream ended
├── plugin:event            - Plugin-emitted event
├── server:status           - Periodic server health update
├── notification            - General notification (new movies, recommendations)
```

---

## 16. Plugin Architecture

### 16.1 Plugin Directory Structure
```
plugins/
├── torrent-search/
│   ├── plugin.json          # Manifest
│   ├── index.ts             # Server-side entry (activate/deactivate)
│   ├── routes.ts            # API route handlers
│   ├── services/            # Plugin business logic
│   │   └── scraper.ts       # Torrent site scraper
│   └── ui/                  # Frontend components (optional)
│       └── TorrentPanel.tsx # Preact component rendered in movie details
```

### 16.2 Plugin Loading Flow
1. Server starts -> PluginManager scans `plugins/` directory
2. Read each `plugin.json`, validate schema
3. Check `plugins` DB table for enabled status
4. For enabled plugins: `require()` the entry, call `activate(context)`
5. Plugin registers its routes, event handlers, scheduled tasks
6. If plugin has UI components, serve them via plugin static route
7. Frontend loads plugin UI components dynamically (lazy import from plugin route)

### 16.3 Plugin Isolation & Safety
- Plugins run in the same process (for simplicity and performance) but with scoped access
- Database access scoped to plugin's own tables (prefixed with `plugin_<id>_`)
- Cache access scoped to plugin namespace
- Network requests go through rate-limited HTTP client
- Plugins cannot modify core tables directly; they use provided service methods
- Plugin errors are caught and logged; crashes don't take down the server

### 16.4 Frontend Plugin Integration
- The frontend defines "plugin slots" in key locations:
  - Movie Details page: after action buttons, sidebar area
  - Settings page: plugin-specific settings tab
  - Dashboard: optional plugin widgets
- Plugins declare which slots they use in their manifest
- Frontend dynamically renders plugin components in those slots
- Plugin UI components are loaded lazily (code-split)

---

## 17. Streaming Architecture

### 17.1 Stream Decision Flow
```
Client requests movie playback
    │
    ├─ Check client codec support (from User-Agent or client capability report)
    │
    ├─ Check source file codecs (from movie_files table)
    │
    ├─ If client supports source codecs AND container:
    │   └─ DIRECT PLAY: Serve file via HTTP range requests (zero overhead)
    │
    ├─ If client supports codecs BUT NOT container (e.g., MKV to browser):
    │   └─ DIRECT STREAM: Remux to MP4 on-the-fly (minimal CPU)
    │
    └─ If client does NOT support source codecs:
        └─ TRANSCODE: FFmpeg to HLS with selected quality profile
            ├─ Generate .m3u8 playlist
            ├─ Produce .ts segments (6-second each)
            ├─ Start serving as soon as first segment is ready (~2s)
            └─ Continue transcoding ahead of playback position
```

### 17.2 FFmpeg Worker Pool
- Pool of FFmpeg child processes (max configurable, default 2)
- Each stream gets one dedicated FFmpeg process
- Processes monitored for crashes -> auto-restart with last known position
- CPU/memory limits per process (using `nice` on Linux, or ulimit)
- Hardware acceleration detected at startup, used when available

### 17.3 Bandwidth & Quality Adaptation
- Server tracks client bandwidth via segment download speed
- Adaptive: if client is slow, offer lower quality option
- Client can switch quality mid-stream (HLS variant playlist)
- Admin can set global bandwidth limits per stream

---

## 18. Security & Auth

### 18.1 Authentication Flow
1. User visits Mu URL
2. If `localBypass` is enabled and request is from localhost -> auto-login as admin
3. Otherwise, redirect to login page
4. Login with username + password -> server validates, returns JWT in httpOnly cookie
5. JWT contains: `userId, role, deviceId, exp`
6. Access token (15m) refreshed automatically via refresh token (30d)
7. Refresh token stored in DB, can be revoked per-device

### 18.2 Security Measures
- Passwords hashed with bcrypt (cost factor 12)
- CSRF protection via double-submit cookie pattern
- Rate limiting on auth endpoints (5 attempts per minute)
- API key auth as alternative to cookie auth (for programmatic access)
- Content Security Policy headers
- HTTPS recommended (docs for Let's Encrypt / reverse proxy setup)
- Input sanitization on all user inputs
- File path traversal protection on media file serving
- No directory listing exposure

### 18.3 Remote Access
- Server binds to configurable host/port (default: 0.0.0.0:8080)
- For remote access: user configures firewall/port forwarding or uses reverse proxy (Nginx, Caddy)
- Future: built-in Tailscale/WireGuard tunnel option for secure remote access without port forwarding
- Documentation for common reverse proxy setups

---

## 19. Caching Strategy

### 19.1 Cache Layers

| Layer | What | TTL | Invalidation |
|-------|------|-----|-------------|
| **HTTP Cache** | Static assets (JS, CSS, images) | 1 year (hashed filenames) | New build |
| **API Response** | Metadata API responses from TMDB/OMDB | 7 days | Manual refresh |
| **Image Cache** | Downloaded poster/backdrop images | 30 days | Manual refresh |
| **Search Cache** | Third-party search results | 1 hour | New search |
| **Metadata Cache** | Parsed movie metadata | Until file changes | File watcher event |
| **Stream Segments** | Transcoded HLS segments | Session duration + 1 hour | Session end cleanup |
| **Recommendation Cache** | Generated recommendations per user | 6 hours | Rating change, library change |

### 19.2 Cache Storage
- In-memory (LRU): API responses, search results, metadata lookups
- Disk: Images, stream segments, thumbnails
- Database: Persistent metadata (not really "cache" but reduces API calls)

### 19.3 Cache Size Management
- In-memory: Max 10,000 entries or configurable MB limit
- Disk image cache: Configurable max size (default 1GB), LRU eviction
- Stream segment cache: Auto-cleaned after session + grace period
- Admin dashboard shows cache stats and manual clear option

---

## 20. Deployment & Infrastructure

### 20.1 Minimum System Requirements
- **CPU**: 2 cores (4+ recommended for transcoding)
- **RAM**: 512MB minimum, 2GB recommended
- **Storage**: ~100MB for application + space for media + cache
- **OS**: Linux (recommended), macOS, Windows (via WSL)
- **Dependencies**: Node.js 20+, FFmpeg 5+

### 20.2 Recommended Setup
- Linux server (Ubuntu 22.04+ or similar)
- Reverse proxy (Nginx or Caddy) with HTTPS
- Systemd service for auto-start
- Mounted media storage (local disk, NAS, external drive)

### 20.3 Scaling Considerations
- SQLite handles up to ~100 concurrent readers well (single-writer, WAL mode)
- For larger setups (multiple concurrent transcoders, many users): switch to PostgreSQL
- Redis for cache when multiple server instances needed (future)
- Horizontal scaling not a priority (self-hosted, typically 1-5 users)

---

## 21. Full Feature Matrix

### Core Features (Stages 1-4)

| Feature | Description | Stage |
|---------|-------------|-------|
| User authentication | Login, JWT, local bypass, device management | 1 |
| Configuration system | YAML config, env vars, CLI flags, validation | 1 |
| SQLite database | Zero-config, migrations, query builder abstraction | 1 |
| In-memory cache | LRU cache with TTL, namespace isolation | 1 |
| WebSocket server | Real-time events, channel subscriptions | 1 |
| Directory management | Add/remove media source directories | 2 |
| File scanner | Recursive scan, filename parsing, ffprobe metadata | 2 |
| File watcher | Real-time detection of added/changed/removed files | 2 |
| Internal movie database | Movies table, linking to third-party IDs | 2 |
| Metadata fetching | TMDB + OMDB integration, auto-fetch on scan | 2 |
| Image caching | Download and serve posters/backdrops locally | 2 |
| API key management | Store/validate third-party API keys | 2 |
| HLS streaming | On-the-fly transcoding, adaptive quality | 3 |
| Direct play/stream | Zero-overhead when codecs match | 3 |
| Hardware acceleration | NVENC, QSV, VAAPI support | 3 |
| Subtitle support | Extract, convert, serve subtitles | 3 |
| Audio track selection | Multiple audio track support | 3 |
| Resume playback | Save/restore playback position | 3 |
| Web dashboard | Home, library, movie details, settings | 4 |
| Movie player | Custom controls, quality selection, subtitles | 4 |
| Library browsing | Grid/list views, sort, filter, search | 4 |
| Bulk operations | Multi-select, mark watched, add to playlist | 4 |
| Playlists | Create, edit, reorder, smart playlists | 4 |
| Watchlist | To-watch list management | 4 |
| Watch history | Tracking, filtering, resume list | 4 |
| Internal ratings | Decimal ratings (0.0-10.0), rate/unrate | 4 |
| Movie info flyout | Side panel during playback | 4 |
| Admin dashboard | Server status, active streams, user management | 4 |
| Search | Global search across movies, people, genres | 4 |
| Responsive design | Desktop, tablet, mobile layouts | 4 |
| Dark/light theme | Theme toggle with preference persistence | 4 |

### Extended Features (Stages 5-9)

| Feature | Description | Stage |
|---------|-------------|-------|
| Plugin system | Plugin framework, manifest, lifecycle, API | 5 |
| TMDB metadata plugin | Auto-fetch from TMDB | 5 |
| OMDB/IMDb plugin | IMDb ratings, RT scores, rating import | 5 |
| Torrent search plugin | Find magnet links on torrent sites | 5 |
| Rotten Tomatoes plugin | Critic/audience scores | 5 |
| Plugin management UI | Enable/disable, settings, activity log | 5 |
| Metadata-based recommendations | Content-based filtering algorithm | 6 |
| "Find me something new" | Discovery with filters | 6 |
| Similar movies | Per-movie similarity via metadata + TMDB | 6 |
| Browse by person | Actor/director filmography pages | 6 |
| Genre/category browsing | Browse by genre, decade, country | 6 |
| PWA support | Manifest, service worker, install prompt | 7 |
| Mobile UI | Bottom tabs, touch controls, mobile player | 7 |
| Mobile rater | Swipe-based rating interface | 7 |
| Offline metadata | Cached metadata for offline browsing | 7 |
| Movie embeddings | Vector similarity via ML model | 8 |
| MCP server | AI assistant integration | 8 |
| Embedding-based recommendations | More accurate similarity matching | 8 |
| Install script | Curl-based installer with deps | 9 |
| CLI management tool | Start/stop/config/scan commands | 9 |
| Docker support | Dockerfile + compose | 9 |
| Auto-update | Check, notify, one-click update | 9 |

### Future Enhancements (Post-v1)

| Feature | Description |
|---------|-------------|
| Chromecast/AirPlay | Cast to TV devices |
| Offline downloads | Download movies to mobile for offline viewing |
| Multi-server | Connect multiple Mu instances |
| TV show support | Series, seasons, episodes (significant scope expansion) |
| Skip intro detection | Auto-detect and skip intros (ML-based) |
| Watch parties | Synchronized playback for multiple users |
| Parental controls | Content filtering by rating/genre |
| Subtitle search | OpenSubtitles integration plugin |
| Trakt.tv sync | Sync watch history and ratings with Trakt |
| Natural language search | AI-powered "find me a movie like..." |
| Custom metadata fields | User-defined metadata per movie |
| Collection grouping | Auto-group sequels/franchises |
| Backup/restore | Full database + config backup |
| Multi-language UI | i18n support |

---

## Summary

Mu is designed as a progressively enhanceable platform. Stages 1-4 deliver a fully functional self-hosted movie library with streaming capability. Stages 5-6 add the plugin ecosystem and discovery features. Stages 7-9 polish the mobile experience, add AI-powered features, and streamline deployment.

The architecture prioritizes:
- **Simplicity**: SQLite + in-memory cache by default, one server process
- **Performance**: Fastify adapter for HTTP, direct play when possible, aggressive caching
- **Extensibility**: NestJS Dynamic Modules + plugin system for third-party integrations without core bloat
- **User experience**: Responsive PWA, custom player, smart recommendations

The monorepo structure with shared types ensures type safety across the stack, and Drizzle ORM's schema-as-code approach allows scaling from SQLite to PostgreSQL with a config change.
