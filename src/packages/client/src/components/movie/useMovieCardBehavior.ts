import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { playMovie } from '@/state/globalPlayer.state';
import type { MovieDisplayProps } from './types';

/**
 * Shared click / play / resume behaviour for the three movie card
 * variants (`MovieCard`, `MovieListItem`, `MovieLargeCard`). Each
 * variant has its own markup; the click semantics, the
 * stop-propagation pattern on play/resume buttons, and the bulk-
 * select coupling are identical and don't need to be re-implemented
 * three times.
 *
 * Returns three handlers tied to the movie id and the selection
 * state passed in:
 *
 * - `onCardClick` — root-of-card click. In selection mode toggles
 *   the row; otherwise navigates to the movie detail page.
 * - `onPlayFromStart` — play button click. Starts from t=0,
 *   stops propagation so it doesn't bubble up and trigger
 *   `onCardClick`. No-ops in selection mode.
 * - `onResume` — resume button click. Same shape as `onPlayFromStart`
 *   but uses the saved position.
 */
export function useMovieCardBehavior(
	movie: MovieDisplayProps['movie'],
	selectionMode: boolean,
	onToggleSelect: MovieDisplayProps['onToggleSelect'],
) {
	const onCardClick = useCallback(() => {
		if (selectionMode) {
			onToggleSelect?.(movie.id);
		} else {
			route(`/movie/${movie.id}`);
		}
	}, [movie.id, selectionMode, onToggleSelect]);

	const onPlayFromStart = useCallback(
		(e: Event) => {
			e.stopPropagation();
			if (!selectionMode) playMovie(movie.id, { fromBeginning: true });
		},
		[movie.id, selectionMode],
	);

	const onResume = useCallback(
		(e: Event) => {
			e.stopPropagation();
			if (!selectionMode) playMovie(movie.id);
		},
		[movie.id, selectionMode],
	);

	// Detail URL for middle-click / ctrl-click "open in new tab" — only when not
	// selecting (in selection mode a click toggles the row instead of navigating).
	const href = selectionMode ? undefined : `/movie/${movie.id}`;

	return { onCardClick, onPlayFromStart, onResume, href };
}
