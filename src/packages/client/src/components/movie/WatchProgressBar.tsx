import { useWatchPosition } from '@/hooks/useWatchPosition';
import type { Movie } from '@/state/library.state';

interface WatchProgressBarProps {
	movie: Movie;
	/** Class for the outer progress-bar container (each card variant supplies its own). */
	class?: string;
	/** Class for the inner progress-fill element. */
	fillClass?: string;
}

/**
 * Renders the bottom-of-card "watched 73%" progress bar. Returns null
 * when there's nothing meaningful to show — no position, fully watched
 * (within the configurable completed-tail window), or ≥95% watched.
 *
 * Defers entirely to `useWatchPosition`, which already encapsulates
 * the tail-seconds + percent gate. The bar appears iff `hasProgress`
 * is true, so it matches the resume-button visibility everywhere.
 */
export function WatchProgressBar({ movie, class: className, fillClass }: WatchProgressBarProps) {
	const watch = useWatchPosition(movie.id, {
		watchPosition: movie.watchPosition,
		durationSeconds: movie.durationSeconds,
	});
	if (!watch?.hasProgress) return null;
	return (
		<div class={className}>
			<div class={fillClass} style={{ width: `${watch.percent}%` }} />
		</div>
	);
}
