import type { Movie } from '@/state/library.state';

type WatchFields = Pick<Movie, 'watchPosition' | 'durationSeconds' | 'watchProgress'>;

/**
 * Compute watch progress as a percentage (0–100).
 * Prefers watchPosition/durationSeconds; falls back to the legacy watchProgress fraction.
 */
export function getWatchPercent(movie: WatchFields): number {
	const pos = movie.watchPosition ?? 0;
	const dur = movie.durationSeconds ?? 0;
	if (dur > 0 && pos > 0) return (pos / dur) * 100;
	// Legacy fallback: watchProgress is a 0–1 fraction (from getContinueWatching)
	if (movie.watchProgress != null && movie.watchProgress > 0) return movie.watchProgress * 100;
	return 0;
}

/** True when the movie has partial progress (not 0% and not 100%). */
export function hasWatchProgress(movie: WatchFields): boolean {
	const pct = getWatchPercent(movie);
	return pct > 0 && pct < 100;
}
