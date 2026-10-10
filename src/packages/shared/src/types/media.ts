/**
 * Media kinds and polymorphic entity references — the seam that lets movies
 * and music share ratings, comments, favorites, playlists, history, queue and
 * search without either feature knowing about the other.
 * See docs/music-support-plan.md §3.
 */

/** What a playable file is. Drives importer, stream adapter and player adapter. */
export type MediaKind = 'video' | 'audio';

/** Anything a user can rate, comment on, favorite, queue or put in a playlist. */
export type EntityType = 'movie' | 'person' | 'artist' | 'album' | 'track';

export interface EntityRef {
	type: EntityType;
	id: string;
}

export const ENTITY_TYPES: readonly EntityType[] = ['movie', 'person', 'artist', 'album', 'track'];

export function isEntityType(v: unknown): v is EntityType {
	return typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v);
}

/** Which media kind an entity plays as (null = not directly playable). */
export function entityMediaKind(type: EntityType): MediaKind | null {
	if (type === 'movie') return 'video';
	if (type === 'track' || type === 'album' || type === 'artist') return 'audio';
	return null;
}

/** Top-level product features. Either can be disabled independently. */
export type FeatureName = 'movies' | 'music';

export interface FeatureFlags {
	movies: boolean;
	music: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = { movies: true, music: false };

/** UI browse mode (header Movies | Music toggle). */
export type BrowseMode = 'movies' | 'music';

/** Supported audio file extensions (lower-case, no dot). */
export const SUPPORTED_AUDIO_EXTENSIONS = [
	'mp3',
	'flac',
	'm4a',
	'aac',
	'alac',
	'ogg',
	'oga',
	'opus',
	'wav',
	'aiff',
	'aif',
	'wma',
	'ape',
	'wv',
	'dsf',
	'dff',
] as const;
