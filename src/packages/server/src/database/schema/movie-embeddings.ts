import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Per-(movie, model) plot embedding vectors. Stored as Float32 BLOBs
 * for v1; an `EmbeddingStore` interface keeps this hidden behind a
 * portable contract so future migration to `sqlite-vec` or `pgvector`
 * doesn't ripple through callers.
 *
 * `source_text_hash` lets the embedder short-circuit re-embedding
 * when the plot text hasn't changed since the last run.
 */
export const movieEmbeddings = sqliteTable(
	'movie_embeddings',
	{
		movieId: text('movie_id').notNull(),
		model: text('model').notNull(),
		dim: integer('dim').notNull(),
		vector: blob('vector', { mode: 'buffer' }).notNull(),
		sourceTextHash: text('source_text_hash'),
		updatedAt: text('updated_at').notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.movieId, table.model] }),
	}),
);

export type MovieEmbedding = typeof movieEmbeddings.$inferSelect;
export type NewMovieEmbedding = typeof movieEmbeddings.$inferInsert;
