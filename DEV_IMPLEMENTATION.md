# Mu - Detailed Implementation Plan

> Complete file-by-file implementation guide for every stage of the Mu self-hosted movie platform.

---

## Table of Contents

1. [Implementation Notes & Conventions](#1-implementation-notes--conventions)
2. [Stage 1: Foundation & Core Server](#2-stage-1-foundation--core-server)
3. [Stage 2: Library Management & Metadata](#3-stage-2-library-management--metadata)
4. [Stage 3: Video Streaming Engine](#4-stage-3-video-streaming-engine)
5. [Stage 4: Frontend Web UI](#5-stage-4-frontend-web-ui)
6. [Stage 5: Plugin System](#6-stage-5-plugin-system)
7. [Stage 6: Recommendations & Discovery](#7-stage-6-recommendations--discovery)
8. [Stage 7: Mobile Experience & PWA](#8-stage-7-mobile-experience--pwa)
9. [Stage 8: MCP Server & Embeddings](#9-stage-8-mcp-server--embeddings)
10. [Stage 9: Install System & Distribution](#10-stage-9-install-system--distribution)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Configuration File Reference](#12-configuration-file-reference)

---

## 1. Implementation Notes & Conventions

### 1.1 Coding Standards

- **TypeScript strict mode** enabled everywhere (`strict: true`, `noUncheckedIndexedAccess: true`)
- **Barrel exports** via `index.ts` per module/directory
- **Naming**: `camelCase` for variables/functions, `PascalCase` for classes/types/components, `SCREAMING_SNAKE_CASE` for constants, `kebab-case` for file/directory names
- **Absolute imports** via path aliases: `@mu/server`, `@mu/client`, `@mu/shared`
- **Error handling**: Custom error classes extending `MuError` base, NestJS exception filters for HTTP responses
- **Logging**: Always use injected `Logger` (NestJS/Pino), never `console.log`
- **Testing**: Unit tests with Vitest, E2E tests with Supertest + NestJS testing module
- **Commit style**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)

### 1.2 Shared Package Conventions (`packages/shared`)

All types, constants, enums, and utility functions shared between server and client live here. Both packages import from `@mu/shared`. This package has **zero runtime dependencies** - only TypeScript types and pure functions.

### 1.3 NestJS Module Pattern

Every feature area is a NestJS module with this structure:
```
feature/
├── feature.module.ts      # Module declaration
├── feature.controller.ts  # HTTP route handlers
├── feature.service.ts     # Business logic
├── feature.gateway.ts     # WebSocket gateway (if needed)
├── dto/                   # Request/response DTOs (Zod schemas)
├── entities/              # Drizzle schema definitions (if owns tables)
└── guards/                # Feature-specific guards (if any)
```

### 1.4 Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WebSocket library | `@nestjs/websockets` + `ws` adapter (`@nestjs/platform-ws`) | NestJS-native decorator-based gateways; `ws` is lighter than Socket.io and works with Fastify adapter |
| Config loading | `@nestjs/config` + custom YAML loader + Zod validation | NestJS-native, supports `.env` + `config.yml`, validated at boot |
| Auth strategy | Custom `JwtAuthGuard` using `@fastify/jwt` registered on Fastify instance | Fastify-native JWT for performance, wrapped in NestJS guard for decorator usage |
| File uploads | `@fastify/multipart` | Fastify-native, streamed (no temp files for large uploads) |
| Drizzle integration | Custom `DatabaseModule` providing `DrizzleService` via DI | No official NestJS adapter exists; thin wrapper is simple |
| UUID generation | `crypto.randomUUID()` (Node 19+) | Zero dependency, fast, built-in |
| Password hashing | `bcrypt` (native) | Industry standard, hardware-accelerated on most platforms |
| CORS | `@fastify/cors` registered via NestJS adapter | Configured per-environment (dev: permissive, prod: locked down) |

---

## 2. Stage 1: Foundation & Core Server

### 2.1 Project Scaffolding

#### 2.1.1 Initialize Monorepo

```
mu/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── nest-cli.json
│   ├── client/
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── shared/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── plugins/
│   ├── tmdb-metadata/
│   ├── omdb-ratings/
│   ├── torrent-search/
│   └── rotten-tomatoes/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/
│   ├── install.sh
│   └── dev.sh
├── data/                    # gitignored, created at runtime
├── .env.example
├── .gitignore
├── .eslintrc.cjs
├── .prettierrc
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

**Root `package.json`**:
```json
{
  "name": "mu",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "start": "node packages/server/dist/main.js",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "db:generate": "cd packages/server && drizzle-kit generate",
    "db:migrate": "cd packages/server && drizzle-kit migrate",
    "db:studio": "cd packages/server && drizzle-kit studio"
  },
  "devDependencies": {
    "turbo": "^2.x",
    "typescript": "^5.x",
    "eslint": "^9.x",
    "prettier": "^3.x"
  },
  "packageManager": "pnpm@9.x"
}
```

**`pnpm-workspace.yaml`**:
```yaml
packages:
  - "packages/*"
  - "plugins/*"
```

**`turbo.json`**:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {}
  }
}
```

**`tsconfig.base.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

#### 2.1.2 Server Package Setup

**`packages/server/package.json`** - Key dependencies:
```json
{
  "name": "@mu/server",
  "dependencies": {
    "@nestjs/core": "^11.x",
    "@nestjs/common": "^11.x",
    "@nestjs/config": "^4.x",
    "@nestjs/platform-fastify": "^11.x",
    "@nestjs/websockets": "^11.x",
    "@nestjs/platform-ws": "^11.x",
    "@nestjs/serve-static": "^5.x",
    "@fastify/cors": "^10.x",
    "@fastify/helmet": "^13.x",
    "@fastify/cookie": "^11.x",
    "@fastify/jwt": "^9.x",
    "@fastify/multipart": "^9.x",
    "@fastify/static": "^8.x",
    "@fastify/rate-limit": "^10.x",
    "fastify": "^5.x",
    "drizzle-orm": "^0.38.x",
    "better-sqlite3": "^11.x",
    "lru-cache": "^11.x",
    "bcrypt": "^5.x",
    "zod": "^3.x",
    "chokidar": "^4.x",
    "fluent-ffmpeg": "^2.x",
    "toad-scheduler": "^3.x",
    "pino": "^9.x",
    "pino-pretty": "^13.x",
    "js-yaml": "^4.x",
    "uuid": "^11.x",
    "@mu/shared": "workspace:*"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.x",
    "@nestjs/testing": "^11.x",
    "@types/better-sqlite3": "^7.x",
    "@types/bcrypt": "^5.x",
    "@types/fluent-ffmpeg": "^2.x",
    "@types/js-yaml": "^4.x",
    "drizzle-kit": "^0.30.x",
    "vitest": "^3.x",
    "supertest": "^7.x"
  }
}
```

#### 2.1.3 Shared Package Setup

**`packages/shared/src/index.ts`** - barrel export:
```typescript
export * from './types/index.js';
export * from './constants/index.js';
export * from './enums/index.js';
export * from './utils/index.js';
```

Key shared types to define upfront:

**`packages/shared/src/types/movie.ts`**:
```typescript
export interface Movie {
  id: string;
  title: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  tagline?: string;
  runtimeMinutes?: number;
  releaseDate?: string;
  language?: string;
  country?: string;
  posterUrl?: string;
  backdropUrl?: string;
  trailerUrl?: string;
  imdbId?: string;
  tmdbId?: number;
  contentRating?: string;
  addedAt: string;
  updatedAt: string;
}

export interface MovieMetadata {
  id: string;
  movieId: string;
  genres: string[];
  cast: CastMember[];
  directors: string[];
  writers: string[];
  keywords: string[];
  productionCompanies: string[];
  budget?: number;
  revenue?: number;
  imdbRating?: number;
  imdbVotes?: number;
  tmdbRating?: number;
  tmdbVotes?: number;
  rottenTomatoesScore?: number;
  metacriticScore?: number;
  extendedData?: Record<string, unknown>;
  source?: string;
  fetchedAt: string;
  updatedAt: string;
}

export interface CastMember {
  name: string;
  character?: string;
  profileUrl?: string;
  tmdbId?: number;
}

export interface MovieFile {
  id: string;
  movieId: string;
  sourceId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  fileHash?: string;
  resolution?: string;
  codecVideo?: string;
  codecAudio?: string;
  bitrate?: number;
  durationSeconds?: number;
  subtitleTracks: SubtitleTrack[];
  audioTracks: AudioTrack[];
  available: boolean;
  addedAt: string;
  fileModifiedAt?: string;
}

export interface SubtitleTrack {
  index: number;
  language?: string;
  title?: string;
  codec: string;
  forced?: boolean;
}

export interface AudioTrack {
  index: number;
  language?: string;
  title?: string;
  codec: string;
  channels?: number;
}
```

**`packages/shared/src/types/user.ts`**:
```typescript
export interface User {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  avatarUrl?: string;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'user';

export interface UserPreferences {
  theme: 'dark' | 'light' | 'auto';
  language: string;
  defaultQuality: StreamQuality;
  defaultSubtitleLanguage?: string;
  defaultAudioLanguage?: string;
  autoplayNext: boolean;
  posterSize: 'small' | 'medium' | 'large';
  defaultView: 'grid' | 'list';
  sidebarCollapsed: boolean;
  ratingDisplay: '5-star' | '10-point';
  ratingSource: 'internal' | 'imdb' | 'tmdb';
}

export type StreamQuality = '480p' | '720p' | '1080p' | '4k' | 'original';
```

**`packages/shared/src/types/api.ts`**:
```typescript
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface MovieListQuery extends PaginationQuery {
  search?: string;
  genre?: string;
  yearFrom?: number;
  yearTo?: number;
  ratingFrom?: number;
  ratingTo?: number;
  resolution?: string;
  watched?: boolean;
  hasSubtitles?: boolean;
}
```

**`packages/shared/src/constants/index.ts`**:
```typescript
export const DEFAULT_PORT = 8080;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
export const JWT_ACCESS_EXPIRY = '15m';
export const JWT_REFRESH_EXPIRY = '30d';
export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.wmv',
  '.flv', '.webm', '.m4v', '.ts', '.m2ts'
];
export const SUPPORTED_SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
export const HLS_SEGMENT_DURATION = 6;
export const PLAYBACK_SAVE_INTERVAL_MS = 10_000;
export const CACHE_NAMESPACES = {
  METADATA: 'metadata',
  POSTER: 'poster',
  SEARCH: 'search',
  API: 'api',
  STREAM: 'stream',
  RECOMMENDATIONS: 'recommendations',
} as const;
```

**`packages/shared/src/enums/index.ts`**:
```typescript
export enum ScanStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum StreamMode {
  DIRECT_PLAY = 'direct_play',
  DIRECT_STREAM = 'direct_stream',
  TRANSCODE = 'transcode',
}

export enum HwAccel {
  NONE = 'none',
  VAAPI = 'vaapi',
  NVENC = 'nvenc',
  QSV = 'qsv',
}

export enum WsEvent {
  // Client -> Server
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  PLAYER_HEARTBEAT = 'player:heartbeat',
  // Server -> Client
  LIBRARY_MOVIE_ADDED = 'library:movie-added',
  LIBRARY_MOVIE_UPDATED = 'library:movie-updated',
  LIBRARY_MOVIE_REMOVED = 'library:movie-removed',
  SCAN_STARTED = 'scan:started',
  SCAN_PROGRESS = 'scan:progress',
  SCAN_COMPLETED = 'scan:completed',
  SCAN_ERROR = 'scan:error',
  STREAM_STARTED = 'stream:started',
  STREAM_ENDED = 'stream:ended',
  PLUGIN_EVENT = 'plugin:event',
  SERVER_STATUS = 'server:status',
  NOTIFICATION = 'notification',
}
```

### 2.2 NestJS Server Bootstrap

#### 2.2.1 Server Source Structure

```
packages/server/src/
├── main.ts                          # Entry point
├── app.module.ts                    # Root module
├── common/                          # Shared utilities
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── public.decorator.ts
│   │   └── roles.decorator.ts
│   ├── filters/
│   │   └── global-exception.filter.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── local-bypass.guard.ts
│   ├── interceptors/
│   │   ├── logging.interceptor.ts
│   │   └── cache.interceptor.ts
│   ├── pipes/
│   │   └── zod-validation.pipe.ts
│   └── interfaces/
│       └── request.interface.ts
├── config/                          # Configuration
│   ├── config.module.ts
│   ├── config.service.ts
│   ├── config.schema.ts             # Zod schema for config validation
│   ├── config.loader.ts             # YAML + ENV loader
│   └── config.types.ts
├── database/                        # Database layer
│   ├── database.module.ts
│   ├── database.service.ts          # Drizzle instance provider
│   ├── schema/                      # Drizzle table schemas
│   │   ├── users.ts
│   │   ├── movies.ts
│   │   ├── movie-metadata.ts
│   │   ├── movie-files.ts
│   │   ├── media-sources.ts
│   │   ├── user-ratings.ts
│   │   ├── user-watch-history.ts
│   │   ├── user-watchlist.ts
│   │   ├── playlists.ts
│   │   ├── playlist-movies.ts
│   │   ├── settings.ts
│   │   ├── plugins.ts
│   │   ├── api-keys.ts
│   │   ├── devices.ts
│   │   ├── stream-sessions.ts
│   │   ├── scan-log.ts
│   │   └── index.ts                 # Barrel export of all schemas
│   └── migrations/                  # Generated by drizzle-kit
├── auth/                            # Auth module
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── dto/
│       ├── login.dto.ts
│       ├── register.dto.ts
│       └── setup.dto.ts
├── users/                           # User module
│   ├── users.module.ts
│   ├── users.controller.ts
│   └── users.service.ts
├── cache/                           # Cache module
│   ├── cache.module.ts
│   ├── cache.service.ts
│   ├── providers/
│   │   ├── cache-provider.interface.ts
│   │   ├── memory-cache.provider.ts
│   │   └── redis-cache.provider.ts
│   └── cache.constants.ts
├── events/                          # WebSocket / Event module
│   ├── events.module.ts
│   ├── events.gateway.ts            # WebSocket gateway
│   └── events.service.ts            # Event bus for internal pub/sub
├── scheduler/                       # Background tasks
│   ├── scheduler.module.ts
│   └── scheduler.service.ts
└── health/                          # Health check
    ├── health.module.ts
    └── health.controller.ts
```

#### 2.2.2 `main.ts` - Application Entry Point

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
      },
      trustProxy: true,
    }),
  );

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Register Fastify plugins
  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(import('@fastify/cors'), {
    origin: config.get('server.corsOrigins', true),
    credentials: true,
  });
  await fastify.register(import('@fastify/helmet'), {
    contentSecurityPolicy: config.get('server.csp', false),
  });
  await fastify.register(import('@fastify/cookie'), {
    secret: config.get('auth.cookieSecret'),
  });
  await fastify.register(import('@fastify/jwt'), {
    secret: config.get('auth.jwtSecret'),
    cookie: { cookieName: 'mu_access_token', signed: false },
  });
  await fastify.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  });

  // Global prefix for API routes
  app.setGlobalPrefix('api/v1', {
    exclude: ['/(.*)'],  // Don't prefix static file routes
  });

  // Enable graceful shutdown
  app.enableShutdownHooks();

  const host = config.get('server.host', '0.0.0.0');
  const port = config.get('server.port', 8080);

  await app.listen(port, host);
  logger.log(`Mu server running at http://${host}:${port}`);
}

bootstrap();
```

#### 2.2.3 `app.module.ts` - Root Module

```typescript
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { CacheModule } from './cache/cache.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { EventsModule } from './events/events.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { HealthModule } from './health/health.module.js';
// Stage 2+
import { LibraryModule } from './library/library.module.js';
import { MoviesModule } from './movies/movies.module.js';
import { MetadataModule } from './metadata/metadata.module.js';
// Stage 3
import { StreamModule } from './stream/stream.module.js';
// Stage 5
import { PluginModule } from './plugins/plugin.module.js';
// Stage 6
import { RecommendationsModule } from './recommendations/recommendations.module.js';

@Module({
  imports: [
    // Serve built Preact client
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'client', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    // Core modules (Stage 1)
    ConfigModule,
    DatabaseModule,
    CacheModule,
    AuthModule,
    UsersModule,
    EventsModule,
    SchedulerModule,
    HealthModule,
    // Feature modules (Stage 2+)
    LibraryModule,
    MoviesModule,
    MetadataModule,
    // Stage 3
    StreamModule,
    // Stage 5
    PluginModule,
    // Stage 6
    RecommendationsModule,
  ],
})
export class AppModule {}
```

### 2.3 Configuration System

#### 2.3.1 Config Schema (`config.schema.ts`)

Define the full Zod schema for `config.yml`:

```typescript
import { z } from 'zod';

export const configSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(8080),
    corsOrigins: z.union([z.string(), z.array(z.string()), z.boolean()]).default(true),
    csp: z.boolean().default(false),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }).default({}),

  database: z.object({
    type: z.enum(['sqlite', 'postgres']).default('sqlite'),
    sqlitePath: z.string().default('./data/db/mu.db'),
    postgresUrl: z.string().optional(),
  }).default({}),

  cache: z.object({
    type: z.enum(['memory', 'redis']).default('memory'),
    redisUrl: z.string().optional(),
    maxEntries: z.number().int().default(10000),
    defaultTtlSeconds: z.number().int().default(3600),
  }).default({}),

  auth: z.object({
    jwtSecret: z.string().min(32),
    cookieSecret: z.string().min(32),
    localBypass: z.boolean().default(true),
    accessTokenExpiry: z.string().default('15m'),
    refreshTokenExpiry: z.string().default('30d'),
  }),

  media: z.object({
    directories: z.array(z.object({
      path: z.string(),
      label: z.string().optional(),
      scanIntervalHours: z.number().int().default(6),
      enabled: z.boolean().default(true),
    })).default([]),
    supportedExtensions: z.array(z.string()).default([
      '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'
    ]),
    scanOnStartup: z.boolean().default(true),
    autoFetchMetadata: z.boolean().default(true),
  }).default({}),

  transcoding: z.object({
    hwAccel: z.enum(['none', 'vaapi', 'nvenc', 'qsv']).default('none'),
    maxConcurrent: z.number().int().min(1).max(10).default(2),
    tempDir: z.string().default('./data/cache/streams'),
    defaultQuality: z.enum(['480p', '720p', '1080p', '4k']).default('1080p'),
    profiles: z.object({
      '480p': z.object({ videoBitrate: z.string().default('1M'), audioBitrate: z.string().default('128k') }).default({}),
      '720p': z.object({ videoBitrate: z.string().default('2.5M'), audioBitrate: z.string().default('192k') }).default({}),
      '1080p': z.object({ videoBitrate: z.string().default('5M'), audioBitrate: z.string().default('256k') }).default({}),
      '4k': z.object({ videoBitrate: z.string().default('15M'), audioBitrate: z.string().default('320k') }).default({}),
    }).default({}),
  }).default({}),

  thirdParty: z.object({
    tmdbApiKey: z.string().optional(),
    omdbApiKey: z.string().optional(),
    openSubtitlesApiKey: z.string().optional(),
  }).default({}),

  ratings: z.object({
    scale: z.enum(['5-star', '10-point']).default('10-point'),
    defaultSort: z.enum(['internal', 'imdb', 'tmdb']).default('internal'),
    showSources: z.array(z.enum(['internal', 'imdb', 'tmdb', 'rt', 'metacritic'])).default(['internal', 'imdb']),
  }).default({}),

  plugins: z.object({
    enabled: z.array(z.string()).default([]),
    directory: z.string().default('./plugins'),
  }).default({}),

  dataDir: z.string().default('./data'),
});

export type MuConfig = z.infer<typeof configSchema>;
```

#### 2.3.2 Config Loader (`config.loader.ts`)

```typescript
// Loads config with priority: defaults < config.yml < .env < ENV vars < CLI flags
// On first run, generates config.yml with random JWT/cookie secrets
// Validates final merged config against Zod schema
// Throws descriptive error on validation failure with exact field path
```

Implementation approach:
1. Check if `config.yml` exists in `dataDir`; if not, generate it with `crypto.randomBytes(48).toString('hex')` for secrets
2. Load YAML with `js-yaml`
3. Deep-merge with `process.env` mappings (e.g., `MU_SERVER_PORT` -> `server.port`)
4. Validate against `configSchema`
5. Freeze the config object to prevent mutations

#### 2.3.3 NestJS ConfigModule Integration

```typescript
// config.module.ts - Global module that provides ConfigService
// ConfigService wraps the validated config with typed getter:
//   config.get('server.port') -> number
//   config.get('auth.jwtSecret') -> string
// Registered as global module so all other modules can inject ConfigService
```

### 2.4 Database Layer

#### 2.4.1 Drizzle Schema Definitions

Each table gets its own file in `packages/server/src/database/schema/`. Example for the core tables:

**`schema/movies.ts`**:
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const movies = sqliteTable('movies', {
  id: text('id').primaryKey(),  // UUID
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  year: integer('year'),
  overview: text('overview'),
  tagline: text('tagline'),
  runtimeMinutes: integer('runtime_minutes'),
  releaseDate: text('release_date'),
  language: text('language'),
  country: text('country'),
  posterUrl: text('poster_url'),
  backdropUrl: text('backdrop_url'),
  trailerUrl: text('trailer_url'),
  imdbId: text('imdb_id'),
  tmdbId: integer('tmdb_id'),
  contentRating: text('content_rating'),
  addedAt: text('added_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

**`schema/user-ratings.ts`**:
```typescript
import { sqliteTable, text, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users.js';
import { movies } from './movies.js';

export const userRatings = sqliteTable('user_ratings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  movieId: text('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
  rating: real('rating').notNull(),  // 0.0 - 10.0, supports decimals like 6.3
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  userMovieUnique: uniqueIndex('user_movie_rating_unique').on(table.userId, table.movieId),
}));
```

Follow this pattern for all 14+ tables from the high-level schema design.

**Important Drizzle notes for SQLite**:
- SQLite has no native `DECIMAL` type - use `real` for decimal ratings
- SQLite has no native `BOOLEAN` - use `integer` mode `boolean` (`integer('available', { mode: 'boolean' })`)
- JSON columns stored as `text` in SQLite, parsed in application code
- Dates stored as ISO 8601 text strings (SQLite has no native date type)
- UUIDs stored as `text` (36 chars)

#### 2.4.2 Database Module (`database.module.ts`)

```typescript
import { Module, Global, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule implements OnModuleInit {
  constructor(private db: DatabaseService) {}

  async onModuleInit() {
    await this.db.initialize();
    await this.db.runMigrations();
  }
}
```

**`database.service.ts`** implementation approach:
```typescript
// - Creates better-sqlite3 instance with WAL mode enabled
// - Wraps it in Drizzle ORM: drizzle(betterSqlite3Instance, { schema })
// - Exposes typed `db` getter for use in services
// - Handles initialization: create data/db directory, run migrations
// - Provides backup/vacuum utility methods
// - On shutdown: close database connection gracefully
```

#### 2.4.3 PostgreSQL Support

Drizzle's schema-as-code approach means we need **two schema definition sets** (SQLite uses `sqliteTable`, PostgreSQL uses `pgTable`). To avoid duplication:

1. Define schemas using a factory function that accepts the table builder
2. At startup, `DatabaseService` checks `config.database.type` and imports the correct driver
3. For SQLite: `drizzle(better-sqlite3-instance)` with `drizzle-orm/better-sqlite3`
4. For PostgreSQL: `drizzle(pg-pool-instance)` with `drizzle-orm/node-postgres`

**Alternative (simpler for initial implementation)**: Start with SQLite-only schema definitions. When PostgreSQL support is needed, create a `schema-pg/` directory with PostgreSQL equivalents. The Drizzle query API is nearly identical between both, so service code doesn't change.

**Recommended approach**: Use the alternative (simpler) approach for Stage 1. PostgreSQL is a future upgrade path.

### 2.5 Authentication

#### 2.5.1 Auth Flow Implementation

**`auth.service.ts`**:
```typescript
// register(username, email, password): Hash password with bcrypt(12), create user, return JWT pair
// login(username, password): Validate credentials, create device record, return JWT pair in cookies
// refresh(refreshToken): Validate refresh token, issue new access token
// logout(userId, deviceId): Revoke refresh token for device
// setupAdmin(username, email, password): First-run only - create admin user (fails if any user exists)
// generateTokenPair(userId, role, deviceId): Create access + refresh JWTs, set in httpOnly cookies
```

**`jwt-auth.guard.ts`**:
```typescript
// NestJS CanActivate guard
// 1. Check if route is marked @Public() -> skip auth
// 2. Check if localBypass enabled AND request from localhost -> inject admin user
// 3. Extract JWT from cookie (mu_access_token) or Authorization header (Bearer xxx)
// 4. Verify JWT using fastify.jwt.verify()
// 5. Attach user to request object
// 6. If JWT expired, check for refresh token cookie -> auto-refresh if valid
```

**`local-bypass.guard.ts`**:
```typescript
// Checks request IP against localhost addresses (127.0.0.1, ::1, ::ffff:127.0.0.1)
// If match AND config.auth.localBypass is true, inject admin user context
// Used as part of the auth guard chain
```

#### 2.5.2 Auth Controller Routes

```
POST /api/v1/auth/setup    - @Public() - First-run admin account creation
POST /api/v1/auth/login    - @Public() - Login, returns cookies
POST /api/v1/auth/logout   - Clears cookies, revokes refresh token
POST /api/v1/auth/refresh  - @Public() - Refresh access token using refresh cookie
GET  /api/v1/auth/me       - Returns current user profile
```

### 2.6 Cache Layer

#### 2.6.1 Cache Provider Interface

```typescript
export interface ICacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(namespace?: string): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  size(): Promise<number>;
}
```

#### 2.6.2 Memory Cache Provider

```typescript
// Uses lru-cache package
// Constructor: new LRUCache({ max: config.cache.maxEntries, ttl: config.cache.defaultTtlSeconds * 1000 })
// All methods are synchronous wraps of LRU operations returned as resolved promises
// Key format: "namespace:actualKey" (e.g., "metadata:tmdb:12345")
// Namespaced clear: iterate keys starting with prefix
```

#### 2.6.3 Cache Service

```typescript
// CacheService wraps ICacheProvider with namespace-aware helpers:
//   cache.metadata.get(movieId) -> cache.get('metadata:' + movieId)
//   cache.search.set(query, results, 3600)
//   cache.api.get('tmdb:movie:12345')
// Also provides stats: { size, hitRate, missRate } for admin dashboard
```

### 2.7 WebSocket Gateway

#### 2.7.1 Events Gateway (`events.gateway.ts`)

```typescript
import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';

@WebSocketGateway({ path: '/ws' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // Track connected clients and their channel subscriptions
  private clients = new Map<WebSocket, { userId?: string; channels: Set<string> }>();

  handleConnection(client: WebSocket) {
    this.clients.set(client, { channels: new Set() });
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: WebSocket, channel: string) {
    this.clients.get(client)?.channels.add(channel);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: WebSocket, channel: string) {
    this.clients.get(client)?.channels.delete(channel);
  }

  // Called by other services to broadcast events
  broadcast(channel: string, event: string, data: unknown) {
    for (const [client, meta] of this.clients) {
      if (meta.channels.has(channel) && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event, data }));
      }
    }
  }
}
```

#### 2.7.2 Events Service (`events.service.ts`)

```typescript
// Internal event bus using Node.js EventEmitter
// Services emit events here; gateway picks them up and broadcasts to WebSocket clients
// Also used for internal service-to-service communication (e.g., scanner -> metadata fetcher)
// Typed events using a TypeScript event map interface
```

### 2.8 Background Scheduler

```typescript
// scheduler.service.ts
// Uses toad-scheduler to register periodic tasks
// Tasks registered during onModuleInit lifecycle hook
// Each task is a SimpleIntervalJob with an AsyncTask
//
// Default scheduled tasks:
// 1. LibraryScan - runs every config.media.scanInterval hours
// 2. MetadataRefresh - daily, fetches metadata for movies missing info
// 3. CacheCleanup - hourly, evicts expired disk cache entries
// 4. ThumbnailQueue - every 5 min, processes pending thumbnail generation
// 5. DirectoryHealthCheck - every 5 min, verifies watched dirs are accessible
//
// Task status stored in memory, exposed via admin API
// Tasks can be triggered manually via admin API
```

---

## 3. Stage 2: Library Management & Metadata

### 3.1 Module Structure

```
packages/server/src/
├── library/
│   ├── library.module.ts
│   ├── library.controller.ts       # Media source CRUD endpoints
│   ├── library.service.ts           # Source management logic
│   ├── scanner/
│   │   ├── scanner.service.ts       # Orchestrates scanning
│   │   ├── scanner.worker.ts        # Worker thread entry point
│   │   ├── file-parser.service.ts   # Filename parsing (title, year, quality)
│   │   └── ffprobe.service.ts       # FFprobe metadata extraction
│   ├── watcher/
│   │   ├── watcher.service.ts       # Chokidar file watcher management
│   │   └── watcher.events.ts        # File change event handling
│   └── dto/
│       ├── add-source.dto.ts
│       └── scan-status.dto.ts
├── movies/
│   ├── movies.module.ts
│   ├── movies.controller.ts         # Movie CRUD, search, bulk ops
│   ├── movies.service.ts            # Movie business logic
│   ├── ratings.controller.ts        # Rating endpoints
│   ├── ratings.service.ts
│   ├── history.controller.ts        # Watch history endpoints
│   ├── history.service.ts
│   ├── watchlist.controller.ts
│   ├── watchlist.service.ts
│   ├── playlists.controller.ts
│   ├── playlists.service.ts
│   └── dto/
│       ├── movie-query.dto.ts
│       ├── rate-movie.dto.ts
│       ├── create-playlist.dto.ts
│       └── bulk-action.dto.ts
├── metadata/
│   ├── metadata.module.ts
│   ├── metadata.service.ts          # Orchestrates metadata fetching
│   ├── metadata.controller.ts       # Manual metadata refresh
│   ├── providers/
│   │   ├── metadata-provider.interface.ts
│   │   ├── tmdb.provider.ts         # TMDB API client
│   │   └── omdb.provider.ts         # OMDB API client
│   ├── images/
│   │   ├── image.service.ts         # Download, cache, resize images
│   │   └── image.controller.ts      # Image proxy endpoint
│   └── dto/
│       └── metadata-match.dto.ts
```

### 3.2 File Scanner Implementation

#### 3.2.1 Scanner Service

```typescript
// scanner.service.ts
// Orchestrates library scans:
// 1. Called by scheduler (periodic) or admin API (manual trigger)
// 2. For each enabled media source:
//    a. Spawn a worker thread (scanner.worker.ts) with source path
//    b. Worker recursively walks directory, collecting video files
//    c. Worker sends progress updates via parentPort.postMessage()
//    d. Main thread receives updates, emits WebSocket events
// 3. For each discovered file:
//    a. Check if already in movie_files table (by path + modified date)
//    b. If new or modified: run ffprobe to extract media info
//    c. Parse filename to extract title + year + quality
//    d. Create/update movie_files record
//    e. If new movie: create movies record, queue metadata fetch
// 4. After scan: mark files not found as unavailable (available=false)
// 5. Log scan results to scan_log table
// 6. Emit scan:completed WebSocket event
```

#### 3.2.2 Worker Thread (`scanner.worker.ts`)

```typescript
// Runs in a worker thread to avoid blocking main event loop
// Input: { sourcePath, supportedExtensions, existingFilePaths }
// Process:
// 1. Walk directory recursively using fs.opendir (streaming, memory efficient)
// 2. Filter by supported extensions
// 3. For each file: stat for size + mtime
// 4. Send results back via postMessage in batches of 100
// 5. Signal completion when done
```

#### 3.2.3 Filename Parser (`file-parser.service.ts`)

```typescript
// Parses movie filenames to extract structured data
// Uses combination of regex patterns and the 'parse-torrent-title' library
// Examples:
//   "The Matrix (1999).mkv" -> { title: "The Matrix", year: 1999 }
//   "The.Matrix.1999.1080p.BluRay.x264.mkv" -> { title: "The Matrix", year: 1999, quality: "1080p", source: "BluRay", codec: "x264" }
//   "The Matrix Reloaded (2003) [2160p] [4K].mp4" -> { title: "The Matrix Reloaded", year: 2003, quality: "4K" }
// Falls back to treating entire filename (minus extension) as title if no pattern matches
```

#### 3.2.4 FFprobe Service (`ffprobe.service.ts`)

```typescript
// Wraps fluent-ffmpeg's ffprobe to extract media info from video files
// Returns structured data:
// {
//   duration: number (seconds),
//   resolution: string ('1080p', '720p', '4K'),
//   width: number, height: number,
//   videoCodec: string ('h264', 'h265', 'vp9'),
//   audioCodec: string ('aac', 'ac3', 'dts'),
//   bitrate: number,
//   audioTracks: AudioTrack[],
//   subtitleTracks: SubtitleTrack[],
// }
// Handles errors gracefully (corrupt files, unsupported formats)
// Results cached in memory cache (key: file hash or path+mtime)
```

### 3.3 File Watcher Implementation

```typescript
// watcher.service.ts
// On module init:
// 1. Read all enabled media sources from database
// 2. Create chokidar watcher for each source directory
// 3. Configure: ignored patterns, depth, polling (for network mounts)
//
// Event handlers (with 2-second debounce per file):
// 'add' event:
//   - Verify file has finished copying (check size stability over 2 seconds)
//   - Run ffprobe, parse filename
//   - Create movie_files record
//   - Queue metadata fetch
//   - Emit library:movie-added WebSocket event
//
// 'change' event:
//   - Re-run ffprobe
//   - Update movie_files record
//   - Emit library:movie-updated
//
// 'unlink' event:
//   - Set available=false on movie_files record (preserve movie + ratings)
//   - Emit library:movie-removed
//
// Health monitoring:
// - If watcher emits 'error', log and attempt restart after 30s
// - HealthCheck scheduled task verifies directories are accessible
```

### 3.4 Metadata Fetching

#### 3.4.1 TMDB Provider (`tmdb.provider.ts`)

```typescript
// Implements MetadataProviderInterface
// Methods:
//   searchMovie(title, year?): Search TMDB, return top 5 matches with confidence scores
//   getMovieDetails(tmdbId): Full movie info (details, credits, images, similar, keywords)
//   getImageUrl(path, size): Construct full TMDB image URL
//
// Implementation details:
// - Base URL: https://api.themoviedb.org/3
// - Auth: API key as query param or Bearer token
// - Rate limiting: Track requests, sleep if approaching 40/sec limit
// - Caching: All responses cached with 7-day TTL
// - Error handling: Retry on 429 (rate limit) with exponential backoff, max 3 retries
// - Language: Configurable, default 'en-US'
//
// Key endpoints used:
//   GET /search/movie?query={title}&year={year}
//   GET /movie/{id}?append_to_response=credits,images,similar,keywords,videos
//   GET /configuration (for image base URLs, cached indefinitely)
```

#### 3.4.2 OMDB Provider (`omdb.provider.ts`)

```typescript
// Supplements TMDB with IMDb ratings, RT scores, Metacritic
// Methods:
//   getByImdbId(imdbId): Fetch movie data by IMDb ID
//   searchByTitle(title, year?): Search by title
//
// Implementation:
// - Base URL: https://www.omdbapi.com
// - Auth: API key as query param (?apikey=xxx)
// - Rate limit tracking: 1,000/day on free tier
// - Returns: IMDb rating, IMDb votes, RT score, Metacritic score, plot, awards
```

#### 3.4.3 Metadata Service (`metadata.service.ts`)

```typescript
// Orchestrates the metadata fetch pipeline:
// fetchForMovie(movieId):
//   1. Get movie record (has title, year from filename parsing)
//   2. Search TMDB by title + year
//   3. If single confident match: use it. If ambiguous: flag for manual match.
//   4. Fetch full TMDB details (movie info + credits + images + similar)
//   5. Update movies table: tmdbId, imdbId, overview, runtime, poster, backdrop, etc.
//   6. Create/update movie_metadata record: genres, cast, directors, writers, keywords, ratings
//   7. If OMDB API key configured: fetch OMDB data by IMDb ID
//   8. Update movie_metadata: imdbRating, imdbVotes, rottenTomatoesScore, metacriticScore
//   9. Download and cache poster + backdrop images
//   10. Emit library:movie-updated WebSocket event
//
// refreshMetadata(movieId): Force re-fetch, ignoring cache
// bulkFetch(movieIds): Process array with concurrency limit (5 at a time)
// resolveMatch(movieId, tmdbId): Admin manually selects correct TMDB match
```

### 3.5 Image Management

```typescript
// image.service.ts
// downloadAndCache(url, movieId, type: 'poster'|'backdrop', size: 'thumb'|'medium'|'large'):
//   1. Check if already cached on disk: data/cache/images/{movieId}/{type}_{size}.jpg
//   2. If not: download from URL, resize with sharp (if installed) or store original
//   3. Return local cache path
//
// Sizes:
//   thumb: 150px wide (for lists)
//   medium: 300px wide (for grid cards)
//   large: original size (for detail pages)
//
// image.controller.ts
// GET /api/v1/images/:movieId/:type/:size
//   - Serves cached image from disk
//   - If not cached: triggers download, caches, returns
//   - Sets Cache-Control: max-age=2592000 (30 days)
//   - If image unavailable: returns placeholder image
```

---

## 4. Stage 3: Video Streaming Engine

### 4.1 Module Structure

```
packages/server/src/stream/
├── stream.module.ts
├── stream.controller.ts             # Stream endpoints
├── stream.service.ts                # Stream session management
├── transcoder/
│   ├── transcoder.service.ts        # FFmpeg transcoding orchestration
│   ├── transcoder.profiles.ts       # Quality profile definitions
│   ├── hls-generator.service.ts     # HLS manifest + segment generation
│   └── codec-support.service.ts     # Client codec compatibility detection
├── direct-play/
│   ├── direct-play.service.ts       # HTTP range request handler
│   └── direct-stream.service.ts     # Container remuxing (MKV->MP4)
├── subtitles/
│   ├── subtitle.service.ts          # Extract + convert subtitles
│   └── subtitle.controller.ts       # Subtitle serving endpoint
└── dto/
    ├── start-stream.dto.ts
    └── stream-progress.dto.ts
