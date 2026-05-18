import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { MiniLMLocalEmbedder } from './embedders/minilm-local.embedder.js';
import { EmbeddingStore } from './embedding-store.interface.js';
import { SqliteBlobEmbeddingStore } from './sqlite-blob-embedding-store.ts';

/**
 * Coordinator that owns the active `EmbeddingStore` and embedder.
 * Other modules inject this rather than embedders directly so the
 * choice of model (or future drop-in like Voyage, OpenAI) is one
 * config change away.
 */
@Injectable()
export class EmbeddingsService {
	private readonly store: EmbeddingStore;

	constructor(
		private readonly database: DatabaseService,
		private readonly embedder: MiniLMLocalEmbedder,
	) {
		this.store = new SqliteBlobEmbeddingStore(this.database, {
			model: embedder.model,
			dim: embedder.dim,
		});
	}

	getStore(): EmbeddingStore {
		return this.store;
	}

	getEmbedder(): MiniLMLocalEmbedder {
		return this.embedder;
	}

	/**
	 * Embed a movie's plot text and persist. Idempotent — short-
	 * circuits if the same text has been embedded for this movie.
	 */
	async embedMovie(movieId: string, text: string): Promise<boolean> {
		const cleaned = text.trim();
		if (cleaned.length === 0) return false;
		const hash = sha1(cleaned);
		if (await this.store.isFresh(movieId, hash)) return false;
		const [vec] = await this.embedder.embed([cleaned]);
		if (!vec) return false;
		await this.store.upsert(movieId, vec, hash);
		return true;
	}

	async forceWarmup(): Promise<void> {
		await this.embedder.warmup();
	}
}

function sha1(input: string): string {
	return createHash('sha1').update(input).digest('hex');
}
