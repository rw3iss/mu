import {
	EMPTY_MOVIE_SEARCH_DEFAULTS,
	hasMovieSearchDefaults,
	type MovieSearchDefaults,
	normalizeMovieSearchDefaults,
} from '@mu/shared';
import { signal } from '@preact/signals';
import { api } from '@/services/api';

/**
 * The user's saved defaults for the Known For / Similar filter bars.
 *
 * Cached in a module-level signal and fetched at most once per session: both
 * rails need these synchronously on mount to seed their inputs, and a person
 * page can mount several cards at once. `null` means "not loaded yet", which
 * the consumers use to hold off seeding until the real value arrives (seeding
 * from the empty set first would visibly reset the controls a moment later).
 */
export const movieSearchDefaults = signal<MovieSearchDefaults | null>(null);

/** In-flight fetch, so concurrent callers share one request. */
let loading: Promise<MovieSearchDefaults> | null = null;

export function ensureMovieSearchDefaultsLoaded(): Promise<MovieSearchDefaults> {
	if (movieSearchDefaults.value) return Promise.resolve(movieSearchDefaults.value);
	if (loading) return loading;
	loading = api
		.get<{ value: unknown }>('/settings/movie-search-defaults')
		.then((res) => {
			const next = normalizeMovieSearchDefaults(res?.value);
			movieSearchDefaults.value = next;
			return next;
		})
		.catch(() => {
			// Never block the rails on a settings failure — fall back to empty
			// so the filters still work, just without saved defaults.
			movieSearchDefaults.value = EMPTY_MOVIE_SEARCH_DEFAULTS;
			return EMPTY_MOVIE_SEARCH_DEFAULTS;
		})
		.finally(() => {
			loading = null;
		});
	return loading;
}

/**
 * Persist `next` as the user's defaults, replacing whatever was stored before.
 * Updates the cache optimistically so every mounted filter bar reflects it
 * without a refetch.
 */
export async function saveMovieSearchDefaults(next: MovieSearchDefaults): Promise<void> {
	const value = normalizeMovieSearchDefaults(next);
	movieSearchDefaults.value = value;
	await api.put('/settings/movie-search-defaults', { value });
}

/** Clear the cache on logout so the next user doesn't inherit these. */
export function resetMovieSearchDefaults(): void {
	movieSearchDefaults.value = null;
	loading = null;
}

export { hasMovieSearchDefaults };
