import type { CanonicalField } from './merge-types.js';

/**
 * Declarative per-field merge rules.
 *
 * Each field declares:
 *   - precedence: a per-source weight. Highest wins. A source not in
 *     the table has implicit weight 0 (only sets the field if nothing
 *     is there yet).
 *   - strategy: how to combine.
 *
 * The CURRENT VALUES intentionally mirror the hardcoded behaviour in
 * the legacy `metadata.service.ts::fetchAndMerge()` so the refactor
 * is byte-identical on existing data. Tuning per source moves here.
 */
export type MergeStrategy =
	/** Highest-precedence non-null value wins; nothing happens if the
	 *  incoming source has lower precedence than the recorded provenance. */
	| 'take-best'
	/** Treat the value as an array (or comma-separated string of items)
	 *  and union them — deduping case-insensitively for strings. Records
	 *  provenance as the highest-precedence contributing source. */
	| 'merge-arrays'
	/** Numeric max — highest reported value wins. Useful for vote counts
	 *  where each source has its own scale and "more" is more credible. */
	| 'numeric-max'
	/** Numeric average — average across all reporting sources. Useful
	 *  for aggregate community ratings if we ever want a blended score
	 *  (not the default behavior). */
	| 'numeric-avg';

export interface FieldRule {
	field: CanonicalField;
	precedence: Record<string, number>;
	strategy: MergeStrategy;
}

/**
 * Source precedence table. The numbers themselves are nominal — what
 * matters is the RELATIVE ordering. Suggested convention:
 *   10 = authoritative for this field (e.g. OMDB for IMDB ratings)
 *    7 = strong / preferred (e.g. TMDB for posters)
 *    4 = fallback (e.g. OMDB for cast strings if TMDB hasn't run yet)
 *    1 = lowest-priority hint
 *
 * Add a new source here and to the relevant rules below.
 *
 * The implicit 'user' sentinel ALWAYS wins (handled inside the
 * engine; do not encode it here).
 */
export const DEFAULT_MERGE_RULES: FieldRule[] = [
	// --- movies / hot fields ----------------------------------------------
	{ field: 'title', precedence: { tmdb: 10, omdb: 6, trakt: 5, wikidata: 4 }, strategy: 'take-best' },
	{ field: 'originalTitle', precedence: { tmdb: 10, omdb: 4 }, strategy: 'take-best' },
	{ field: 'year', precedence: { tmdb: 10, omdb: 8, trakt: 6, wikidata: 5 }, strategy: 'take-best' },
	{
		field: 'overview',
		// OMDB's IMDB-backed plot tends to be denser; TMDB tagline-style is shorter.
		precedence: { omdb: 10, tmdb: 8, trakt: 5, wikidata: 3 },
		strategy: 'take-best',
	},
	{ field: 'tmdbId', precedence: { tmdb: 10, wikidata: 6 }, strategy: 'take-best' },
	{ field: 'imdbId', precedence: { omdb: 10, tmdb: 8, wikidata: 6, trakt: 5 }, strategy: 'take-best' },
	{ field: 'posterUrl', precedence: { tmdb: 10, trakt: 6, omdb: 3 }, strategy: 'take-best' },
	{ field: 'backdropUrl', precedence: { tmdb: 10, trakt: 5 }, strategy: 'take-best' },
	{ field: 'trailerUrl', precedence: { tmdb: 10 }, strategy: 'take-best' },
	{ field: 'releaseDate', precedence: { tmdb: 10, omdb: 7, trakt: 5 }, strategy: 'take-best' },
	{
		field: 'runtimeMinutes',
		precedence: { omdb: 10, tmdb: 8, trakt: 5 },
		strategy: 'take-best',
	},
	{ field: 'language', precedence: { tmdb: 10, omdb: 5 }, strategy: 'take-best' },
	{ field: 'country', precedence: { tmdb: 10, omdb: 7 }, strategy: 'take-best' },
	{ field: 'contentRating', precedence: { tmdb: 8, omdb: 10 }, strategy: 'take-best' },
	// --- movie_metadata ---------------------------------------------------
	{ field: 'genres', precedence: { tmdb: 10, omdb: 5, trakt: 4 }, strategy: 'merge-arrays' },
	{ field: 'cast', precedence: { tmdb: 10, omdb: 4 }, strategy: 'merge-arrays' },
	{ field: 'directors', precedence: { tmdb: 10, omdb: 6 }, strategy: 'merge-arrays' },
	{ field: 'writers', precedence: { tmdb: 10, omdb: 6 }, strategy: 'merge-arrays' },
	{ field: 'keywords', precedence: { tmdb: 10, wikidata: 4 }, strategy: 'merge-arrays' },
	{ field: 'productionCompanies', precedence: { tmdb: 10 }, strategy: 'merge-arrays' },
	{ field: 'budget', precedence: { tmdb: 10 }, strategy: 'take-best' },
	{ field: 'revenue', precedence: { tmdb: 10 }, strategy: 'take-best' },
	// Ratings — OMDB is the authority on IMDB & RT & Metacritic; TMDB owns its own.
	{ field: 'imdbRating', precedence: { omdb: 10 }, strategy: 'take-best' },
	{ field: 'imdbVotes', precedence: { omdb: 10 }, strategy: 'numeric-max' },
	{ field: 'tmdbRating', precedence: { tmdb: 10 }, strategy: 'take-best' },
	{ field: 'tmdbVotes', precedence: { tmdb: 10 }, strategy: 'numeric-max' },
	{ field: 'rottenTomatoesScore', precedence: { omdb: 10 }, strategy: 'take-best' },
	{ field: 'metacriticScore', precedence: { omdb: 10 }, strategy: 'take-best' },
];

/** Build a fast lookup from the rule array. Caller-cached. */
export function buildRuleMap(rules: FieldRule[]): Map<CanonicalField, FieldRule> {
	const m = new Map<CanonicalField, FieldRule>();
	for (const r of rules) m.set(r.field, r);
	return m;
}
