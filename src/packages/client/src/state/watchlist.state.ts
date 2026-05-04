import { signal } from '@preact/signals';
import { api } from '@/services/api';
import { moviesService } from '@/services/movies.service';

// ============================================
// Types
// ============================================

interface WatchlistEntry {
	id: string;
	movieId: string;
	addedAt: string;
	notes: string | null;
	movieTitle: string;
	movieYear: number;
	moviePosterUrl: string;
	movieThumbnailUrl: string;
	movieOverview: string;
	movieRuntimeMinutes: number;
}

// ============================================
// Signals
// ============================================

/**
 * Set of movie IDs that are in the current user's watchlist. Null = not loaded.
 * Use isInWatchlist() for synchronous lookups; ensureWatchlistLoaded() to fetch.
 */
export const watchlistIds = signal<Set<string> | null>(null);

/** True while the initial fetch is in flight. */
export const watchlistLoading = signal<boolean>(false);

// ============================================
// Internal
// ============================================

let listInflight: Promise<Set<string>> | null = null;

// ============================================
// Loaders
// ============================================

/**
 * Lazily load the watchlist into the cache. Concurrent callers share a
 * single in-flight request. Returns the cached id set.
 */
export async function ensureWatchlistLoaded(): Promise<Set<string>> {
	if (watchlistIds.value !== null) return watchlistIds.value;
	if (listInflight) return listInflight;

	watchlistLoading.value = true;
	listInflight = api
		.get<WatchlistEntry[]>('/watchlist')
		.then((entries) => {
			const ids = new Set(entries.map((e) => e.movieId));
			watchlistIds.value = ids;
			return ids;
		})
		.finally(() => {
			watchlistLoading.value = false;
			listInflight = null;
		});
	return listInflight;
}

/** Drop the cache. Used after sign-in/out or when forcing a refresh. */
export function invalidateWatchlist(): void {
	watchlistIds.value = null;
	listInflight = null;
}

// ============================================
// Synchronous accessors
// ============================================

/**
 * Synchronously check if a movie is in the watchlist. Returns false when the
 * cache hasn't loaded yet — call ensureWatchlistLoaded() first if you need a
 * definitive answer.
 */
export function isInWatchlist(movieId: string): boolean {
	const ids = watchlistIds.value;
	return ids ? ids.has(movieId) : false;
}

/** True only when the cache has loaded at least once. */
export function isWatchlistLoaded(): boolean {
	return watchlistIds.value !== null;
}

// ============================================
// Mutations — wrap the service so the cache stays consistent
// ============================================

function mutate(movieId: string, op: 'add' | 'remove'): void {
	const current = watchlistIds.value;
	if (!current) return;
	const next = new Set(current);
	if (op === 'add') next.add(movieId);
	else next.delete(movieId);
	watchlistIds.value = next;
}

/** Add a movie to the watchlist (no-op if already in). */
export async function addToWatchlist(movieId: string): Promise<void> {
	if (isInWatchlist(movieId)) return;
	await api.post(`/watchlist/${movieId}`, {});
	mutate(movieId, 'add');
}

/** Remove a movie from the watchlist (no-op if not in). */
export async function removeFromWatchlist(movieId: string): Promise<void> {
	if (watchlistIds.value !== null && !isInWatchlist(movieId)) return;
	await api.delete(`/watchlist/${movieId}`);
	mutate(movieId, 'remove');
}

/**
 * Toggle a movie's watchlist membership. Returns the new state. Uses the
 * server's atomic /toggle endpoint so we don't race against ourselves.
 */
export async function toggleWatchlist(movieId: string): Promise<boolean> {
	const result = await moviesService.toggleWatchlist(movieId);
	mutate(movieId, result.inWatchlist ? 'add' : 'remove');
	return result.inWatchlist;
}