```

### 4.2 Stream Decision Logic

```typescript
// stream.service.ts - startStream(movieId, userId, preferredQuality)
//
// 1. Look up movie_files for this movie, select best available file
// 2. Determine stream mode:
//    a. Check file codec (codecVideo) against browser compatibility map:
//       - H.264 in MP4: direct play on all browsers
//       - H.264 in MKV: direct stream (remux to MP4)
//       - H.265/HEVC: transcode (most browsers don't support)
//       - VP9 in WebM: direct play on Chrome/Firefox, transcode for Safari
//       - AV1: transcode (limited support)
//    b. If client explicitly requests a quality different from source: transcode
//    c. If source resolution > requested quality: transcode (downscale)
//
// 3. Create stream_sessions record
// 4. Based on mode:
//    - DIRECT_PLAY: Return file URL for range-request serving
//    - DIRECT_STREAM: Start remux process, return HLS manifest URL
//    - TRANSCODE: Start FFmpeg, return HLS manifest URL
// 5. Return stream session info (sessionId, manifestUrl, mode, subtitles, audioTracks)
```

### 4.3 HLS Transcoding

```typescript
// hls-generator.service.ts
//
// generateHLS(filePath, sessionId, quality, hwAccel, startTimeSeconds?):
//   1. Create session temp directory: data/cache/streams/{sessionId}/
//   2. Build FFmpeg command:
//      - Input: filePath
//      - Seek: if startTimeSeconds provided (for resume/seek)
//      - Video: -c:v libx264 (or hw encoder), -preset fast, -profile:v main, -level 4.0
//      - Audio: -c:a aac, -b:a {profile.audioBitrate}, -ac 2
//      - HLS: -f hls, -hls_time 6, -hls_list_size 0, -hls_segment_filename '{dir}/seg_%04d.ts'
//      - Quality: -b:v {profile.videoBitrate}, -maxrate, -bufsize
//      - Hardware accel flags based on config
//   3. Spawn FFmpeg as child_process
//   4. Monitor progress (FFmpeg stderr output parsing)
//   5. Track process in active streams map
//   6. On completion/error: log, cleanup if error
//
// HLS Manifest serving:
//   - Initially generate a "live" manifest that grows as segments are produced
//   - After full transcode, convert to VOD manifest with full duration
//   - On seek beyond current position: kill current FFmpeg, restart from new position
//
// Cleanup:
//   - On stream end (explicit or timeout): kill FFmpeg process, delete temp segments
//   - Grace period: keep segments for 1 hour after last activity (for pause/resume)
//   - Scheduled cleanup: remove orphaned session dirs older than 2 hours
```

### 4.4 Direct Play / Range Requests

```typescript
// direct-play.service.ts
//
// serveFile(filePath, request, reply):
//   1. Stat file for size
//   2. Parse Range header from request
//   3. If Range present:
//      - Calculate start/end byte positions
//      - Set 206 Partial Content status
//      - Set Content-Range header
//      - Create read stream with {start, end} options
//   4. If no Range:
//      - Set 200 OK
//      - Set Content-Length
//      - Create full read stream
//   5. Set Content-Type based on container (video/mp4, video/webm, etc.)
//   6. Pipe read stream to response
//
// Supports:
//   - Multi-range requests (multiple byte ranges)
//   - HEAD requests (metadata only, no body)
//   - Conditional requests (If-Range, If-Modified-Since)
```

### 4.5 Subtitle Handling

```typescript
// subtitle.service.ts
//
// extractSubtitles(filePath):
//   1. Run ffprobe to list subtitle tracks
//   2. For each embedded subtitle track:
//      a. Extract using FFmpeg: ffmpeg -i {file} -map 0:s:{index} -f webvtt output.vtt
//      b. Store in data/cache/subtitles/{movieFileId}/track_{index}.vtt
//   3. Check for external subtitle files alongside video file:
//      - Same name with .srt, .vtt, .ass extension
//      - Subdirectory named "Subs" or "Subtitles"
//   4. Convert external SRT/ASS to WebVTT
//   5. Return array of available subtitle tracks with metadata
//
// subtitle.controller.ts
// GET /api/v1/stream/:sessionId/subtitles/:trackIndex
//   - Serve WebVTT file
//   - Content-Type: text/vtt
```

### 4.6 Stream Controller Endpoints

```
GET  /api/v1/stream/:movieId/start
  - Query params: quality, audioTrack, subtitleTrack
  - Returns: { sessionId, manifestUrl, mode, subtitleTracks, audioTracks, resumePosition? }

