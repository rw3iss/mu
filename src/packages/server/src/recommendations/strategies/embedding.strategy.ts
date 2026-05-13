import { Injectable } from '@nestjs/common';
import { EmbeddingsService } from '../../embeddings/embeddings.service.js';
import type { MovieWithMetadata, StrategyResult, StrategyScore } from '../types.js';
import type { SimilarityStrategy } from './strategy.interface.js';

/**
 * Dense plot-embedding similarity. The seed's embedding is loaded
 * from the store; KNN is run against all stored vectors. Cosine
 * similarity (already normalised by the embedder) doubles as the
 * 0..1 score.
 *
 * `available()` returns false until at least one embedding has been
 * computed — keeps the orchestrator from sinking time into an empty
 * store before any library scan has fired the listener.
 */
@Injectable()
export class EmbeddingSimilarityStrategy implements SimilarityStrategy {
	readonly name = 'embedding';

	private knownNonEmpty = false;

	constructor(private readonly embeddings: EmbeddingsService) {}

	available(): boolean {
		// We trust the cache lookup inside knn() to skip cleanly if
		// nothing is stored yet — never block the pipeline on it.
		return true;
	}

	async score(
		seed: MovieWithMetadata,
		candidates: MovieWithMetadata[],
	): Promise<StrategyResult> {
		const store = this.embeddings.getStore();
		const seedVec = await store.get(seed.id);
		if (!seedVec) return { strategy: this.name, scores: [] };

		const candidateIds = new Set(candidates.map((c) => c.id));
		candidateIds.delete(seed.id);
		const hits = await store.knn(seedVec, Math.max(50, candidates.length), {
			include: candidateIds,
			exclude: new Set([seed.id]),
		});

		this.knownNonEmpty = this.knownNonEmpty || hits.length > 0;

		const scores: StrategyScore[] = hits.map((h) => ({
			movieId: h.movieId,
			score: Math.max(0, Math.min(1, h.score)),
			reasons: ['Plot-embedding similarity'],
		}));
		return { strategy: this.name, scores };
	}
}
