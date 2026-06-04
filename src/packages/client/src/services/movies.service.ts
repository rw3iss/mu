import type { Movie } from '@/state/library.state';
import { api } from './api';
import type { MovieGroup } from './groups.service';

// ============================================
// Types
// ============================================

export interface MovieListResponse {
	movies: Movie[];
	/** Group "stacks" interleaved into this page (only when interleaveGroups=true). */
	groups?: MovieGroup[];
	total: number;
	hiddenCount?: number;
	watchedCount?: number;
	page: number;
	pageSize: number;
}

export interface MatchCandidate {
	id: string;
	entityType: 'movie' | 'group';
	entityId: string;
	provider: string;
	externalId: string;
	title: string;
	year: number | null;
	runtimeMinutes: number | null;
	posterUrl: string | null;
	overview: string | null;
	confidence: number;
	rank: number;
	isBest: boolean;
	createdAt: string;
}

export interface MovieFile {
	id: string;
	filename: string;
	path: string;
	size: number;
	format: string;
	videoCodec: string;
	audioCodec: string;
	resolution: string;
	bitrate: number;
	duration: number;
}

// ============================================
// Movies Service
// ============================================

export const moviesService = {
	/**
	 * List movies with pagination and filtering
	 */
	list(params?: Record<string, string>): Promise<MovieListResponse> {
		return api.get<MovieListResponse>('/movies', params);
	},

	/**
	 * Get a single movie by ID.
	 * Remote movies are fetched via the proxy endpoint.
	 */
	get(id: string): Promise<Movie> {
		if (id.startsWith('remote:')) {
			const parts = id.split(':');
			if (parts.length >= 3) {
				const serverId = parts[1]!;
				const remoteMovieId = parts.slice(2).join(':');
				return api.get<Movie>(`/remote/movies/${serverId}/${remoteMovieId}`);
			}
		}
		return api.get<Movie>(`/movies/${id}`);
	},

	/**
	 * Search movies by query string
	 */
	search(query: string, params?: Record<string, string>): Promise<MovieListResponse> {
		return api.get<MovieListResponse>('/movies/search', { q: query, ...params });
	},

	/**
	 * Get files associated with a movie
	 */
	getFiles(movieId: string): Promise<MovieFile[]> {
		return api.get<MovieFile[]>(`/movies/${movieId}/files`);
	},

	/**
	 * Trigger a metadata refresh for a movie
	 */
	refreshMetadata(movieId: string): Promise<void> {
		return api.post<void>(`/movies/${movieId}/refresh`);
	},

	clearMetadata(movieId: string): Promise<void> {
		return api.post<void>(`/movies/${movieId}/clear-metadata`);
	},

	/**
	 * List ambiguous match candidates persisted when the auto-matcher
	 * couldn't pick a single winner.
	 */
	listMatchCandidates(movieId: string): Promise<{ candidates: MatchCandidate[] }> {
		return api.get(`/movies/${movieId}/match-candidates`);
	},

	/**
	 * Apply a user-chosen candidate. Server clears the dropdown and
	 * re-runs the merge fetch using the picked provider+externalId.
	 */
	applyMatchCandidate(movieId: string, provider: string, externalId: string): Promise<unknown> {
		return api.post(`/movies/${movieId}/match-candidates/apply`, {
			provider,
			externalId,
		});
	},

	clearMatchCandidates(movieId: string): Promise<{ ok: boolean }> {
		return api.delete(`/movies/${movieId}/match-candidates`);
	},

	/**
	 * Run the title sanitiser on a single movie. Returns the updated
	 * movie record plus { changed, from, to } so the caller can
	 * surface the rename in a toast and refresh the page without a
	 * follow-up GET.
	 */
	sanitizeTitle(movieId: string): Promise<{
		movie: Movie;
		changed: boolean;
		from: string | null;
		to: string | null;
	}> {
		return api.post(`/movies/${movieId}/sanitize-title`);
	},

	/**
	 * Get recently added movies
	 */
	getRecentlyAdded(limit = 20): Promise<MovieListResponse> {
		return api.get<MovieListResponse>('/movies', {
			sortBy: 'addedAt',
			sortOrder: 'desc',
			limit: String(limit),
		});
	},

	/**
	 * Get movies the user is currently watching (have progress)
	 */
	getContinueWatching(): Promise<MovieListResponse> {
		return api.get<MovieListResponse>('/movies/continue-watching');
	},

	/**
	 * Get trending/popular movies
	 */
	getTrending(limit = 20): Promise<MovieListResponse> {
		return api.get<MovieListResponse>('/movies/trending', {
			limit: String(limit),
		});
	},

	/**
	 * Get available genres
	 */
	getGenres(): Promise<string[]> {
		return api.get<string[]>('/movies/genres');
	},

	/**
	 * Update movie details (title, year, overview, etc.)
	 */
	update(movieId: string, data: Record<string, unknown>): Promise<Movie> {
		return api.patch<Movie>(`/movies/${movieId}`, data);
	},

	/**
	 * Rate a movie
	 */
	rate(movieId: string, rating: number): Promise<void> {
		return api.post<void>(`/movies/${movieId}/rate`, { rating });
	},

	/**
	 * Add/remove movie from watchlist
	 */
	toggleWatchlist(movieId: string): Promise<{ inWatchlist: boolean }> {
		return api.post<{ inWatchlist: boolean }>(`/watchlist/${movieId}/toggle`);
	},

	/**
	 * Re-scan movie file(s) — re-probes codecs, resolution, duration
	 */
	rescan(
		movieId: string,
	): Promise<{ files: { fileId: string; fileName: string; updated: boolean }[] }> {
		return api.post(`/movies/${movieId}/rescan`);
	},

	/**
	 * Remove a movie from the library
	 */
	remove(movieId: string): Promise<{ success: boolean }> {
		return api.delete<{ success: boolean }>(`/movies/${movieId}`);
	},

	/**
	 * Delete a movie's file(s) from disk, clean up caches, and remove the DB record
	 */
	deleteFromDisk(movieId: string, deleteEnclosingFolder: boolean): Promise<{ success: boolean }> {
		return api.post<{ success: boolean }>(`/movies/${movieId}/delete-files`, {
			deleteEnclosingFolder,
		});
	},

	/**
	 * Cancel all active processing jobs for a movie
	 */
	cancelProcessing(movieId: string): Promise<{ cancelled: number }> {
		return api.post<{ cancelled: number }>(`/jobs/cancel-by-movie/${movieId}`);
	},

	markWatched(movieId: string): Promise<{ success: boolean }> {
		return api.post<{ success: boolean }>(`/movies/${movieId}/watched`);
	},

	markUnwatched(movieId: string): Promise<{ success: boolean }> {
		return api.delete<{ success: boolean }>(`/movies/${movieId}/watched`);
	},

	/**
	 * Perform a bulk action on multiple movies.
	 * Actions: rescan, refresh_metadata, clear_metadata, hide, unhide,
	 *          mark_watched, mark_unwatched, remove, delete_from_disk
	 */
	bulkAction(
		action: string,
		movieIds: string[],
		options?: { deleteEnclosingFolder?: boolean },
	): Promise<{
		processed: number;
		total: number;
		errors: { movieId: string; error: string }[];
		results: { movieId: string; success: boolean; error?: string }[];
	}> {
		return api.post('/movies/bulk', { action, movieIds, options });
	},
};
