import type { MovieWithMetadata, StrategyResult } from '../types.js';

/**
 * One strategy = one signal source (content overlap, external API
 * cache, embeddings, collaborative filtering). The orchestrator
 * fans out to every available strategy, normalises their outputs,
 * blends them with weights, and applies MMR + filters.
 *
 * Strategies are stateless beyond their own dependencies. They never
 * decide whether to run — that's the orchestrator's job — they just
 * declare what they need via `available()`.
 */
export interface SimilarityStrategy {
	readonly name: string;

	/**
	 * Cheap check ahead of time — returns false if the strategy can't
	 * produce results right now (e.g. external API not configured).
	 * Allows the orchestrator to skip without paying the call cost.
	 */
	available(): boolean;

	/**
	 * Score every candidate against the seed. Scores must be in [0,1]
	 * within this strategy's natural range; the composite scorer
	 * applies cross-strategy normalisation on top.
	 *
	 * The strategy receives the full candidate pool — usually the
	 * library minus the seed minus any callsite exclusions — and
	 * returns only candidates it has a non-zero score for.
	 */
	score(seed: MovieWithMetadata, candidates: MovieWithMetadata[]): Promise<StrategyResult>;
}
