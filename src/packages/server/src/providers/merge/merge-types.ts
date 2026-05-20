/**
 * Shape of a single source's contribution to a movie merge.
 *
 * Providers' raw responses are normalised by their adapters into
 * `SourceContribution` records before being handed to the MergeEngine.
 * Each adapter is responsible for the source→canonical-field mapping
 * (e.g., TMDB's `vote_average` → `tmdbRating`, OMDB's `imdbRating`
 * string → `imdbRating` number).
 *
 * Keeping this layer ABOVE the engine — and out of the engine itself —
 * is what lets the engine remain source-agnostic and rule-driven.
 */

/** The user-sentinel source. Always wins regardless of provider precedence. */
export const USER_SOURCE = 'user' as const;

/** Canonical fields the MergeEngine knows how to combine.
 *  Mirrors movies + movie_metadata columns we currently care about
 *  for cross-source merging. Add a field here, add a rule for it. */
export type CanonicalField =
	// --- movies (denormalised hot fields) ---
	| 'title'
	| 'originalTitle'
	| 'year'
	| 'overview'
	| 'tmdbId'
	| 'imdbId'
	| 'posterUrl'
	| 'backdropUrl'
	| 'trailerUrl'
	| 'releaseDate'
	| 'runtimeMinutes'
	| 'language'
	| 'country'
	| 'contentRating'
	// --- movie_metadata ---
	| 'genres'
	| 'cast'
	| 'directors'
	| 'writers'
	| 'keywords'
	| 'productionCompanies'
	| 'budget'
	| 'revenue'
	| 'imdbRating'
	| 'imdbVotes'
	| 'tmdbRating'
	| 'tmdbVotes'
	| 'rottenTomatoesScore'
	| 'metacriticScore';

/** A canonical record key→value map. Values are nullable when the
 *  source didn't supply them — null fields are ignored by the engine. */
export type CanonicalRecord = Partial<Record<CanonicalField, unknown>>;

/** Normalised single-source view of a movie's metadata. */
export interface SourceContribution {
	/** Provider id, e.g. 'tmdb' / 'omdb' / 'trakt' / 'wikidata' / 'user'. */
	source: string;
	/** Per-field values. Null/undefined values are treated as "not supplied". */
	fields: CanonicalRecord;
	/** Fetch timestamp; used for tie-breaks when two sources have equal
	 *  precedence on the same field (newer wins). ISO string. */
	fetchedAt?: string;
}

/** Per-field provenance — which source set the current value. */
export type ProvenanceMap = Partial<Record<CanonicalField, string>>;

/** What MergeEngine.apply returns. */
export interface MergeResult {
	/** The merged record. Only fields actually set by some source
	 *  appear; absent fields are omitted (caller decides whether to
	 *  overwrite null in storage). */
	merged: CanonicalRecord;
	/** New provenance — which source ended up winning each field. */
	provenance: ProvenanceMap;
	/** Optional log of per-field changes (for debugging / audit). */
	diff: FieldChange[];
}

export interface FieldChange {
	field: CanonicalField;
	previousValue: unknown;
	previousSource: string | null;
	newValue: unknown;
	newSource: string;
	reason: 'first-set' | 'higher-precedence' | 'merged-collection' | 'user-override';
}
