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

/**
 * Library content types a movie / group can be classified as. Used by the
 * Library type-filter dropdown and the `type` query param.
 *  - `movie`      — standalone film (no group)
 *  - `series`     — member/stack of a TV series group (series/show/tv/season)
 *  - `collection` — member/stack of a collection group (collection/trilogy/saga/franchise)
 */
export type LibraryContentType = 'movie' | 'series' | 'collection';

export const LIBRARY_CONTENT_TYPES: readonly LibraryContentType[] = [
	'movie',
	'series',
	'collection',
];

/** Group `groupType` values classified as collections; everything else is a series. */
export const COLLECTION_GROUP_TYPES: ReadonlySet<string> = new Set([
	'collection',
	'trilogy',
	'saga',
	'franchise',
]);

/** Classify a group's `groupType` hint into a {@link LibraryContentType}. */
export function classifyGroupType(groupType: string | null | undefined): 'series' | 'collection' {
	return groupType && COLLECTION_GROUP_TYPES.has(groupType.toLowerCase())
		? 'collection'
		: 'series';
}

export interface MovieListQuery extends PaginationQuery {
	search?: string;
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	ratingFrom?: number;
	ratingTo?: number;
	/** Minimum external (IMDb) rating, 0–10. */
	minRating?: number;
	/** Minimum external (IMDb) vote count. */
	minVotes?: number;
	/** Runtime bounds in minutes. */
	minRuntime?: number;
	maxRuntime?: number;
	resolution?: string;
	watched?: boolean;
	hideWatched?: boolean;
	watchedOnly?: boolean;
	hasSubtitles?: boolean;
	showHidden?: boolean;
	/**
	 * Comma-separated {@link LibraryContentType} list to restrict results to
	 * (e.g. `movie,series`). Omitted/empty = all types. Only meaningful for the
	 * interleaved Library view (`interleaveGroups=true`).
	 */
	type?: string;
	/** Filter by media server: 'local', 'all', or a specific remote server ID */
	server?: string;
}

export interface StreamStartResponse {
	sessionId: string;
	manifestUrl?: string;
	directUrl?: string;
	mode: 'direct_play' | 'direct_stream' | 'transcode';
	subtitleTracks: import('./movie.js').SubtitleTrack[];
	audioTracks: import('./movie.js').AudioTrack[];
	durationSeconds: number;
	resumePosition?: number;
}

export interface StreamProgressUpdate {
	positionSeconds: number;
}

export interface RecommendationQuery {
	basedOn?: string[];
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	minRating?: number;
	excludeWatched?: boolean;
	limit?: number;
}

export interface RecommendationResult {
	movie: import('./movie.js').Movie;
	score: number;
	reason?: string;
	inLibrary: boolean;
}

export interface ServerStatus {
	uptime: number;
	version: string;
	nodeVersion: string;
	platform: string;
	cpuUsage: number;
	memoryUsage: { used: number; total: number; percentage: number };
	diskUsage: { used: number; total: number; percentage: number };
	activeStreams: number;
	totalMovies: number;
	totalUsers: number;
}

export interface ScanLogEntry {
	id: string;
	sourceId: string;
	startedAt: string;
	completedAt?: string;
	status: 'running' | 'completed' | 'failed';
	filesFound: number;
	filesAdded: number;
	filesUpdated: number;
	filesRemoved: number;
	errors: string[];
}

export interface BulkActionRequest {
	action: 'mark_watched' | 'mark_unwatched' | 'add_to_playlist' | 'refresh_metadata' | 'delete';
	movieIds: string[];
	playlistId?: string;
}
