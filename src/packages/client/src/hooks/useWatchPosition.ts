import { playbackSettings } from '@/state/playbackSettings.state';
import { type WatchPosition, watchPositions } from '@/state/watchPositions.state';
import { getWatchPercent } from '@/utils/watch-progress';

export interface WatchPositionView {
	positionSeconds: number;
	durationSeconds: number;
	percent: number;
	hasProgress: boolean;
	raw: WatchPosition;
}

/** Above this percent, a movie counts as fully watched regardless of
 * the absolute tail tolerance. Catches the "duration unknown / short
 * runtime" edge case where 5 minutes would be most of the movie. */
const FULLY_WATCHED_PERCENT = 95;

/**
 * Reactive lookup of the cached resume position for `movieId`.
 *
 * Reads the global signals directly during render so Preact's signal
 * tracking auto-subscribes the caller — every component using this
 * hook re-renders when:
 *   - the player tick updates `watchPositions`,
 *   - the `/history/positions` hydration finishes,
 *   - the admin changes the Completed Tail setting,
 *   - `clearWatchPosition` runs (end-of-stream, "Start over").
 *
 * Returns `null` when:
 *   - no `movieId`,
 *   - no cached position AND no fallback position,
 *   - the position is inside the configured completed-tail window
 *     (the movie is effectively "watched in full"),
 *   - the position is at or above 95% (handles short runtimes).
 *
 * Falls back to the movie object's `watchPosition` / `durationSeconds`
 * fields when the signal cache hasn't hydrated yet — useful in the
 * brief window after first paint.
 */
export function useWatchPosition(
	movieId: string | null | undefined,
	fallback?: { watchPosition?: number; durationSeconds?: number },
): WatchPositionView | null {
	// Subscribe by reading .value during render — Preact's signal
	// runtime tracks both reads against the calling component.
	const positions = watchPositions.value;
	const tail = playbackSettings.value.completedTailSeconds;

	if (!movieId) return null;
	const cached = positions[movieId];
	const position = cached?.positionSeconds ?? fallback?.watchPosition ?? 0;
	const duration = cached?.durationSeconds ?? fallback?.durationSeconds ?? 0;
	if (position <= 0) return null;

	const movieLike = { watchPosition: position, durationSeconds: duration };
	const percent = getWatchPercent(movieLike);

	const insideTail = duration > 0 && position >= duration - tail;
	const aboveFullyWatchedPct = percent >= FULLY_WATCHED_PERCENT;
	const fullyWatched = insideTail || aboveFullyWatchedPct;

	const hasProgress = !fullyWatched && percent > 0 && percent < 100;

	return {
		positionSeconds: position,
		durationSeconds: duration ?? 0,
		percent,
		hasProgress,
		raw:
			cached ??
			({
				positionSeconds: position,
				durationSeconds: duration ?? null,
				watchedAt: '',
			} as WatchPosition),
	};
}
