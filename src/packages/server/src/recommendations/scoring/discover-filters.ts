import type { DiscoverFilters, MovieWithMetadata, ScoredMovie } from '../types.js';

/**
 * Apply user-facing filters to the scored results. Returns a new
 * list — does not mutate. Filters compose: a result must match every
 * filter the user set.
 *
 * Different from `applyFilters` in `filters.ts`: those are pipeline-
 * level filters (same-group, per-director cap, hidden). These are
 * user-driven (minRating, year range, etc.) and surface in the
 * Discover UI's filter panel.
 */
export function applyDiscoverFilters(
	scored: ScoredMovie[],
	moviesById: Map<string, MovieWithMetadata>,
	filters: DiscoverFilters | undefined,
): ScoredMovie[] {
	if (!filters || !hasAnyFilter(filters)) return scored;

	const personLower = filters.person?.toLowerCase().trim();
	const wantGenres: string[] = (filters.genres ?? []).map((g) => g.toLowerCase());

	return scored.filter((s) => {
		const m = moviesById.get(s.movieId);
		if (!m) return false;

		if (filters.minRating != null && filters.minRating > 0) {
			const r = m.tmdbRating ?? m.imdbRating ?? 0;
			if (r > 0 && r < filters.minRating) return false;
		}
		if (filters.minVotes != null && filters.minVotes > 0) {
			// We don't carry tmdbVotes on MovieWithMetadata — skip until
			// the hydration layer exposes it; harmless no-op for now.
		}
		if (wantGenres.length > 0) {
			const ml = m.genres.map((g) => g.toLowerCase());
			const overlap = wantGenres.some((g) => ml.includes(g));
			if (!overlap) return false;
		}
		if (filters.yearFrom != null && m.year != null && m.year < filters.yearFrom) return false;
		if (filters.yearTo != null && m.year != null && m.year > filters.yearTo) return false;
		if (personLower) {
			const hit =
				m.cast.some((c) => c.toLowerCase().includes(personLower)) ||
				m.directors.some((d) => d.toLowerCase().includes(personLower));
			if (!hit) return false;
		}
		return true;
	});
}

function hasAnyFilter(f: DiscoverFilters): boolean {
	return (
		(f.minRating != null && f.minRating > 0) ||
		(f.minVotes != null && f.minVotes > 0) ||
		(f.genres != null && f.genres.length > 0) ||
		f.yearFrom != null ||
		f.yearTo != null ||
		(f.person != null && f.person.trim() !== '') ||
		(f.language != null && f.language !== '')
	);
}
