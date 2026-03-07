export const DEFAULT_PORT = 8080;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
export const JWT_ACCESS_EXPIRY = '15m';
export const JWT_REFRESH_EXPIRY = '30d';

export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.wmv',
  '.flv', '.webm', '.m4v', '.ts', '.m2ts',
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

export const CACHE_TTL = {
  METADATA: 7 * 24 * 60 * 60,       // 7 days
  SEARCH: 60 * 60,                    // 1 hour
  API_RATE_LIMIT: 60,                 // 1 minute
  POSTER: 30 * 24 * 60 * 60,         // 30 days
  RECOMMENDATIONS: 6 * 60 * 60,      // 6 hours
} as const;

export const TRANSCODING_PROFILES = {
  '480p': { videoBitrate: '1M', audioBitrate: '128k', width: 854, height: 480 },
  '720p': { videoBitrate: '2.5M', audioBitrate: '192k', width: 1280, height: 720 },
  '1080p': { videoBitrate: '5M', audioBitrate: '256k', width: 1920, height: 1080 },
  '4k': { videoBitrate: '15M', audioBitrate: '320k', width: 3840, height: 2160 },
} as const;

export const RATING_MIN = 0;
export const RATING_MAX = 10;
export const RATING_STEP = 0.1;
