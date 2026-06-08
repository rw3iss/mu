import { signal } from '@preact/signals';
import { api } from '@/services/api';
import type { Movie } from '@/state/library.state';

// ============================================
// Types
// ============================================

export interface HistoryEntry {
	id: string;
	movieId: string;
	watchedAt: string;
	positionSeconds: number;
	durationWatchedSeconds: number;
	completed: boolean;
	movieTitle: string;
	movieYear: number;
	moviePosterUrl: string;
	movieThumbnailUrl: string;
	movieDurationSeconds: number;
}

// ============================================
// Signals
// ============================================

/** Cached history entries, most-recent first. null = not yet loaded. */
export const historyEntries = signal<Movie[] | null>(null);

/** Whether a fetch is currently in progress. */
export const historyLoading = signal(false);

/** Movie IDs that were optimistically pushed during this session. */
const optimisticIds = new Set<string>();

/**
 * Patch display fields (poster, title, year) of a cached history entry after a
 * movie is updated elsewhere (e.g. Refresh Metadata), so the History page /
 * recent sidebar reflects the new poster without waiting for a full refetch.
 */
export function updateMovieInHistory(updated: Movie): void {
	if (historyEntries.value == null) return;
	historyEntries.value = historyEntries.value.map((m) =>
		m.id === updated.id
			? {
					...m,
					title: updated.title ?? m.title,
					year: updated.year ?? m.year,
					posterUrl: updated.posterUrl || updated.thumbnailUrl || m.posterUrl,
					backdropUrl: updated.backdropUrl || m.backdropUrl,
				}
			: m,
	);
}

// ============================================
// Actions
// ============================================

function entryToMovie(entry: HistoryEntry): Movie {
	const position = entry.completed ? 0 : (entry.positionSeconds ?? 0);
	return {
		id: entry.movieId,
		title: entry.movieTitle ?? 'Untitled',
		year: entry.movieYear ?? 0,
		overview: '',
		posterUrl: entry.moviePosterUrl || entry.movieThumbnailUrl || '',
		backdropUrl: '',
		runtime: 0,
		genres: [],
		cast: [],
		rating: 0,
		addedAt: entry.watchedAt ?? '',
		watchPosition: position,
		durationSeconds: entry.movieDurationSeconds ?? 0,
	};
}

/**
 * Fetch history from the server and merge with any optimistic entries
 * that the server may not have recorded yet (progress updates are batched).
 */
export async function fetchHistory(): Promise<void> {
	historyLoading.value = true;
	try {
		const data = await api.get<{ data: HistoryEntry[] }>('/history');
		const serverMovies = data.data.map(entryToMovie);
		const serverIds = new Set(serverMovies.map((m) => m.id));

		// Preserve optimistic entries not yet in the server response
		const missing: Movie[] = [];
		for (const id of optimisticIds) {
			if (!serverIds.has(id)) {
				const cached = historyEntries.value?.find((m) => m.id === id);
				if (cached) missing.push(cached);
			}
		}

		// Optimistic entries go first (they are the most recent), then server data
		historyEntries.value = [...missing, ...serverMovies];
	} catch (error) {
		console.error('Failed to load history:', error);
	} finally {
		historyLoading.value = false;
	}
}

/**
 * Push a movie to the front of the history cache (or promote it if it
 * already exists). This is called when playback starts so the History
 * page is immediately up-to-date without a server round-trip.
 */
export function pushToHistory(movie: {
	id: string;
	title: string;
	year?: number;
	posterUrl?: string;
	thumbnailUrl?: string;
}): void {
	const entry: Movie = {
		id: movie.id,
		title: movie.title,
		year: movie.year ?? 0,
		overview: '',
		posterUrl: movie.posterUrl || movie.thumbnailUrl || '',
		backdropUrl: '',
		runtime: 0,
		genres: [],
		cast: [],
		rating: 0,
		addedAt: new Date().toISOString(),
		watchPosition: 0,
		durationSeconds: 0,
	};

	// Track this as an optimistic entry so fetchHistory preserves it
	optimisticIds.add(movie.id);

	const current = historyEntries.value;
	if (!current) {
		// Cache hasn't been loaded yet — just set it with this single entry.
		// A full fetch will merge this when the History page mounts.
		historyEntries.value = [entry];
		return;
	}

	// Remove existing entry for this movie (if any), then prepend.
	const filtered = current.filter((m) => m.id !== movie.id);
	historyEntries.value = [entry, ...filtered];
}

/**
 * Clear the cached history after the user wiped their own history. Marks the
 * cache as loaded-but-empty so the History page shows the empty state without
 * an extra round-trip.
 */
export function clearHistoryCache(): void {
	optimisticIds.clear();
	historyEntries.value = [];
}

/**
 * Drop all cached history on a user change (login / logout). Resets to the
 * not-loaded state (`null`) so the next viewer triggers a fresh, per-user
 * fetch — never showing the previous user's recently-watched list. Per-user
 * scoping is enforced on the server (`/history` filters by the JWT user id);
 * this just prevents the SPA's in-memory cache from leaking across a switch.
 */
export function resetHistoryCache(): void {
	optimisticIds.clear();
	historyEntries.value = null;
}
