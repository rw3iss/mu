/**
 * Portable contract for vector storage. Keeps SQLite-specific BLOB
 * encoding (v1) hidden so future migration to `sqlite-vec` or
 * `pgvector` is purely a swap of the registered implementation.
 *
 * Float32Array on the wire — every consumer (similarity strategy,
 * KNN, MMR) operates on the same numeric format regardless of how
 * the vector was persisted.
 */

export interface KnnHit {
	movieId: string;
	score: number; // cosine similarity, 0..1
}

export interface KnnFilter {
	/** If provided, only return movies whose id is in this set. */
	include?: ReadonlySet<string>;
	/** Movie ids to never return (e.g. the seed itself). */
	exclude?: ReadonlySet<string>;
}

export abstract class EmbeddingStore {
	abstract readonly model: string;
	abstract readonly dim: number;

	abstract upsert(movieId: string, vector: Float32Array, sourceTextHash?: string): Promise<void>;
	abstract get(movieId: string): Promise<Float32Array | null>;
	abstract knn(query: Float32Array, k: number, filter?: KnnFilter): Promise<KnnHit[]>;

	/** Did we already embed this movie+model with this exact source text? */
	abstract isFresh(movieId: string, sourceTextHash: string): Promise<boolean>;

	abstract delete(movieId: string): Promise<void>;
	abstract count(): Promise<number>;
}
