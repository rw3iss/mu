import { hasMovieSearchDefaults, type MovieSearchDefaults } from '@mu/shared';
import { useEffect, useRef } from 'preact/hooks';
import {
	ensureMovieSearchDefaultsLoaded,
	movieSearchDefaults,
	saveMovieSearchDefaults,
} from '@/state/movie-search-defaults.state';

interface Options {
	/**
	 * Applied once, when the saved defaults resolve. Skipped entirely when the
	 * user has saved nothing, so the built-in defaults stay in force.
	 */
	apply: (defaults: MovieSearchDefaults) => void;
	/**
	 * Set when the caller already has explicit filters that must win — the
	 * person page reads its filters from the URL, and a shared link's params
	 * should not be overwritten by the viewer's saved preferences.
	 */
	skip?: boolean;
}

/**
 * Seed a filter bar from the user's saved defaults, and expose a save action
 * for the bar's "Save search as default" button.
 *
 * Seeding runs at most once per mount: re-applying on every render would fight
 * the user's own edits, and re-applying on navigation would discard the filters
 * they just set while browsing between titles.
 */
export function useMovieSearchDefaults({ apply, skip }: Options) {
	const applied = useRef(false);
	// Kept in a ref so `apply` doesn't need to be memoised at every call site.
	const applyRef = useRef(apply);
	applyRef.current = apply;

	useEffect(() => {
		if (skip || applied.current) return;
		let alive = true;
		void ensureMovieSearchDefaultsLoaded().then((defaults) => {
			if (!alive || applied.current) return;
			applied.current = true;
			// Nothing saved → leave the component's own defaults untouched.
			if (!hasMovieSearchDefaults(defaults)) return;
			applyRef.current(defaults);
		});
		return () => {
			alive = false;
		};
	}, [skip]);

	return {
		/** Latest known defaults, or null before the first load resolves. */
		saved: movieSearchDefaults.value,
		save: saveMovieSearchDefaults,
	};
}
