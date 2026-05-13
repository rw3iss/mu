import { Injectable, Logger } from '@nestjs/common';
import { AnthropicClient } from '../../llm/anthropic.client.js';
import type { MovieWithMetadata, StrategyResult, StrategyScore } from '../types.js';
import type { SimilarityStrategy } from './strategy.interface.js';

const MAX_CANDIDATES_TO_RERANK = 30;

/**
 * Optional LLM re-ranker. Runs *after* the cheap strategies; consumes
 * their top-N candidates and asks Claude to reorder them by deeper
 * similarity (tone, theme, plot mechanics). Off by default — only
 * activates when an `LLMClient` (currently Anthropic) is configured
 * AND the orchestrator opts in via the matching settings.
 *
 * Cost-bounded: limited to 30 candidates per call, so a single
 * Haiku request is sub-cent. Budget ceiling enforced by the platform's
 * RateLimitService — when the monthly cap is hit, this strategy
 * returns an empty result and the pipeline falls back gracefully to
 * the upstream blend.
 */
@Injectable()
export class LlmRerankStrategy implements SimilarityStrategy {
	readonly name = 'llm-rerank';
	private readonly logger = new Logger('LlmRerankStrategy');

	constructor(private readonly anthropic: AnthropicClient) {}

	available(): boolean {
		return this.anthropic.isConfigured();
	}

	async score(
		seed: MovieWithMetadata,
		candidates: MovieWithMetadata[],
	): Promise<StrategyResult> {
		if (!this.available() || candidates.length === 0) {
			return { strategy: this.name, scores: [] };
		}

		// Cap the work — this strategy is intended to re-rank top
		// candidates, not the whole library.
		const trimmed = candidates.slice(0, MAX_CANDIDATES_TO_RERANK);
		try {
			const ranked = await this.anthropic.rerank(
				toSeed(seed),
				trimmed.map(toSeed),
				{ withWhy: true },
			);
			const scores: StrategyScore[] = ranked
				.filter((r): r is typeof r & { movieId: string } => typeof r.movieId === 'string')
				.map((r) => ({
					movieId: r.movieId,
					score: Math.max(0, Math.min(1, r.score)),
					reasons: r.explanation ? [r.explanation] : ['LLM-reranked'],
				}));
			return { strategy: this.name, scores };
		} catch (err: any) {
			this.logger.warn(`rerank error: ${err?.message ?? err}`);
			return { strategy: this.name, scores: [] };
		}
	}
}

function toSeed(m: MovieWithMetadata) {
	return {
		id: m.id,
		title: m.title,
		year: m.year,
		tmdbId: m.tmdbId,
		imdbId: m.imdbId,
		overview: m.overview,
		genres: m.genres,
		cast: m.cast.slice(0, 6),
		directors: m.directors,
		keywords: m.keywords.slice(0, 8),
	};
}
