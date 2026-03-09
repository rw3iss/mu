import { z } from 'zod';

export const configSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.coerce.number().int().min(1).max(65535).default(4000),
    cors: z.object({
      origin: z.union([z.string(), z.array(z.string()), z.boolean()]).default(true),
      credentials: z.boolean().default(true),
    }).default({}),
    rateLimit: z.object({
      max: z.coerce.number().int().positive().default(100),
      windowMs: z.coerce.number().int().positive().default(60_000),
    }).default({}),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }).default({}),

  database: z.object({
    path: z.string().default('./data/db/mu.db'),
    walMode: z.boolean().default(true),
    busyTimeout: z.coerce.number().int().nonnegative().default(5000),
  }).default({}),

  cache: z.object({
    maxSize: z.coerce.number().int().positive().default(500),
    ttlSeconds: z.coerce.number().int().positive().default(3600),
    imageDir: z.string().default('./data/cache/images'),
    streamDir: z.string().default('./data/cache/streams'),
    persistTranscodes: z.boolean().default(true),
  }).default({}),

  auth: z.object({
    jwtSecret: z.string().min(32),
    jwtExpiresIn: z.string().default('7d'),
    cookieSecret: z.string().min(32),
    cookieMaxAgeMs: z.coerce.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
    bcryptRounds: z.coerce.number().int().min(4).max(31).default(12),
    allowRegistration: z.boolean().default(true),
  }),

  media: z.object({
    libraryPaths: z.array(z.string()).default([]),
    scanIntervalMinutes: z.coerce.number().int().positive().default(60),
    thumbnailDir: z.string().default('./data/thumbnails'),
    thumbnailWidth: z.coerce.number().int().positive().default(640),
    thumbnailHeight: z.coerce.number().int().positive().default(360),
    supportedExtensions: z.array(z.string()).default([
      '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts',
    ]),
    watchForChanges: z.boolean().default(true),
  }).default({}),

  transcoding: z.object({
    enabled: z.boolean().default(true),
    ffmpegPath: z.string().default('ffmpeg'),
    ffprobePath: z.string().default('ffprobe'),
    hwAccel: z.enum(['none', 'vaapi', 'nvenc', 'qsv', 'videotoolbox']).default('none'),
    maxConcurrentJobs: z.coerce.number().int().positive().default(2),
    defaultVideoCodec: z.string().default('libx264'),
    defaultAudioCodec: z.string().default('aac'),
    presets: z.record(z.string(), z.object({
      videoCodec: z.string().optional(),
      audioCodec: z.string().optional(),
      videoBitrate: z.string().optional(),
      audioBitrate: z.string().optional(),
      resolution: z.string().optional(),
    })).default({
      '720p': { videoBitrate: '2500k', audioBitrate: '128k', resolution: '1280x720' },
      '1080p': { videoBitrate: '5000k', audioBitrate: '192k', resolution: '1920x1080' },
    }),
  }).default({}),

  thirdParty: z.object({
    tmdb: z.object({
      apiKey: z.string().default(''),
      baseUrl: z.string().url().default('https://api.themoviedb.org/3'),
      language: z.string().default('en-US'),
    }).default({}),
    omdb: z.object({
      apiKey: z.string().default(''),
      baseUrl: z.string().url().default('https://www.omdbapi.com'),
    }).default({}),
  }).default({}),

  ratings: z.object({
    enabled: z.boolean().default(true),
    allowPublicAccess: z.boolean().default(false),
    maxRating: z.coerce.number().int().positive().default(10),
  }).default({}),

  plugins: z.object({
    enabled: z.boolean().default(false),
    directory: z.string().default('./plugins'),
    allowedPlugins: z.array(z.string()).default([]),
  }).default({}),

  dataDir: z.string().default('./data'),
});
