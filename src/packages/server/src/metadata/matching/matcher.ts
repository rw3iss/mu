/**
 * Generic best-match resolver. Used by:
 *   - Movie metadata fetching (matches local movie ↔ TMDB/OMDB results)
 *   - Group metadata fetching (matches a group ↔ TMDB TV / Collection)
 *
 * The scorer is composite: title similarity (Dice's coefficient) +
 * year proximity + duration proximity + popularity tiebreaker. Each
 * component is normalized to 0–1 and weighted, so the final
 * `confidence` is itself 0–1. Callers compare it against fixed
 * thresholds (defaults below) to decide:
 *   - auto-apply
 *   - ambiguous (save candidates, ask user)
 *   - no match
 */

import { titleSimilarity } from './title-normalizer.js';

export interface MatchQuery {
	title: string;
	year?: number | null;
	durationMinutes?: number | null;
}

export interface MatchCandidate {
	title: string;
	year?: number | null;
	runtimeMinutes?: number | null;
	/** TMDB-style popularity score; used as a tiny tiebreaker. */
	popularity?: number | null;
	/** Provider-specific id so the caller can re-find the row. */
	externalId: string | number;
	/** Free-form provenance tag, e.g. 'tmdb', 'omdb', 'tmdb-tv'. */
	provider: string;
	/** Caller-supplied raw row, returned untouched for downstream use. */
	raw?: unknown;
	posterUrl?: string | null;
}

export interface ScoredCandidate<T extends MatchCandidate = MatchCandidate> {
	candidate: T;
	confidence: number;
	titleScore: number;
	yearScore: number;
	durationScore: number;
	yearMatch: boolean;
	titleScoreRaw: number;
}

export interface MatchResult<T extends MatchCandidate = MatchCandidate> {
	best: ScoredCandidate<T> | null;
	/** All candidates, scored and sorted desc by confidence. */
	ranked: ScoredCandidate<T>[];
	/** Set to true when no candidate clears `autoApplyMin` confidently. */
	ambiguous: boolean;
	/** Set to true when nothing is even close (best below `noMatchMax`). */
	noMatch: boolean;
}

export interface MatcherConfig {
	/** Confidence at or above which we auto-apply the top match. */
	autoApplyMin: number;
	/**
	 * Confidence ceiling for "no match — discard entirely." Below this,
	 * we don't even surface candidates.
	 */
	noMatchMax: number;
	/** Weight of title similarity in composite. */
	titleWeight: number;
	yearWeight: number;
	durationWeight: number;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
	autoApplyMin: 0.82,
	noMatchMax: 0.4,
	titleWeight: 0.6,
	yearWeight: 0.3,
	durationWeight: 0.1,
};

/**
 * Year-proximity scorer. Exact match → 1, ±1 → 0.65, ±2 → 0.35, else 0.
 * Returns -1 when we have no year on either side ("unknown"), so the
 * caller can omit year from the composite rather than penalize a movie
 * that genuinely lacks year metadata.
 */
function scoreYear(a: number | null | undefined, b: number | null | undefined): number {
	if (!a || !b) return -1;
	const diff = Math.abs(a - b);
	if (diff === 0) return 1;
	if (diff === 1) return 0.65;
	if (diff === 2) return 0.35;
	return 0;
}

function scoreDuration(
	fileMinutes: number | null | undefined,
	candidateMinutes: number | null | undefined,
): number {
	if (!fileMinutes || !candidateMinutes) return -1;
	const diff = Math.abs(fileMinutes - candidateMinutes);
	if (diff <= 3) return 1;
	if (diff <= 7) return 0.7;
	if (diff <= 15) return 0.35;
	return 0;
}

export function findBestMatch<T extends MatchCandidate>(
	query: MatchQuery,
	candidates: T[],
	config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): MatchResult<T> {
	if (candidates.length === 0) {
		return { best: null, ranked: [], ambiguous: false, noMatch: true };
	}

	const scored: ScoredCandidate<T>[] = candidates.map((c) => {
		const titleScoreRaw = titleSimilarity(query.title, c.title);
		const yearScoreRaw = scoreYear(query.year, c.year);
		const durationScoreRaw = scoreDuration(query.durationMinutes, c.runtimeMinutes);

		// Build composite from only the components we actually have. If
		// year is unknown on either side, drop it (and rebalance weights
		// to title + duration). Same for duration.
		let weightSum = config.titleWeight;
		let composite = titleScoreRaw * config.titleWeight;
		if (yearScoreRaw >= 0) {
			composite += yearScoreRaw * config.yearWeight;
			weightSum += config.yearWeight;
		}
		if (durationScoreRaw >= 0) {
			composite += durationScoreRaw * config.durationWeight;
			weightSum += config.durationWeight;
		}
		let confidence = weightSum > 0 ? composite / weightSum : 0;

		// Popularity tiebreaker — never enough to flip a high-confidence
		// ranking, but breaks ties when two candidates have equal title +
		// year scores.
		if (typeof c.popularity === 'number' && c.popularity > 0) {
			confidence += Math.min(0.02, c.popularity / 5000);
		}

		return {
			candidate: c,
			confidence: Math.min(1, Math.max(0, confidence)),
			titleScore: titleScoreRaw,
			yearScore: yearScoreRaw,
			durationScore: durationScoreRaw,
			yearMatch: yearScoreRaw === 1,
			titleScoreRaw,
		};
	});

	scored.sort((a, b) => b.confidence - a.confidence);
	const top = scored[0]!;

	return {
		best: top,
		ranked: scored,
		ambiguous: top.confidence < config.autoApplyMin && top.confidence >= config.noMatchMax,
		noMatch: top.confidence < config.noMatchMax,
	};
}
