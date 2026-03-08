export interface TranscodingProfile {
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
  preset: string;
}

export const TRANSCODING_PROFILES: Record<string, TranscodingProfile> = {
  '480p': {
    width: 854,
    height: 480,
    videoBitrate: '1M',
    audioBitrate: '128k',
    preset: 'veryfast',
  },
  '720p': {
    width: 1280,
    height: 720,
    videoBitrate: '2.5M',
    audioBitrate: '192k',
    preset: 'veryfast',
  },
  '1080p': {
    width: 1920,
    height: 1080,
    videoBitrate: '5M',
    audioBitrate: '256k',
    preset: 'veryfast',
  },
  '4k': {
    width: 3840,
    height: 2160,
    videoBitrate: '15M',
    audioBitrate: '320k',
    preset: 'fast',
  },
};