GET  /api/v1/stream/:sessionId/manifest.m3u8
  - Returns HLS manifest for transcoded streams

GET  /api/v1/stream/:sessionId/segment/:segmentNumber.ts
  - Returns individual HLS segment

GET  /api/v1/stream/:sessionId/subtitles/:trackIndex.vtt
  - Returns WebVTT subtitle track

POST /api/v1/stream/:sessionId/progress
  - Body: { positionSeconds }
  - Updates stream session and watch history

DELETE /api/v1/stream/:sessionId
  - Ends stream, kills FFmpeg process, cleanup

GET  /api/v1/stream/direct/:fileId
  - Direct file serving with range request support
```

---

## 5. Stage 4: Frontend Web UI

### 5.1 Client Package Setup

```
packages/client/
├── src/
│   ├── main.tsx                     # App entry point
│   ├── app.tsx                      # Root component with router
│   ├── components/                  # Reusable UI components
│   │   ├── layout/
│   │   │   ├── AppShell.tsx         # Main layout (nav + content)
│   │   │   ├── Sidebar.tsx          # Side navigation
│   │   │   ├── TopBar.tsx           # Top bar with search + user menu
│   │   │   └── MobileNav.tsx        # Bottom tab bar (mobile)
│   │   ├── movie/
│   │   │   ├── MovieCard.tsx        # Poster card (grid view)
│   │   │   ├── MovieRow.tsx         # List row (table view)
│   │   │   ├── MovieGrid.tsx        # Grid layout of MovieCards
│   │   │   ├── MovieCarousel.tsx    # Horizontal scrolling row
│   │   │   ├── RatingWidget.tsx     # Star/number rating input (decimal support)
│   │   │   ├── GenreTag.tsx         # Clickable genre badge
│   │   │   └── ExternalRatings.tsx  # IMDb/RT/Metacritic badges
│   │   ├── player/
│   │   │   ├── VideoPlayer.tsx      # Main player component
│   │   │   ├── PlayerControls.tsx   # Bottom control bar
│   │   │   ├── QualitySelector.tsx  # Quality dropdown
│   │   │   ├── SubtitleSelector.tsx # Subtitle track dropdown
│   │   │   ├── AudioSelector.tsx    # Audio track dropdown
│   │   │   ├── InfoFlyout.tsx       # Right-side movie info panel
│   │   │   └── SeekBar.tsx          # Progress/seek bar with thumbnails
│   │   ├── common/
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   ├── Tabs.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── Spinner.tsx
│   │   │   ├── Pagination.tsx
│   │   │   ├── SearchInput.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   └── ConfirmDialog.tsx
│   │   └── admin/
│   │       ├── ServerStatus.tsx     # CPU, RAM, disk widgets
│   │       ├── ActiveStreams.tsx     # Active stream list
│   │       └── LogViewer.tsx        # Filterable log viewer
│   ├── pages/
│   │   ├── Dashboard.tsx            # Home page
│   │   ├── Library.tsx              # All movies (grid/list)
│   │   ├── MovieDetail.tsx          # Single movie detail page
│   │   ├── Player.tsx               # Movie player page
│   │   ├── Playlists.tsx            # Playlist list
│   │   ├── PlaylistDetail.tsx       # Single playlist
│   │   ├── Watchlist.tsx            # To-watch list
│   │   ├── History.tsx              # Watch history
│   │   ├── Discover.tsx             # Recommendations/discovery
│   │   ├── Search.tsx               # Search results page
│   │   ├── Settings.tsx             # Settings (tabbed)
│   │   ├── Plugins.tsx              # Plugin management
│   │   ├── AdminDashboard.tsx       # Server admin panel
│   │   ├── Login.tsx                # Login page
│   │   ├── Setup.tsx                # First-run setup wizard
│   │   ├── PersonDetail.tsx         # Actor/director page
│   │   └── NotFound.tsx             # 404 page
│   ├── services/                    # API client layer
│   │   ├── api.ts                   # Base fetch wrapper with auth
│   │   ├── auth.service.ts
│   │   ├── movies.service.ts
│   │   ├── library.service.ts
│   │   ├── stream.service.ts
│   │   ├── playlists.service.ts
│   │   ├── ratings.service.ts
│   │   ├── settings.service.ts
│   │   ├── admin.service.ts
│   │   ├── plugins.service.ts
│   │   └── websocket.service.ts     # WebSocket client wrapper
│   ├── hooks/                       # Custom Preact hooks
│   │   ├── useAuth.ts
│   │   ├── useMovies.ts
│   │   ├── usePlayer.ts
│   │   ├── useWebSocket.ts
│   │   ├── useDebounce.ts
│   │   ├── useInfiniteScroll.ts
│   │   ├── useMediaQuery.ts
│   │   └── useKeyboardShortcuts.ts
│   ├── state/                       # Global state (signals)
│   │   ├── auth.state.ts
│   │   ├── library.state.ts
│   │   ├── player.state.ts
│   │   ├── theme.state.ts
│   │   └── notifications.state.ts
│   ├── styles/                      # Global SASS
│   │   ├── _variables.scss          # Colors, fonts, spacing, breakpoints
│   │   ├── _mixins.scss             # Responsive, typography, layout mixins
│   │   ├── _reset.scss              # CSS reset/normalize
│   │   ├── _animations.scss         # Shared keyframe animations
│   │   ├── _themes.scss             # Dark/light theme variables
│   │   ├── _typography.scss         # Font definitions
│   │   └── global.scss              # Global styles (imports all partials)
│   └── utils/
│       ├── format.ts                # Date, duration, file size formatters
│       ├── url.ts                   # URL construction helpers
│       └── codec-support.ts         # Detect browser codec support
├── public/
│   ├── favicon.ico
│   ├── manifest.json                # PWA manifest
│   └── icons/                       # PWA icons (multiple sizes)
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 5.2 Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@components': resolve(__dirname, 'src/components'),
      '@pages': resolve(__dirname, 'src/pages'),
      '@services': resolve(__dirname, 'src/services'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@state': resolve(__dirname, 'src/state'),
      '@styles': resolve(__dirname, 'src/styles'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@mu/shared': resolve(__dirname, '../shared/src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@styles/variables" as *; @use "@styles/mixins" as *;`,
      },
    },
    modules: {
      localsConvention: 'camelCase',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
```

### 5.3 API Client Layer

```typescript
// services/api.ts
// Base fetch wrapper that:
// 1. Prepends base URL (from env or relative)
// 2. Adds Content-Type: application/json
// 3. Handles 401 -> attempt token refresh -> retry original request
// 4. Handles 403 -> redirect to login
// 5. Parses JSON responses
// 6. Throws typed ApiError on failure
// 7. Supports abort controllers for request cancellation

// Example service:
// services/movies.service.ts
export const moviesService = {
  list: (query: MovieListQuery) => api.get<PaginatedResponse<Movie>>('/movies', query),
  get: (id: string) => api.get<MovieDetail>(`/movies/${id}`),
  search: (q: string) => api.get<Movie[]>('/movies/search', { q }),
  rate: (id: string, rating: number) => api.post(`/movies/${id}/rate`, { rating }),
  markWatched: (id: string) => api.post(`/movies/${id}/watched`),
  markUnwatched: (id: string) => api.delete(`/movies/${id}/watched`),
  bulkAction: (action: string, movieIds: string[]) => api.post('/movies/bulk', { action, movieIds }),
  refreshMetadata: (id: string) => api.post(`/movies/${id}/refresh`),
};
```

### 5.4 SASS Theme System

```scss
// styles/_variables.scss
// Color palette (CSS custom properties for theme switching)
:root {
  // Dark theme (default)
  --color-bg-primary: #0f0f0f;
  --color-bg-secondary: #1a1a2e;
  --color-bg-card: #16213e;
  --color-bg-elevated: #1e2a4a;
  --color-text-primary: #e8e8e8;
  --color-text-secondary: #a0a0b0;
  --color-text-muted: #6c6c7e;
  --color-accent: #e94560;
  --color-accent-hover: #ff6b81;
  --color-success: #2ecc71;
  --color-warning: #f39c12;
  --color-error: #e74c3c;
  --color-border: #2a2a3e;
  --color-overlay: rgba(0, 0, 0, 0.7);

  // Spacing scale
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  // Typography
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.25rem;
  --font-size-xl: 1.5rem;
  --font-size-2xl: 2rem;

  // Borders
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  // Shadows
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.5);

  // Z-index scale
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-player-controls: 600;

  // Layout
  --sidebar-width: 240px;
  --sidebar-collapsed-width: 64px;
  --topbar-height: 56px;
  --player-controls-height: 80px;
}

