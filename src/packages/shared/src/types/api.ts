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
