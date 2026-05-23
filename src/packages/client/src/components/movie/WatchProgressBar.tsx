import { useWatchPosition } from '@/hooks/useWatchPosition';
import type { Movie } from '@/state/library.state';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';

interface WatchProgressBarProps {
	movie: Movie;
	/** Class for the outer progress-bar container (each card variant supplies its own). */
	class?: string;
	/** Class for the inner progress-fill element. */
	fillClass?: string;
}

/**
 * Renders the bottom-of-card "watched 73%" progress bar. Returns null
 * when the movie has no recorded watch progress so callers don't gate
 * it themselves. Drop-in for the three identical inline blocks that
 * used to live in MovieCard / MovieLargeCard / MovieListItem.
 *
 * Prefers the live `watchPositions` signal so the bar updates in
 * real time as playback advances; falls back to the movie object's
 * own fields when the cache hasn't hydrated yet.
 */
export function WatchProgressBar({ movie, class: className, fillClass }: WatchProgressBarProps) {
	const watch = useWatchPosition(movie.id, {
		watchPosition: movie.watchPosition,
		durationSeconds: movie.durationSeconds,
	});
	let percent = watch?.percent ?? 0;
	if (percent <= 0 && hasWatchProgress(movie)) {
		percent = getWatchPercent(movie);
	}
	if (percent <= 0 || percent >= 100) return null;
	return (
		<div class={className}>
			<div class={fillClass} style={{ width: `${percent}%` }} />
		</div>
	);
}
