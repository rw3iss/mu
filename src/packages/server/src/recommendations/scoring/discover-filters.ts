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
	// Comma-separated OR: "mob, mafia" should match either, since the point of
	// this filter is to catch themes no single genre term covers.
	const keywordTerms = (filters.keyword ?? '')
		.toLowerCase()
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

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
			// Use the *highest* available vote count across sources so the
			// filter mirrors minRating's "any source can satisfy" intent.
			// Previously this only checked tmdbVotes, hiding popular movies
			// that have strong IMDB vote counts but sparse TMDB coverage.
			const v = Math.max(m.tmdbVotes ?? 0, m.imdbVotes ?? 0);
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
		const languageFilter = filters.language?.toLowerCase().trim();
		if (languageFilter) {
			// Match against the canonical TMDB language code first
			// (e.g. "en", "fr"), then fall back to substring on the
			// full name so users can type "English" or "Spanish" too.
			const ml = (m.language ?? '').toLowerCase();
			if (!ml || (ml !== languageFilter && !ml.includes(languageFilter))) {
				return false;
			}
		}
		if (filters.minRuntime != null && filters.minRuntime > 0) {
			if (m.runtimeMinutes == null || m.runtimeMinutes < filters.minRuntime) return false;
		}
		if (filters.maxRuntime != null && filters.maxRuntime > 0) {
			if (m.runtimeMinutes != null && m.runtimeMinutes > filters.maxRuntime) return false;
		}
		if (keywordTerms.length > 0) {
			// Keywords carry the precise concepts TMDB tags ("mafia",
			// "organized crime"); the overview catches everything else.
			const haystack = [m.title, m.overview ?? '', ...m.keywords, ...m.genres]
				.join(' ')
				.toLowerCase();
			if (!keywordTerms.some((t) => haystack.includes(t))) return false;
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
		(f.language != null && f.language !== '') ||
		(f.minRuntime != null && f.minRuntime > 0) ||
		(f.maxRuntime != null && f.maxRuntime > 0) ||
		(f.keyword != null && f.keyword.trim() !== '')
	);
}
