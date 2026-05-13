import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MiniLMLocalEmbedder } from './embedders/minilm-local.embedder.js';
import { EmbeddingsService } from './embeddings.service.js';

/**
 * Embeddings module — registers the local MiniLM embedder with the
 * provider platform, exposes `EmbeddingsService` for any consumer
 * that needs to embed text or run a KNN search.
 *
 * Marked `@Global()` so the recommendations module can inject
 * `EmbeddingsService` without import gymnastics.
 */
@Global()
@Module({
	imports: [DatabaseModule],
	providers: [MiniLMLocalEmbedder, EmbeddingsService],
	exports: [MiniLMLocalEmbedder, EmbeddingsService],
})
export class EmbeddingsModule {}
