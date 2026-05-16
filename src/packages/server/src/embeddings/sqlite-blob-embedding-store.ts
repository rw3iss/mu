import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieEmbeddings } from '../database/schema/index.js';
import { EmbeddingStore, type KnnFilter, type KnnHit } from './embedding-store.interface.js';

/**
 * Float32-BLOB-backed embedding store. Reasonable up to ~50K vectors
 * with in-memory full-scan cosine (≈50 ms / search). Beyond that,
 * swap in a `sqlite-vec` or `pgvector` implementation that satisfies
 * the same `EmbeddingStore` interface — no callsite changes needed.
 *
 * Vectors are kept warm in a Map so the hot KNN path doesn't pay
 * SQL deserialisation cost per call. Cache is refreshed lazily on
 * `upsert` and invalidated on first miss.
 */
@Injectable()
export class SqliteBlobEmbeddingStore extends EmbeddingStore {
	readonly model: string;
	readonly dim: number;

	private readonly logger = new Logger('SqliteBlobEmbeddingStore');
	private cache: Map<string, Float32Array> | null = null;

	constructor(
		private readonly database: DatabaseService,
		opts: { model: string; dim: number },
	) {
		super();
		this.model = opts.model;
		this.dim = opts.dim;
	}

	async upsert(movieId: string, vector: Float32Array, sourceTextHash?: string): Promise<void> {
		if (vector.length !== this.dim) {
			throw new Error(`Vector dim mismatch: expected ${this.dim}, got ${vector.length}`);
		}
		const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
		const now = nowISO();
		const existing = this.database.db
			.select({ movieId: movieEmbeddings.movieId })
			.from(movieEmbeddings)
			.where(and(eq(movieEmbeddings.movieId, movieId), eq(movieEmbeddings.model, this.model)))
			.get();
		if (existing) {
			this.database.db
				.update(movieEmbeddings)
				.set({
					vector: buf,
					sourceTextHash: sourceTextHash ?? null,
					updatedAt: now,
					dim: this.dim,
				})
				.where(
					and(
						eq(movieEmbeddings.movieId, movieId),
						eq(movieEmbeddings.model, this.model),
					),
				)
				.run();
		} else {
			this.database.db
				.insert(movieEmbeddings)
				.values({
					movieId,
					model: this.model,
					dim: this.dim,
					vector: buf,
					sourceTextHash: sourceTextHash ?? null,
					updatedAt: now,
				})
				.run();
		}
		// Refresh in-memory cache entry only if we've already loaded it.
		if (this.cache) {
			this.cache.set(movieId, vector);
		}
	}

	async get(movieId: string): Promise<Float32Array | null> {
		if (this.cache?.has(movieId)) {
			return this.cache.get(movieId) ?? null;
		}
		const row = this.database.db
			.select({ vector: movieEmbeddings.vector })
			.from(movieEmbeddings)
			.where(and(eq(movieEmbeddings.movieId, movieId), eq(movieEmbeddings.model, this.model)))
			.get();
		if (!row) return null;
		const buf = row.vector as Buffer;
		const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
		return vec;
	}

	async knn(query: Float32Array, k: number, filter?: KnnFilter): Promise<KnnHit[]> {
		const cache = await this.loadCache();
		const qNorm = norm(query);
		if (qNorm === 0) return [];
		const out: KnnHit[] = [];
		for (const [movieId, vec] of cache) {
			if (filter?.exclude?.has(movieId)) continue;
			if (filter?.include && !filter.include.has(movieId)) continue;
			const score = cosine(query, vec, qNorm);
			if (score > 0) out.push({ movieId, score });
		}
		out.sort((a, b) => b.score - a.score);
		return out.slice(0, k);
	}

	async isFresh(movieId: string, sourceTextHash: string): Promise<boolean> {
		const row = this.database.db
			.select({ hash: movieEmbeddings.sourceTextHash })
			.from(movieEmbeddings)
			.where(and(eq(movieEmbeddings.movieId, movieId), eq(movieEmbeddings.model, this.model)))
			.get();
		return !!row && row.hash === sourceTextHash;
	}

	async delete(movieId: string): Promise<void> {
		this.database.db
			.delete(movieEmbeddings)
			.where(and(eq(movieEmbeddings.movieId, movieId), eq(movieEmbeddings.model, this.model)))
			.run();
		this.cache?.delete(movieId);
	}

	async count(): Promise<number> {
		const row = this.database.db
			.select({ c: sql<number>`count(*)`.as('c') })
			.from(movieEmbeddings)
			.where(eq(movieEmbeddings.model, this.model))
			.get();
		return row?.c ?? 0;
	}

	private async loadCache(): Promise<Map<string, Float32Array>> {
		if (this.cache) return this.cache;
		const rows = this.database.db
			.select({
				movieId: movieEmbeddings.movieId,
				vector: movieEmbeddings.vector,
			})
			.from(movieEmbeddings)
			.where(eq(movieEmbeddings.model, this.model))
			.all();
		const cache = new Map<string, Float32Array>();
		for (const r of rows) {
			const buf = r.vector as Buffer;
			const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
			cache.set(r.movieId, vec);
		}
		this.cache = cache;
		this.logger.log(`Loaded ${cache.size} ${this.model} embeddings into memory`);
		return cache;
	}
}

function norm(v: Float32Array): number {
	let s = 0;
	for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
	return Math.sqrt(s);
}

function cosine(a: Float32Array, b: Float32Array, aNorm?: number): number {
	const len = Math.min(a.length, b.length);
	let dot = 0;
	let bn = 0;
	for (let i = 0; i < len; i++) {
		dot += a[i]! * b[i]!;
		bn += b[i]! * b[i]!;
	}
	const an = aNorm ?? norm(a);
	const bnSqrt = Math.sqrt(bn);
	if (an === 0 || bnSqrt === 0) return 0;
	return dot / (an * bnSqrt);
}
