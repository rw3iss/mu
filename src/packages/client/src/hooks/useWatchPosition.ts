import { useComputed } from '@preact/signals';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import {
	type WatchPosition,
	watchPositions,
} from '@/state/watchPositions.state';

export interface WatchPositionView {
	positionSeconds: number;
	durationSeconds: number;
	percent: number;
	hasProgress: boolean;
	raw: WatchPosition;
}

/**
 * Convenience hook for movie cards / detail pages: returns the
 * currently-cached resume position for `movieId`, or `null` if the
 * user hasn't started this movie. Reactive — the consumer re-renders
 * automatically when the underlying signal changes (e.g. player
 * progress tick, server hydration, "Start over" clear).
 *
 * The caller does NOT need to fetch anything itself: the global
 * `watchPositions` cache is hydrated once on app load (see
 * `fetchWatchPositions`) and kept in sync by the player.
 *
 * Falls back to the per-movie `watchPosition` / `durationSeconds`
 * fields when present on a movie object — useful for code paths
 * that received their data before the cache was hydrated (rare).
 */
export function useWatchPosition(
	movieId: string | null | undefined,
	fallback?: { watchPosition?: number; durationSeconds?: number },
): WatchPositionView | null {
	const computed = useComputed(() => {
		if (!movieId) return null;
		const cached = watchPositions.value[movieId];
		const position = cached?.positionSeconds ?? fallback?.watchPosition ?? 0;
		const duration =
			cached?.durationSeconds ?? fallback?.durationSeconds ?? 0;
		if (position <= 0) return null;
		const movieLike = {
			watchPosition: position,
			durationSeconds: duration,
		};
		const percent = getWatchPercent(movieLike);
		const progress = hasWatchProgress(movieLike);
		return {
			positionSeconds: position,
			durationSeconds: duration ?? 0,
			percent,
			hasProgress: progress,
			raw:
				cached ??
				({
					positionSeconds: position,
					durationSeconds: duration ?? null,
					watchedAt: '',
				} as WatchPosition),
		};
	});
	return computed.value;
}
