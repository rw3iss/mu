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
			// A movie passes only when it (a) has at least one 0–10 rating
			// (no rating data ⇒ no signal ⇒ exclude), AND (b) every
			// available 0–10 rating clears the threshold. The "all must
			// pass" rule catches movies with inflated TMDB but poor IMDB
			// (e.g. tmdb 6.1 / imdb 3.2): one weak rating is a strong
			// quality signal even when another source disagrees.
			const ratings: number[] = [];
			if (typeof m.tmdbRating === 'number' && m.tmdbRating > 0) {
				ratings.push(m.tmdbRating);
			}
			if (typeof m.imdbRating === 'number' && m.imdbRating > 0) {
				ratings.push(m.imdbRating);
			}
			if (ratings.length === 0) return false;
			if (ratings.some((r) => r < filters.minRating!)) return false;
		}
		if (filters.minVotes != null && filters.minVotes > 0) {
			// Strict: same rationale as minRating. Null tmdbVotes is
			// treated as "unknown count, doesn't meet threshold".
			const v = m.tmdbVotes ?? 0;
			if (v < filters.minVotes) return false;
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
