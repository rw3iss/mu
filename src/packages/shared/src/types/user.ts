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

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  language: 'en',
  defaultQuality: '1080p',
  autoplayNext: true,
  posterSize: 'medium',
  defaultView: 'grid',
  sidebarCollapsed: false,
  ratingDisplay: '10-point',
  ratingSource: 'internal',
};

export interface UserRating {
  id: string;
  userId: string;
  movieId: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

export interface WatchHistoryEntry {
  id: string;
  userId: string;
  movieId: string;
  watchedAt: string;
  durationWatchedSeconds: number;
  completed: boolean;
  positionSeconds: number;
}

export interface WatchlistEntry {
  id: string;
  userId: string;
  movieId: string;
  addedAt: string;
  notes?: string;
}

export interface Playlist {
  id: string;
  userId: string;
  name: string;
  description?: string;
  coverUrl?: string;
  isSmart: boolean;
  smartRules?: SmartPlaylistRules;
  movieCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmartPlaylistRules {
  genres?: string[];
  yearFrom?: number;
  yearTo?: number;
  ratingFrom?: number;
  ratingTo?: number;
  watched?: boolean;
}

export interface PlaylistMovie {
  id: string;
  playlistId: string;
  movieId: string;
  position: number;
  addedAt: string;
}

export interface Device {
  id: string;
  userId: string;
  name?: string;
  deviceType: string;
  ipAddress?: string;
  userAgent?: string;
  lastActiveAt: string;
  createdAt: string;
}
