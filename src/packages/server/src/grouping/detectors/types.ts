import type { MovieGroup } from '../../database/schema/index.js';

export type DetectionSource =
	| 'sxxexx-filename'
	| 'folder-tree'
	| 'multi-file'
	| 'fuzzy-title'
	| 'manual'
	| 'tmdb-tv'; // reserved for phase 2

export interface DetectionInput {
	/** Movie ID — for repository lookups. */
	movieId: string;
	/** Currently-displayed movie title (may be filename-derived for unmatched files). */
	movieTitle: string;
	/** Absolute file path on disk. */
	filePath: string;
	/** Just the file's basename, with extension. */
	fileName: string;
	/** All existing parent groups — detectors use this for fuzzy matching. */
	existingParents: MovieGroup[];
	/**
	 * All file paths in the same folder as filePath. Used by folder /
	 * multi-file detectors. Caller supplies these so detectors stay pure.
	 */
	siblingPaths: string[];
}

export interface DetectionResult {
	/** Display name for the parent group. */
	parentName: string;
	/** When set, attach to this existing parent. Otherwise create new. */
	parentGroupId?: string;
	/** Display name for the subgroup ("Show Name - Season 3" or "Specials"). */
	subgroupName: string;
	/** Season number / part number. Null when unknown. */
	ordinal: number | null;
	/** Episode/part number within the subgroup. */
	episodeOrdinal: number | null;
	/** 0..1 — drives status (`auto` ≥0.85, `unsure` ≥0.55, else discarded). */
	confidence: number;
	source: DetectionSource;
	/**
	 * Alternative parent candidates, for "Move to…" UI. Caller persists
	 * these to `movie_groups.altParents` when status=unsure.
	 */
	alternatives?: Array<{ parentGroupId: string; confidence: number }>;
	/**
	 * Hint for the parent group's `groupType` ('series' | 'show' |
	 * 'collection' | 'trilogy' | …). Detectors can override based on
	 * what they observe; default 'series'.
	 */
	groupTypeHint?: string;
	/**
	 * Stable external identifiers the detector already knows. The
	 * default SxxExx / folder / multi-file detectors don't populate
	 * these (they fire before TMDB enrichment), but the placeholder
	 * tmdb-tv detector or a future server-side dedupe path can — and
	 * when present, the orchestrator prefers them over the parsed
	 * name when finding an existing parent.
	 */
	tmdbTvId?: number | null;
	imdbId?: string | null;
}

export interface Detector {
	/** Lower number = higher priority. Pipeline runs them in ascending order. */
	priority: number;
	/** Telemetry / debug label. */
	name: string;
	detect(input: DetectionInput): DetectionResult | null;
}
