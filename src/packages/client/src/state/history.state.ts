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
export function pushToHistory(movie: { id: string; title: string; year?: number; posterUrl?: string; thumbnailUrl?: string }): void {
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
 * Clear the cached history.
 */
export function clearHistoryCache(): void {
  historyEntries.value = [];
}
