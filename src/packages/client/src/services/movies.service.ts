import type { Movie } from '@/state/library.state';
import { api } from './api';

// ============================================
// Types
// ============================================

export interface MovieListResponse {
	movies: Movie[];
	total: number;
	hiddenCount?: number;
	page: number;
	pageSize: number;
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
};
