/**
 * Shared filter/sort logic for movie result lists.
 *
 * The person page's "Known For" rail and the movie page's "Similar" section
 * offer the same controls (sort, in-library, min year / rating / votes), so the
 * behaviour lives here once and both map their own row type onto
 * {@link FilterableResult}. Keeping it in one place is what stops the two lists
 * from quietly drifting apart.
 */

export type ResultSort = 'year' | 'title' | 'rating' | 'votes';
export const RESULT_SORTS: readonly ResultSort[] = ['year', 'title', 'rating', 'votes'];

/** all = no filter, `in` = only owned, `out` = only not-owned. */
export type LibraryFilter = 'all' | 'in' | 'out';
export const LIBRARY_FILTERS: readonly LibraryFilter[] = ['all', 'in', 'out'];

/** The minimal shape any list must expose to be filtered/sorted. */
export interface FilterableResult {
	title: string;
	year: number | null;
	/** Best available score (IMDB preferred, TMDB fallback); 0/null when unrated. */
	rating: number | null;
	votes: number | null;
	inLibrary: boolean;
}

export interface ResultFilterState {
	sort: ResultSort;
	/** Raw input strings so a partially-typed value survives re-render. */
	minYear: string;
	minRating: string;
	minVotes: string;
	library: LibraryFilter;
}

export const EMPTY_FILTERS: ResultFilterState = {
	sort: 'year',
	minYear: '',
	minRating: '',
	minVotes: '',
	library: 'all',
};

/** Coerce a URL/query value onto a known sort, falling back to `year`. */
export function toResultSort(value: string | null | undefined): ResultSort {
	return RESULT_SORTS.includes(value as ResultSort) ? (value as ResultSort) : 'year';
}

export function toLibraryFilter(value: string | null | undefined): LibraryFilter {
	return LIBRARY_FILTERS.includes(value as LibraryFilter) ? (value as LibraryFilter) : 'all';
}

/**
 * Apply the filters and return a NEW sorted array. `project` maps each item to
 * the comparable shape, so callers keep their own richer row type.
 */
export function filterAndSortResults<T>(
	items: readonly T[],
	filters: ResultFilterState,
	project: (item: T) => FilterableResult,
): T[] {
	const minYear = Number.parseInt(filters.minYear, 10);
	const minRating = Number.parseFloat(filters.minRating);
	const minVotes = Number.parseInt(filters.minVotes, 10);

	const kept = items.filter((item) => {
		const r = project(item);
		if (filters.library !== 'all' && r.inLibrary !== (filters.library === 'in')) return false;
		if (Number.isFinite(minYear) && minYear > 0 && (r.year ?? 0) < minYear) return false;
		if (Number.isFinite(minRating) && minRating > 0 && (r.rating ?? 0) < minRating) {
			return false;
		}
		if (Number.isFinite(minVotes) && minVotes > 0 && (r.votes ?? 0) < minVotes) return false;
		return true;
	});

	return kept.sort((a, b) => {
		const x = project(a);
		const y = project(b);
		switch (filters.sort) {
			case 'title':
				return (x.title ?? '').localeCompare(y.title ?? '');
			case 'rating':
				return (y.rating ?? 0) - (x.rating ?? 0);
			case 'votes':
				return (y.votes ?? 0) - (x.votes ?? 0);
			default:
				return (y.year ?? 0) - (x.year ?? 0);
		}
	});
}
