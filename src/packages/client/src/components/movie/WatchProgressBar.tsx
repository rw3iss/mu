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
 */
export function WatchProgressBar({ movie, class: className, fillClass }: WatchProgressBarProps) {
	if (!hasWatchProgress(movie)) return null;
	return (
		<div class={className}>
			<div class={fillClass} style={{ width: `${getWatchPercent(movie)}%` }} />
		</div>
	);
}
