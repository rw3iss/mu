/**
 * A user's saved defaults for the result filter bars — the person page's
 * "Known For" rail and the movie page's "Similar" section.
 *
 * Persisted as one blob under the `movieSearchDefaults` per-user setting key
 * so a save is a single atomic write and "save" always replaces the whole set
 * rather than merging with whatever was stored before.
 *
 * Values are kept as the raw *strings* the inputs hold (rather than numbers) so
 * a round trip through save/restore is lossless and an empty field stays empty
 * instead of becoming 0.
 */
export interface MovieSearchDefaults {
	/** 'year' | 'title' | 'rating' | 'votes' */
	sort: string;
	/** 'all' | 'in' | 'out' */
	library: string;
	minYear: string;
	minRating: string;
	minVotes: string;
	/**
	 * 'all' | 'movie' | 'tv'. Only the Known For rail shows a Type control;
	 * the Similar section ignores it but round-trips it so saving from one
	 * surface never silently drops the other's preference.
	 */
	type: string;
}

export const EMPTY_MOVIE_SEARCH_DEFAULTS: MovieSearchDefaults = {
	sort: 'year',
	library: 'all',
	minYear: '',
	minRating: '',
	minVotes: '',
	type: 'all',
};

/**
 * Coerce an untrusted blob (DB row, API response) into a complete
 * MovieSearchDefaults. Unknown/missing fields fall back to the empty default,
 * so a partial or hand-edited row can't break the filter bar.
 */
export function normalizeMovieSearchDefaults(raw: unknown): MovieSearchDefaults {
	const o = (raw ?? {}) as Partial<Record<keyof MovieSearchDefaults, unknown>>;
	const str = (v: unknown, fallback: string): string =>
		typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
	return {
		sort: str(o.sort, EMPTY_MOVIE_SEARCH_DEFAULTS.sort),
		library: str(o.library, EMPTY_MOVIE_SEARCH_DEFAULTS.library),
		minYear: str(o.minYear, ''),
		minRating: str(o.minRating, ''),
		minVotes: str(o.minVotes, ''),
		type: str(o.type, EMPTY_MOVIE_SEARCH_DEFAULTS.type),
	};
}

/** True when nothing is actually set — used to skip restoring a no-op blob. */
export function hasMovieSearchDefaults(d: MovieSearchDefaults): boolean {
	return (
		d.sort !== EMPTY_MOVIE_SEARCH_DEFAULTS.sort ||
		d.library !== EMPTY_MOVIE_SEARCH_DEFAULTS.library ||
		d.type !== EMPTY_MOVIE_SEARCH_DEFAULTS.type ||
		d.minYear.trim() !== '' ||
		d.minRating.trim() !== '' ||
		d.minVotes.trim() !== ''
	);
}
