import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { movieExternalRecs } from '../../database/schema/index.js';
import type { MovieWithMetadata, StrategyResult, StrategyScore } from '../types.js';
import type { SimilarityStrategy } from './strategy.interface.js';

/**
 * Reads cached external recommendations (`movie_external_recs`) and
 * scores in-library candidates that match. Scoring is rank-driven:
 * higher position in the source list → higher score, with a gentle
 * decay across positions and a small per-source weight so multiple
 * sources reinforce each other.
 *
 * The cache is populated by the metadata pipeline (TMDB
 * `similar`/`recommendations` come back inline in `append_to_response`
 * — no extra HTTP call). Phase 2's Trakt provider will add a
 * `trakt_related` source through the same table.
 */
@Injectable()
export class ExternalCacheStrategy implements SimilarityStrategy {
	readonly name = 'external-cache';

	/** Per-source weight when blending into the single 0..1 output. */
	private readonly sourceWeights: Record<string, number> = {
		tmdb_similar: 0.5,
		tmdb_rec: 0.5,
		trakt_related: 0.7,
	};

	constructor(private readonly database: DatabaseService) {}

	available(): boolean {
		return true;
	}

	async score(
		seed: MovieWithMetadata,
		candidates: MovieWithMetadata[],
	): Promise<StrategyResult> {
		const rows = this.database.db
			.select({
				source: movieExternalRecs.source,
				rank: movieExternalRecs.rank,
				targetMovieId: movieExternalRecs.targetMovieId,
				targetTmdb: movieExternalRecs.targetTmdb,
				targetImdb: movieExternalRecs.targetImdb,
			})
			.from(movieExternalRecs)
			.where(eq(movieExternalRecs.movieId, seed.id))
			.all();

		if (rows.length === 0) return { strategy: this.name, scores: [] };

		// Build candidate lookup
		const byId = new Map<string, MovieWithMetadata>();
		const byTmdb = new Map<number, MovieWithMetadata>();
		const byImdb = new Map<string, MovieWithMetadata>();
		for (const c of candidates) {
			byId.set(c.id, c);
			if (c.tmdbId != null) byTmdb.set(c.tmdbId, c);
			if (c.imdbId) byImdb.set(c.imdbId, c);
		}

		const accum = new Map<string, { score: number; sources: Set<string> }>();
		for (const row of rows) {
			const match =
				(row.targetMovieId ? byId.get(row.targetMovieId) : null) ??
				(row.targetTmdb != null ? byTmdb.get(row.targetTmdb) : null) ??
				(row.targetImdb ? byImdb.get(row.targetImdb) : null) ??
				null;
			if (!match || match.id === seed.id) continue;

			// Reciprocal rank with a soft floor at rank 20
			const rankScore = 1 / (1 + Math.min(row.rank, 20) / 4);
			const srcWeight = this.sourceWeights[row.source] ?? 0.3;
			const contribution = rankScore * srcWeight;

			const existing = accum.get(match.id);
			if (existing) {
				existing.score = Math.max(existing.score, contribution);
				existing.sources.add(row.source);
			} else {
				accum.set(match.id, { score: contribution, sources: new Set([row.source]) });
			}
		}

		const scores: StrategyScore[] = [];
		for (const [movieId, { score, sources }] of accum) {
			scores.push({
				movieId,
				score: Math.min(score, 1),
				reasons: [`Recommended by ${sourceLabel(Array.from(sources))}`],
			});
		}
		scores.sort((a, b) => b.score - a.score);
		return { strategy: this.name, scores };
	}
}

function sourceLabel(sources: string[]): string {
	const friendly = sources.map((s) => {
		if (s === 'tmdb_similar' || s === 'tmdb_rec') return 'TMDB';
		if (s === 'trakt_related') return 'Trakt';
		return s;
	});
	return Array.from(new Set(friendly)).join(' + ');
}
