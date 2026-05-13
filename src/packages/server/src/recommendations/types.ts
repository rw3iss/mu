/**
 * Shared types for the recommendations module. Kept in one place so
 * strategies, scoring helpers, and the orchestrator all speak the
 * same language about candidates and final results.
 */

import type { Movie, MovieMetadata } from '../database/schema/index.js';

/** Hydrated seed used by strategies (movie + metadata joined). */
export interface MovieWithMetadata {
	id: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	overview: string | null;
	runtimeMinutes: number | null;
	tmdbId: number | null;
	imdbId: string | null;
	hidden: boolean | null;
	groupId: string | null;
	addedAt: string;
	genres: string[];
	cast: string[];
	directors: string[];
	keywords: string[];
	companies: string[];
	tmdbRating: number | null;
	imdbRating: number | null;
}

/** Per-strategy raw score for one candidate. */
export interface StrategyScore {
	movieId: string;
	/** 0..1 normalised within the strategy's own output range. */
	score: number;
	reasons?: string[];
}

/** Output of a single strategy run. */
export interface StrategyResult {
	strategy: string;
	scores: StrategyScore[];
}

/** Final scored output for the API. */
export interface ScoredMovie {
	movieId: string;
	title: string;
	year: number | null;
	score: number;
	explanation: string[];
	posterUrl: string | null;
	usedSources: string[];
}

/** User-facing post-filters applied after scoring. */
export interface DiscoverFilters {
	minRating?: number;
	minVotes?: number;
	genres?: string[];
	yearFrom?: number;
	yearTo?: number;
	person?: string;
	language?: string;
}

/** Knobs the admin / caller can pass into a recommendation call. */
export interface RecommendOptions {
	k?: number;
	mmrLambda?: number;
	qualityFloor?: number;
	excludeWatched?: boolean;
	excludeSameGroup?: boolean;
	perDirectorCap?: number;
	weights?: Record<string, number>;
	/** Movie IDs the caller already knows about — never returned. */
	excludeMovieIds?: ReadonlySet<string>;
	/** User-facing filters applied to results. */
	filters?: DiscoverFilters;
}

export interface MultiRecommendOptions extends RecommendOptions {
	policy?: 'centroid' | 'union' | 'auto';
}

export const DEFAULT_RECOMMEND_OPTIONS: Required<
	Omit<RecommendOptions, 'weights' | 'excludeMovieIds' | 'filters'>
> & {
	weights: Record<string, number>;
	excludeMovieIds: ReadonlySet<string>;
} = {
	k: 20,
	mmrLambda: 0.7,
	qualityFloor: 0,
	excludeWatched: false,
	excludeSameGroup: true,
	perDirectorCap: 2,
	weights: {
		'content-vector': 0.3,
		'external-cache': 0.3,
		embedding: 0.25,
		'llm-rerank': 0.15,
	},
	excludeMovieIds: new Set<string>(),
};

/**
 * Helper: parse a movies+metadata row pair into a `MovieWithMetadata`.
 * Tolerates missing metadata (returns empty arrays) so cold-start
 * movies still flow through the pipeline.
 */
export function hydrate(
	movie: Movie,
	metadata: MovieMetadata | null | undefined,
): MovieWithMetadata {
	const parseArr = (v: string | null | undefined): string[] => {
		if (!v) return [];
		try {
			const p = JSON.parse(v);
			return Array.isArray(p) ? p.map((x) => String(x)) : [];
		} catch {
			return [];
		}
	};
	return {
		id: movie.id,
		title: movie.title,
		year: movie.year ?? null,
		posterUrl: movie.posterUrl ?? null,
		overview: movie.overview ?? null,
		runtimeMinutes: movie.runtimeMinutes ?? null,
		tmdbId: movie.tmdbId ?? null,
		imdbId: movie.imdbId ?? null,
		hidden: movie.hidden ?? null,
		groupId: movie.groupId ?? null,
		addedAt: movie.addedAt,
		genres: parseArr(metadata?.genres),
		cast: parseArr(metadata?.cast),
		directors: parseArr(metadata?.directors),
		keywords: parseArr(metadata?.keywords),
		companies: parseArr(metadata?.productionCompanies),
		tmdbRating: metadata?.tmdbRating ?? null,
		imdbRating: metadata?.imdbRating ?? null,
	};
}
