import type { Movie } from '@/state/library.state';

/**
 * Common prop shape shared by `MovieCard`, `MovieListItem`, and
 * `MovieLargeCard`. Keeping the set in one place stops the trio from
 * drifting (e.g. when adding a new callback like `onMovieRemoved`,
 * each card must accept and forward it).
 *
 * Each card extends this with no additions today; future per-variant
 * props (e.g. compact / aspect overrides) belong on the specific
 * variant interface, not here.
 */
export interface MovieDisplayProps {
	movie: Movie;
	onMovieUpdate?: (movie: Movie) => void;
	onMovieRemoved?: (movieId: string) => void;
	selectionMode?: boolean;
	selected?: boolean;
	onToggleSelect?: (id: string) => void;
}