// Light theme overrides
[data-theme="light"] {
  --color-bg-primary: #f5f5f5;
  --color-bg-secondary: #ffffff;
  --color-bg-card: #ffffff;
  --color-bg-elevated: #f0f0f0;
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #4a4a4a;
  --color-text-muted: #8a8a8a;
  --color-border: #e0e0e0;
  --color-overlay: rgba(0, 0, 0, 0.4);
}

// Breakpoints (for mixins)
$breakpoint-mobile: 768px;
$breakpoint-tablet: 1024px;
$breakpoint-desktop: 1280px;
```

```scss
// styles/_mixins.scss
@mixin mobile {
  @media (max-width: #{$breakpoint-mobile - 1px}) { @content; }
}
@mixin tablet {
  @media (min-width: $breakpoint-mobile) and (max-width: #{$breakpoint-tablet - 1px}) { @content; }
}
@mixin desktop {
  @media (min-width: $breakpoint-tablet) { @content; }
}
@mixin tablet-up {
  @media (min-width: $breakpoint-mobile) { @content; }
}
@mixin truncate($lines: 1) {
  @if $lines == 1 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  } @else {
    display: -webkit-box;
    -webkit-line-clamp: $lines;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}
@mixin card {
  background: var(--color-bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}
@mixin glass {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

### 5.5 Key Component Implementations

#### 5.5.1 VideoPlayer Component

```typescript
// components/player/VideoPlayer.tsx
// Uses hls.js for HLS playback, native <video> for direct play
//
// Props: { sessionId, manifestUrl, mode, subtitles, audioTracks, movieInfo, onClose }
//
// Implementation:
// 1. Create <video> element ref
// 2. If mode is TRANSCODE or DIRECT_STREAM:
//    a. Initialize hls.js: new Hls({ enableWorker: true, startPosition: resumePosition })
//    b. Attach to video element: hls.attachMedia(videoEl)
//    c. Load manifest: hls.loadSource(manifestUrl)
//    d. Handle quality switching via hls.levels
// 3. If mode is DIRECT_PLAY:
//    a. Set video.src directly to file URL
//    b. Set video.currentTime to resumePosition
// 4. Custom controls overlay (PlayerControls component)
// 5. Progress reporting: setInterval every 10s -> POST /stream/:sessionId/progress
// 6. Keyboard shortcuts via useKeyboardShortcuts hook
// 7. Info flyout: toggle InfoFlyout component on 'i' key or button click
// 8. Cleanup on unmount: destroy hls instance, stop progress reporting
```

#### 5.5.2 RatingWidget Component

```typescript
// components/movie/RatingWidget.tsx
// Decimal rating input supporting 0.0 - 10.0
//
// Two modes:
// 1. Display mode: Shows rating as number + filled bar (e.g., "7.3" with colored bar at 73%)
// 2. Edit mode: Click to enter edit, shows number input with 0.1 step
//    - Click increment/decrement buttons
//    - Or type directly
//    - Confirm with Enter or click away
//    - Supports both 5-star (mapped to 0-10 internally) and 10-point display
//
// Color coding: <4 red, 4-6 yellow, 6-8 green, 8+ gold
// Optimistic update: immediately show new rating, revert on API error
```

#### 5.5.3 Settings Page (Tabbed)

```typescript
// pages/Settings.tsx
// Uses Tabs component with these tabs:
//
// Tab: "Profile" - username, email, avatar upload, password change
// Tab: "Playback" - default quality, subtitle/audio language, autoplay, speed
// Tab: "Library" - (admin only) media sources table, scan interval, auto-scan, metadata toggle
// Tab: "Server" - (admin only) host/port, log level, DB type display, cache type, restart button
// Tab: "Ratings" - scale display (5-star vs 10-point), default sort, visible sources checkboxes
// Tab: "API Keys" - TMDB/OMDB/other key inputs with validate button and status indicator
// Tab: "Appearance" - theme toggle, poster size, default view, sidebar default
// Tab: "Notifications" - toggle each notification type
// Tab: "Devices" - table of authenticated devices, revoke button per device
//
// Each tab auto-saves on field change (debounced) with toast confirmation
// Settings read from GET /api/v1/settings on mount
// Individual field changes: PATCH /api/v1/settings with { key: value }
```

### 5.6 Routing

```typescript
// app.tsx
import { Router, Route } from 'preact-router';

export function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppShell>
          <Router>
            <Route path="/" component={Dashboard} />
            <Route path="/library" component={Library} />
            <Route path="/movies/:id" component={MovieDetail} />
            <Route path="/play/:id" component={Player} />
            <Route path="/playlists" component={Playlists} />
            <Route path="/playlists/:id" component={PlaylistDetail} />
            <Route path="/watchlist" component={Watchlist} />
            <Route path="/history" component={History} />
            <Route path="/discover" component={Discover} />
            <Route path="/search" component={Search} />
            <Route path="/person/:id" component={PersonDetail} />
            <Route path="/settings" component={Settings} />
            <Route path="/settings/:tab" component={Settings} />
            <Route path="/plugins" component={Plugins} />
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/login" component={Login} />
            <Route path="/setup" component={Setup} />
            <Route default component={NotFound} />
          </Router>
        </AppShell>
        <ToastContainer />
      </ThemeProvider>
    </AuthProvider>
  );
}
```

### 5.7 WebSocket Client

```typescript
// services/websocket.service.ts
// Singleton WebSocket client that:
// 1. Connects to ws://host:port/ws on app load
// 2. Auto-reconnects with exponential backoff on disconnect
// 3. Sends subscribe/unsubscribe messages for channels
// 4. Dispatches received events to registered handlers
// 5. Provides typed API:
//    ws.subscribe('library:updates', (data) => { ... })
//    ws.unsubscribe('library:updates')
//    ws.send('player:heartbeat', { sessionId, position })
```

---

## 6. Stage 5: Plugin System

### 6.1 Module Structure

```
packages/server/src/plugins/
├── plugin.module.ts                 # NestJS module
├── plugin.controller.ts             # Plugin management endpoints
├── plugin.service.ts                # Plugin lifecycle management
├── plugin-manager.service.ts        # Discovery, loading, activation
├── plugin-context.factory.ts        # Creates PluginContext for each plugin
├── plugin.types.ts                  # Plugin interfaces and types
└── plugin-route.middleware.ts       # Routes requests to plugin handlers

plugins/                             # Built-in plugins (separate from packages/server)
├── tmdb-metadata/
│   ├── plugin.json
│   ├── index.ts
│   └── tmdb.service.ts
├── omdb-ratings/
│   ├── plugin.json
│   ├── index.ts
│   └── omdb.service.ts
├── torrent-search/
│   ├── plugin.json
│   ├── index.ts
│   ├── routes.ts
│   ├── scrapers/
│   │   ├── scraper.interface.ts
│   │   ├── generic.scraper.ts       # HTML scraper for torrent sites
│   │   └── yts.scraper.ts           # YTS API scraper
│   └── ui/
│       └── TorrentPanel.tsx
└── rotten-tomatoes/
    ├── plugin.json
    ├── index.ts
    └── rt.service.ts
```

### 6.2 Plugin Types and Interface

```typescript
// plugin.types.ts

export interface MuPlugin {
  activate(context: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissions: PluginPermission[];
  settings?: PluginSettingDefinition[];
  ui?: {
    movieDetails?: { component: string; position: 'before-actions' | 'after-actions' | 'sidebar' };
    dashboard?: { component: string; position: 'widget' };
    settings?: { component: string };
  };
}

export type PluginPermission = 'network' | 'database' | 'filesystem' | string;

export interface PluginSettingDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  options?: { label: string; value: string }[]; // for 'select' type
  required?: boolean;
}

export interface PluginContext {
  pluginId: string;
  logger: Logger;
  config: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): Promise<void>;
    getAll(): Record<string, unknown>;
  };
  cache: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
  };
  events: {
    on(event: string, handler: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
  };
  http: {
    get<T>(url: string, options?: RequestInit): Promise<T>;
    post<T>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  };
  movies: {
    search(query: string): Promise<Movie[]>;
    getById(id: string): Promise<Movie | null>;
    getMetadata(movieId: string): Promise<MovieMetadata | null>;
    updateMetadata(movieId: string, data: Partial<MovieMetadata>): Promise<void>;
  };
  registerRoute(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, handler: RouteHandler): void;
  registerScheduledTask(intervalMs: number, handler: () => Promise<void>): void;
}
```

### 6.3 Plugin Manager Implementation

```typescript
// plugin-manager.service.ts
//
// onModuleInit():
// 1. Scan plugins directory for subdirectories with plugin.json
// 2. For each found plugin:
//    a. Parse and validate plugin.json against PluginManifest schema
//    b. Check plugins DB table for enabled status
//    c. If enabled:
//       i.  Dynamic import() the entry file
//       ii. Create PluginContext via factory
//       iii. Call plugin.activate(context)
//       iv. Register any routes the plugin added
//       v. Log success
//    d. If disabled: log skip
//    e. On error: log error, mark plugin as errored, continue to next
//
// enablePlugin(pluginId): Load and activate plugin, update DB
// disablePlugin(pluginId): Call deactivate(), remove routes/subscriptions, update DB
// getPluginStatus(): Return list of all plugins with status (enabled, disabled, error)
// getPluginSettings(pluginId): Return plugin's current settings
// updatePluginSettings(pluginId, settings): Validate and update settings in DB
```

### 6.4 Torrent Search Plugin Implementation

```typescript
// plugins/torrent-search/index.ts
export async function activate(ctx: PluginContext): Promise<void> {
  const sites = ctx.config.get<string[]>('sites') || ['https://yts.mx'];

  // Register search endpoint
  ctx.registerRoute('GET', '/search', async (req) => {
    const { query, year } = req.query;
    const results = [];
    for (const site of sites) {
      try {
        const scraper = getScraper(site); // factory based on URL
        const siteResults = await scraper.search(query, year);
        results.push(...siteResults);
      } catch (err) {
        ctx.logger.warn(`Torrent search failed for ${site}: ${err.message}`);
      }
    }
    return results;
  });
}

// scrapers/generic.scraper.ts
// HTML scraper using fetch + cheerio-like parsing (or regex for simple cases)
// Extracts: title, seeders, leechers, size, magnet link, quality
// Each torrent site has slightly different HTML structure
// Configurable selectors per site

// scrapers/yts.scraper.ts
// Uses YTS API (https://yts.mx/api/v2/)
// GET /list_movies.json?query_term={title}&sort_by=seeds
// Returns structured JSON with torrent URLs and magnet links
```

### 6.5 Frontend Plugin Integration

```typescript
// Plugin slots in the frontend are designated areas where plugin UI can be injected
// Implementation approach:
//
// 1. Server exposes GET /api/v1/plugins/ui-manifest
//    Returns: { movieDetails: [{ pluginId, componentUrl }], dashboard: [...] }
//
// 2. Frontend PluginSlot component:
//    <PluginSlot location="movie-details:after-actions" movieId={movie.id} />
//
// 3. PluginSlot renders:
//    a. Fetch active plugin UI components for this slot
//    b. For each: create an <iframe sandbox> pointing to /api/v1/plugins/{id}/ui/{component}
//       OR use dynamic import() if plugin UI is a Preact component served as ESM
//    c. Pass data to plugin UI via postMessage (iframe) or props (dynamic import)
//
// Recommended approach: Serve plugin UI as standalone Preact components bundled as ESM.
// The main app dynamically imports them. Plugin UI components receive a standard props interface.
// This avoids iframe overhead and allows seamless integration.
```

---

## 7. Stage 6: Recommendations & Discovery

### 7.1 Module Structure

```
packages/server/src/recommendations/
├── recommendations.module.ts
├── recommendations.controller.ts
├── recommendations.service.ts
├── engines/
│   ├── recommendation-engine.interface.ts
│   ├── metadata-engine.ts           # Content-based filtering via metadata
│   └── tmdb-engine.ts               # TMDB similar/recommendations API
├── taste-profile.service.ts         # Build user taste profile from ratings
└── dto/
    ├── recommendation-query.dto.ts
    └── recommendation-result.dto.ts
```

### 7.2 Metadata-Based Engine

```typescript
// engines/metadata-engine.ts
//
// findSimilar(movieId, limit=20):
//   1. Get target movie's metadata (genres, directors, cast, keywords, year)
//   2. Query all other movies in library with their metadata
//   3. Score each movie against target using weighted formula:
//      - Genre overlap: count shared genres / total unique genres * 0.30
//      - Director match: any shared director = 1.0 * 0.15
//      - Cast overlap: count shared cast / min(cast1.len, cast2.len) * 0.20
//      - Keyword overlap: count shared keywords / total unique keywords * 0.20
//      - Year proximity: 1 - (|year1 - year2| / 50) clamped to [0,1] * 0.10
//      - Rating proximity: 1 - (|rating1 - rating2| / 10) * 0.05
//   4. Sort by score descending, return top N
//
// recommendForUser(userId, excludeWatched=true, genre?, limit=20):
//   1. Build taste profile (taste-profile.service.ts)
//   2. Get user's top-rated movies (rating >= 7.0)
//   3. For each top movie, find similar movies using findSimilar()
//   4. Aggregate scores (movie appearing similar to multiple favorites = higher score)
//   5. If excludeWatched: filter out movies in user's watch history
//   6. Optional genre filter
//   7. Return top N with explanation strings
```

### 7.3 Taste Profile Service

```typescript
// taste-profile.service.ts
//
// buildProfile(userId):
//   1. Fetch all user ratings
//   2. Weight genres by rating (if user rates action movies highly, action gets high weight)
//   3. Aggregate: preferred genres (weighted), preferred directors, preferred decades, avg rating
//   4. Return TasteProfile object
//   5. Cache result with 6-hour TTL, invalidate on new rating
//
// interface TasteProfile {
//   preferredGenres: { genre: string; weight: number }[];
//   preferredDirectors: string[];
//   preferredDecades: { decade: string; weight: number }[];
//   averageRating: number;
//   totalRated: number;
// }
```

### 7.4 Discovery Controller

```
GET  /api/v1/recommendations
  - Query: genre?, excludeWatched?, limit?
  - Returns personalized recommendations based on taste profile

GET  /api/v1/recommendations/similar/:movieId
  - Returns movies similar to the given movie

POST /api/v1/recommendations/based-on
  - Body: { movieIds: string[] }
  - Returns recommendations based on a subset of movies

GET  /api/v1/recommendations/discover
  - Query: genre?, yearFrom?, yearTo?, minRating?, limit?
  - Returns movies NOT in the user's library (discovery)
  - Uses TMDB discover/search endpoints + taste profile scoring

GET  /api/v1/genres
  - Returns all genres with movie counts

GET  /api/v1/persons/:id
  - Returns person details + filmography (from TMDB + local library)

GET  /api/v1/persons/search?q=...
  - Search actors/directors
```

---

## 8. Stage 7: Mobile Experience & PWA

### 8.1 PWA Setup

```json
// public/manifest.json
{
  "name": "Mu - Movie Platform",
  "short_name": "Mu",
  "description": "Self-hosted movie streaming and management",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#e94560",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 8.2 Service Worker

```typescript
// Service worker (generated by vite-plugin-pwa or workbox):
// - Precache: app shell (HTML, CSS, JS bundles)
// - Runtime cache strategy:
//   - API responses (/api/v1/movies/*): StaleWhileRevalidate (show cached, update in background)
//   - Images (/api/v1/images/*): CacheFirst (images rarely change)
//   - Streaming (/api/v1/stream/*): NetworkOnly (never cache video segments)
// - Background sync: Queue rating/watchlist changes made offline, sync when back online
// - Push notifications: Receive push events for scan completion, new movies
```

### 8.3 Mobile-Specific Components

```typescript
// MobileNav component: Bottom tab bar with 5 tabs
// - Home, Library, Search (icon button opens search overlay), Playlists, Profile
// - Shows on mobile breakpoint, hidden on tablet+
// - Active tab highlighted with accent color
// - Uses preact-router for navigation

// MobileRater page:
// - Full-screen card interface showing one unrated movie at a time
// - Swipe right: opens number input for rating (0.0-10.0)
// - Swipe left: skip to next (or "Not Interested")
// - Tap card: see movie details (overlay)
// - Progress bar at top: "12 / 45 unrated"
// - Implementation: Touch event handlers for swipe detection,
//   CSS transforms for card animation
```

### 8.4 Mobile Player Gestures

```typescript
// Gesture handling in VideoPlayer for mobile:
// - Track touch start position and current position
// - Left half vertical swipe: brightness (CSS filter on video element)
// - Right half vertical swipe: volume (video.volume)
// - Double tap left third: seek -10s
// - Double tap right third: seek +10s
// - Horizontal swipe: show seek preview, commit on release
// - Single tap center: toggle controls visibility
// - Implementation: touchstart/touchmove/touchend event handlers
//   with thresholds to distinguish taps from swipes
```

---

## 9. Stage 8: MCP Server & Embeddings

### 9.1 Embedding System

```
packages/server/src/embeddings/
├── embeddings.module.ts
├── embeddings.service.ts            # Generate and store embeddings
├── similarity.service.ts            # Cosine similarity computations
├── providers/
│   ├── embedding-provider.interface.ts
│   ├── local.provider.ts            # @xenova/transformers (all-MiniLM-L6-v2)
│   └── openai.provider.ts           # OpenAI embeddings API (optional)
└── vector-store.service.ts          # Store/query embeddings (SQLite or vectra)
```

```typescript
// embeddings.service.ts
//
// generateEmbedding(movieId):
//   1. Fetch movie + metadata
//   2. Compose text document:
//      "{title} ({year}). {overview}. Genres: {genres.join(', ')}.
//       Director: {directors.join(', ')}. Starring: {cast.map(c=>c.name).join(', ')}.
//       Keywords: {keywords.join(', ')}."
//   3. Run through embedding model -> get float[] vector (384 dimensions for MiniLM)
//   4. Store in movie_embeddings table (BLOB: Float32Array buffer)
//   5. Return embedding
//
// generateAllEmbeddings():
//   - Batch process all movies without embeddings
//   - Run in worker thread to avoid blocking
//   - Progress reporting via WebSocket
//
// findSimilarByEmbedding(movieId, limit=20):
//   1. Get target movie's embedding
//   2. Load all embeddings from DB
//   3. Compute cosine similarity against each
//   4. Sort by similarity descending
//   5. Return top N (with similarity scores)
//
// buildTasteVector(userId):
//   1. Get user's top-rated movies (rating >= 7)
//   2. Get their embeddings
//   3. Average all embedding vectors -> taste vector
//   4. Cache result
```

### 9.2 MCP Server

```
packages/mcp/
├── src/
│   ├── index.ts                     # MCP server entry
│   ├── tools/
│   │   ├── search-movies.ts
│   │   ├── get-movie.ts
│   │   ├── get-recommendations.ts
│   │   ├── rate-movie.ts
│   │   ├── find-similar.ts
│   │   ├── get-user-stats.ts
│   │   └── add-to-watchlist.ts
│   └── mu-client.ts                 # HTTP client to Mu API
├── package.json
└── tsconfig.json
```

```typescript
// MCP server implementation using @modelcontextprotocol/sdk
// Runs as a separate process, communicates via stdio
// Connects to Mu server's API for all data operations
//
// Tools exposed:
// search_movies: { query: string, genre?: string, year?: number } -> Movie[]
// get_movie: { id: string } -> MovieDetail
// get_recommendations: { movie_id?: string, genre?: string, exclude_watched?: boolean } -> Movie[]
// rate_movie: { id: string, rating: number } -> void
// find_similar: { movie_id: string, limit?: number } -> Movie[]
// get_user_stats: {} -> { totalMovies, totalWatched, avgRating, topGenres, recentlyWatched }
// add_to_watchlist: { movie_id: string } -> void
```

---

## 10. Stage 9: Install System & Distribution

### 10.1 Install Script

```bash
#!/usr/bin/env bash
# scripts/install.sh
# Usage: curl -fsSL https://get.mu.app/install | bash

set -euo pipefail

MU_VERSION="${MU_VERSION:-latest}"
MU_INSTALL_DIR="${MU_INSTALL_DIR:-$HOME/.mu}"
MU_DATA_DIR="${MU_DATA_DIR:-$MU_INSTALL_DIR/data}"

# 1. Detect OS and architecture
detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
  esac
}

# 2. Check/install Node.js 20+
ensure_node() {
  if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 20 ]; then return; fi
  fi
  echo "Installing Node.js 20..."
  # Use NodeSource or nvm
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

# 3. Check FFmpeg
ensure_ffmpeg() {
  if command -v ffmpeg &>/dev/null; then return; fi
  echo "Installing FFmpeg..."
  case "$OS" in
    linux)
      if command -v apt-get &>/dev/null; then sudo apt-get install -y ffmpeg
      elif command -v dnf &>/dev/null; then sudo dnf install -y ffmpeg
      elif command -v pacman &>/dev/null; then sudo pacman -S --noconfirm ffmpeg
      fi ;;
    darwin) brew install ffmpeg ;;
  esac
}

# 4. Download and install Mu
install_mu() {
  mkdir -p "$MU_INSTALL_DIR"
  # Download release tarball
  # Extract to install dir
  # Run pnpm install --production
  # Generate default config with random secrets
  # Create data directories
}

# 5. Create systemd service (Linux)
create_service() {
  if [ "$OS" = "linux" ] && command -v systemctl &>/dev/null; then
    sudo tee /etc/systemd/system/mu.service > /dev/null <<EOF
[Unit]
Description=Mu Movie Platform
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$MU_INSTALL_DIR
ExecStart=$(which node) $MU_INSTALL_DIR/packages/server/dist/main.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=MU_DATA_DIR=$MU_DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable mu
    sudo systemctl start mu
  fi
}

# Main
detect_platform
ensure_node
ensure_ffmpeg
install_mu
create_service

echo ""
echo "Mu installed successfully!"
echo "Access the server at: http://localhost:8080"
echo "Complete setup at: http://localhost:8080/setup"
```

### 10.2 Docker

```dockerfile
# docker/Dockerfile
# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
COPY plugins plugins

RUN pnpm run build

# Stage 2: Production
FROM node:20-slim AS production
WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
RUN corepack enable pnpm

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/client/dist packages/client/dist
COPY --from=builder /app/plugins plugins

RUN pnpm install --frozen-lockfile --prod

EXPOSE 8080
VOLUME ["/app/data", "/media"]

ENV NODE_ENV=production
ENV MU_DATA_DIR=/app/data

CMD ["node", "packages/server/dist/main.js"]
```

```yaml
# docker/docker-compose.yml
services:
  mu:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - mu-data:/app/data
      - /path/to/your/movies:/media/movies:ro
    environment:
      - MU_AUTH_JWT_SECRET=change-me-to-random-64-char-string
      - MU_AUTH_COOKIE_SECRET=change-me-to-random-64-char-string
      - MU_THIRD_PARTY_TMDB_API_KEY=your_tmdb_key
    restart: unless-stopped

volumes:
  mu-data:
```

### 10.3 CLI Tool

```typescript
// packages/cli/src/index.ts
// Simple CLI using commander.js or yargs
// Commands:
//   mu start     - Start server (foreground or daemonized)
//   mu stop      - Stop running server (send SIGTERM)
//   mu restart   - Stop + start
//   mu status    - Show if running, PID, uptime, port
//   mu config    - Print current config or open in $EDITOR
//   mu scan      - Trigger library scan via API call
//   mu users     - List users / create user / delete user
//   mu logs      - Tail server logs (pino log file)
//   mu update    - Check for updates, download, replace, restart
//   mu backup    - Copy database file + config to backup dir
//   mu restore   - Restore from backup
//   mu version   - Print version
//   mu uninstall - Stop service, remove service file, optionally remove data
```

---

## 11. Environment Variables Reference

All environment variables are prefixed with `MU_` and map to config.yml paths using `__` as the path separator (e.g., `MU_SERVER_PORT` maps to `server.port`).

| Variable | Config Path | Default | Description |
|----------|-------------|---------|-------------|
| `MU_SERVER_HOST` | `server.host` | `0.0.0.0` | Server bind address |
| `MU_SERVER_PORT` | `server.port` | `8080` | Server port |
| `MU_SERVER_LOG_LEVEL` | `server.logLevel` | `info` | Log level (fatal/error/warn/info/debug/trace) |
| `MU_SERVER_CORS_ORIGINS` | `server.corsOrigins` | `true` | CORS allowed origins (comma-separated or `true` for all) |
| `MU_DATABASE_TYPE` | `database.type` | `sqlite` | Database engine (`sqlite` or `postgres`) |
| `MU_DATABASE_SQLITE_PATH` | `database.sqlitePath` | `./data/db/mu.db` | SQLite file path |
| `MU_DATABASE_POSTGRES_URL` | `database.postgresUrl` | - | PostgreSQL connection URL |
| `MU_CACHE_TYPE` | `cache.type` | `memory` | Cache backend (`memory` or `redis`) |
| `MU_CACHE_REDIS_URL` | `cache.redisUrl` | - | Redis connection URL |
| `MU_CACHE_MAX_ENTRIES` | `cache.maxEntries` | `10000` | Max in-memory cache entries |
| `MU_AUTH_JWT_SECRET` | `auth.jwtSecret` | *(auto-generated)* | JWT signing secret (min 32 chars) |
| `MU_AUTH_COOKIE_SECRET` | `auth.cookieSecret` | *(auto-generated)* | Cookie signing secret (min 32 chars) |
| `MU_AUTH_LOCAL_BYPASS` | `auth.localBypass` | `true` | Skip auth for localhost requests |
| `MU_AUTH_ACCESS_TOKEN_EXPIRY` | `auth.accessTokenExpiry` | `15m` | Access token TTL |
| `MU_AUTH_REFRESH_TOKEN_EXPIRY` | `auth.refreshTokenExpiry` | `30d` | Refresh token TTL |
| `MU_MEDIA_SCAN_ON_STARTUP` | `media.scanOnStartup` | `true` | Scan media dirs on server start |
| `MU_MEDIA_AUTO_FETCH_METADATA` | `media.autoFetchMetadata` | `true` | Auto-fetch metadata for new movies |
| `MU_TRANSCODING_HW_ACCEL` | `transcoding.hwAccel` | `none` | Hardware acceleration (none/vaapi/nvenc/qsv) |
| `MU_TRANSCODING_MAX_CONCURRENT` | `transcoding.maxConcurrent` | `2` | Max simultaneous transcoding streams |
| `MU_TRANSCODING_DEFAULT_QUALITY` | `transcoding.defaultQuality` | `1080p` | Default streaming quality |
| `MU_TRANSCODING_TEMP_DIR` | `transcoding.tempDir` | `./data/cache/streams` | Temp directory for HLS segments |
| `MU_THIRD_PARTY_TMDB_API_KEY` | `thirdParty.tmdbApiKey` | - | TMDB API key |
| `MU_THIRD_PARTY_OMDB_API_KEY` | `thirdParty.omdbApiKey` | - | OMDB API key |
| `MU_RATINGS_SCALE` | `ratings.scale` | `10-point` | Rating display scale (`5-star` or `10-point`) |
| `MU_RATINGS_DEFAULT_SORT` | `ratings.defaultSort` | `internal` | Default rating sort source |
| `MU_PLUGINS_DIRECTORY` | `plugins.directory` | `./plugins` | Plugin directory path |
| `MU_DATA_DIR` | `dataDir` | `./data` | Base data directory |
| `NODE_ENV` | - | `development` | Node.js environment |

---

## 12. Configuration File Reference

**`data/config/config.yml`** (auto-generated on first run):

```yaml
# Mu Configuration
# Documentation: https://mu.app/docs/configuration

server:
  host: "0.0.0.0"
  port: 8080
  logLevel: "info"
  corsOrigins: true

database:
  type: "sqlite"
  sqlitePath: "./data/db/mu.db"
  # postgresUrl: "postgresql://user:pass@localhost:5432/mu"

cache:
  type: "memory"
  # redisUrl: "redis://localhost:6379"
  maxEntries: 10000
  defaultTtlSeconds: 3600

auth:
  jwtSecret: "<auto-generated-64-char-hex>"
  cookieSecret: "<auto-generated-64-char-hex>"
  localBypass: true
  accessTokenExpiry: "15m"
  refreshTokenExpiry: "30d"

media:
  directories: []
  # - path: "/mnt/movies"
  #   label: "Main Library"
  #   scanIntervalHours: 6
  #   enabled: true
  supportedExtensions:
    - ".mp4"
    - ".mkv"
    - ".avi"
    - ".mov"
    - ".wmv"
    - ".flv"
    - ".webm"
    - ".m4v"
    - ".ts"
  scanOnStartup: true
  autoFetchMetadata: true

transcoding:
  hwAccel: "none"  # none | vaapi | nvenc | qsv
  maxConcurrent: 2
  tempDir: "./data/cache/streams"
  defaultQuality: "1080p"
  profiles:
    480p:
      videoBitrate: "1M"
      audioBitrate: "128k"
    720p:
      videoBitrate: "2.5M"
      audioBitrate: "192k"
    1080p:
      videoBitrate: "5M"
      audioBitrate: "256k"
    4k:
      videoBitrate: "15M"
      audioBitrate: "320k"

thirdParty:
  # tmdbApiKey: "your-tmdb-api-key"
  # omdbApiKey: "your-omdb-api-key"

ratings:
  scale: "10-point"  # 5-star | 10-point
  defaultSort: "internal"
  showSources:
    - "internal"
    - "imdb"

plugins:
  enabled: []
  directory: "./plugins"

dataDir: "./data"
```

---

## Implementation Order Summary

Within each stage, implement in this order:

**Stage 1** (Foundation):
1. Monorepo scaffold + shared types
2. NestJS server bootstrap + config system
3. Database module + Drizzle schemas + migrations
4. Cache module (memory provider)
5. Auth module (JWT + local bypass)
6. Users module (CRUD)
7. WebSocket gateway
8. Scheduler module
9. Health check

**Stage 2** (Library):
1. Media source management (CRUD)
2. File scanner (worker thread + ffprobe)
3. Filename parser
4. Movie service (CRUD, search)
5. Metadata providers (TMDB, OMDB)
6. Metadata service (orchestration + pipeline)
7. Image service (download, cache, proxy)
8. File watcher (chokidar)
9. Ratings, watchlist, history services
10. Playlists service

**Stage 3** (Streaming):
1. Codec support detection
2. Direct play (range request handler)
3. Direct stream (remux service)
4. HLS transcoder (FFmpeg + manifest gen)
5. Stream session management
6. Subtitle extraction + serving
7. Audio track handling

**Stage 4** (Frontend):
1. Vite + Preact scaffold + SASS system
2. API client layer + WebSocket client
3. Auth state + login/setup pages
4. App shell (layout, sidebar, topbar)
5. Dashboard page
6. Library page (grid/list, sort, filter, bulk actions)
7. Movie detail page
8. Player page (hls.js + custom controls + info flyout)
9. Playlists, Watchlist, History pages
10. Search page
11. Settings page (all tabs)
12. Admin dashboard
13. Responsive/mobile layout adjustments

**Stage 5** (Plugins):
1. Plugin types + interfaces
2. Plugin manager (discovery, loading, lifecycle)
3. Plugin context factory
4. Plugin controller (enable/disable/settings)
5. TMDB metadata plugin
6. OMDB ratings plugin
7. Torrent search plugin
8. Rotten Tomatoes plugin
9. Frontend plugin slots + Plugins page

**Stage 6** (Recommendations):
1. Taste profile service
2. Metadata-based recommendation engine
3. TMDB-based recommendations
4. Recommendation controller + endpoints
5. Discover page frontend
6. Person detail page
7. Genre browsing

**Stage 7** (Mobile/PWA):
1. PWA manifest + service worker
2. Mobile navigation (bottom tabs)
3. Mobile player gestures
4. Mobile rater page
5. Offline caching strategy

**Stage 8** (MCP/Embeddings):
1. Embedding provider (local model)
2. Embedding service (generate + store)
3. Vector similarity service
4. Embedding-based recommendations
5. MCP server package
6. MCP tools implementation

**Stage 9** (Install/Distribution):
1. Install script (bash)
2. CLI tool
3. Dockerfile + docker-compose
4. Systemd service file
5. Auto-update system
