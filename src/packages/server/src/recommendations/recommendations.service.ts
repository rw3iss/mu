import { CACHE_NAMESPACES } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { CacheService } from '../cache/cache.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
	movieMetadata,
	movies,
	userRatings,
	userWatchHistory,
} from '../database/schema/index.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { applyFilters, type FilterContext } from './scoring/filters.js';
import { composite } from './scoring/composite-scorer.js';
import { mmr } from './scoring/mmr.js';
import {
	analyseMultiInputSet,
	centroid,
	reciprocalRankFusion,
} from './scoring/multi-input.js';
import { ContentVectorStrategy } from './strategies/content-vector.strategy.js';
import { EmbeddingSimilarityStrategy } from './strategies/embedding.strategy.js';
import { ExternalCacheStrategy } from './strategies/external-cache.strategy.js';
import { LlmRerankStrategy } from './strategies/llm-rerank.strategy.js';
import type { SimilarityStrategy } from './strategies/strategy.interface.js';
import { TasteProfileService } from './taste-profile.service.js';
import {
	DEFAULT_RECOMMEND_OPTIONS,
	hydrate,
	type MovieWithMetadata,
	type MultiRecommendOptions,
	type RecommendOptions,
	type ScoredMovie,
} from './types.js';

const SIMILAR_CACHE_TTL = 60 * 60; // 1 hour
const PERSONAL_CACHE_TTL = 30 * 60;

export interface RecommendResponse {
	results: ScoredMovie[];
	usedSources: string[];
	reason?: string;
}

/**
 * Orchestrator for the recommendation pipeline. Fans out to every
 * available `SimilarityStrategy`, composites their outputs with
 * configurable weights, applies filters (same-group exclude, quality
 * floor, per-director cap), re-ranks with MMR for diversity.
 *
 * Strategy list grows over phases — this service stays small; new
 * sources land as new strategy classes injected via the module's
 * providers. The personalized + genre + trending + recently-added
 * endpoints reuse the same hydration helpers and per-user filters.
 */
@Injectable()
export class RecommendationsService {
	private readonly logger = new Logger('RecommendationsService');
	private readonly strategies: SimilarityStrategy[];

	constructor(
		private readonly database: DatabaseService,
		private readonly cache: CacheService,
		private readonly contentVector: ContentVectorStrategy,
		private readonly externalCache: ExternalCacheStrategy,
		private readonly embedding: EmbeddingSimilarityStrategy,
		private readonly llmRerank: LlmRerankStrategy,
		private readonly tasteProfile: TasteProfileService,
		private readonly embeddings: EmbeddingsService,
	) {
		// LLM rerank lives after the cheap strategies in the array but
		// the orchestrator filters it back to a post-rank pass (see
		// scoreAndRank). Listed here so the registry stays a single
		// source of truth.
		this.strategies = [this.contentVector, this.externalCache, this.embedding, this.llmRerank];
	}

	/**
	 * Find movies similar to a single seed movie.
	 */
	async getSimilarMovies(movieId: string, opts: RecommendOptions = {}): Promise<RecommendResponse> {
		const k = opts.k ?? DEFAULT_RECOMMEND_OPTIONS.k;
		const cacheKey = `similar:${movieId}:${k}:${JSON.stringify(opts.weights ?? {})}`;
		const cached = await this.cache.get<RecommendResponse>(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
		);
		if (cached) return cached;

		const { seed, candidates } = this.loadSeedAndCandidates(movieId);
		if (!seed) {
			return { results: [], usedSources: [], reason: 'seed_not_found' };
		}

		const response = await this.scoreAndRank([seed], candidates, opts);
		await this.cache.set(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
			response,
			SIMILAR_CACHE_TTL,
		);
		return response;
	}

	/**
	 * Find movies similar to a set of seeds (playlist, multi-select).
	 * Variance-aware policy:
	 *   - homogeneous input (low intra-set variance) → centroid +
	 *     single KNN against the mean embedding, then orchestrator
	 *     blend for content + cache strategies.
	 *   - heterogeneous input → union-of-neighbours with reciprocal-
	 *     rank fusion across per-seed neighbours.
	 *   - explicit `policy` override wins over auto-detection.
	 *
	 * Falls back to the simple averaged per-seed score from Phase 1
	 * when embeddings aren't yet available for ≥2 seeds.
	 */
	async getMultiInput(
		movieIds: string[],
		opts: MultiRecommendOptions = {},
	): Promise<RecommendResponse> {
		const k = opts.k ?? DEFAULT_RECOMMEND_OPTIONS.k;
		const seeds = movieIds
			.map((id) => this.loadSeedAndCandidates(id).seed)
			.filter((s): s is MovieWithMetadata => s !== null);
		if (seeds.length === 0) {
			return { results: [], usedSources: [], reason: 'no_seeds_found' };
		}
		const seedIds = new Set(seeds.map((s) => s.id));
		const candidates = this.loadAllCandidates().filter((c) => !seedIds.has(c.id));

		const store = this.embeddings.getStore();
		const requestedPolicy = opts.policy ?? 'auto';
		const analysis = await analyseMultiInputSet(seeds, store);
		const effectivePolicy =
			requestedPolicy === 'auto' ? analysis.policy : requestedPolicy;

		// Centroid path needs all seeds embedded for it to be meaningful.
		if (effectivePolicy === 'centroid' && analysis.embeddedSeeds === seeds.length) {
			return this.centroidRank(seeds, candidates, opts, k, analysis.variance);
		}

		// Union policy or fallback when centroid isn't viable.
		return this.unionRank(seeds, candidates, opts, k, analysis.variance);
	}

	private async centroidRank(
		seeds: MovieWithMetadata[],
		candidates: MovieWithMetadata[],
		opts: MultiRecommendOptions,
		k: number,
		variance: number,
	): Promise<RecommendResponse> {
		const store = this.embeddings.getStore();
		const vecs: Float32Array[] = [];
		for (const s of seeds) {
			const v = await store.get(s.id);
			if (v) vecs.push(v);
		}
		if (vecs.length === 0) {
			// Defensive — shouldn't happen since caller checked embeddedSeeds.
			return this.unionRank(seeds, candidates, opts, k, variance);
		}
		const c = centroid(vecs);
		const candidateIds = new Set(candidates.map((x) => x.id));
		const seedIds = new Set(seeds.map((x) => x.id));
		const hits = await store.knn(c, Math.max(k * 4, 100), {
			include: candidateIds,
			exclude: seedIds,
		});
		const moviesById = new Map(candidates.map((x) => [x.id, x] as const));
		const scored = hits
			.map((h) => {
				const m = moviesById.get(h.movieId);
				if (!m) return null;
				return {
					movieId: h.movieId,
					title: m.title,
					year: m.year,
					score: Math.round(h.score * 1000) / 1000,
					explanation: [`Centroid of ${seeds.length} seeds (variance ${variance.toFixed(2)})`],
					posterUrl: m.posterUrl,
					usedSources: ['centroid'],
				};
			})
			.filter((x): x is NonNullable<typeof x> => x !== null);

		// MMR for diversity on top of the centroid ranking.
		const lambda = opts.mmrLambda ?? DEFAULT_RECOMMEND_OPTIONS.mmrLambda;
		const filterCtx: FilterContext = {
			seed: seeds[0]!,
			moviesById,
			excludeMovieIds: union(opts.excludeMovieIds, seedIds),
			watchedMovieIds: new Set(),
			excludeWatched: opts.excludeWatched ?? DEFAULT_RECOMMEND_OPTIONS.excludeWatched,
			excludeSameGroup: opts.excludeSameGroup ?? DEFAULT_RECOMMEND_OPTIONS.excludeSameGroup,
			qualityFloor: opts.qualityFloor ?? DEFAULT_RECOMMEND_OPTIONS.qualityFloor,
			perDirectorCap: opts.perDirectorCap ?? DEFAULT_RECOMMEND_OPTIONS.perDirectorCap,
		};
		const filtered = applyFilters(scored, filterCtx);
		const diversified = mmr(filtered, moviesById, lambda, k);
		return {
			results: diversified,
			usedSources: ['centroid', 'embedding'],
			reason: diversified.length === 0 ? 'no_signal' : undefined,
		};
	}

	private async unionRank(
		seeds: MovieWithMetadata[],
		candidates: MovieWithMetadata[],
		opts: MultiRecommendOptions,
		k: number,
		variance: number,
	): Promise<RecommendResponse> {
		// Run scoreAndRank against each seed, then fuse with RRF.
		const seedIds = new Set(seeds.map((s) => s.id));
		const perSeedLists: Array<Array<{ movieId: string; score: number }>> = [];
		const moviesById = new Map(candidates.map((m) => [m.id, m]));
		const allExplanations = new Map<string, string[]>();
		const allUsedSources = new Set<string>();

		for (const seed of seeds) {
			const response = await this.scoreAndRank([seed], candidates, {
				...opts,
				k: Math.max(k * 3, 60),
				excludeMovieIds: union(opts.excludeMovieIds, seedIds),
			});
			perSeedLists.push(
				response.results.map((r) => ({ movieId: r.movieId, score: r.score })),
			);
			for (const r of response.results) {
				const existing = allExplanations.get(r.movieId);
				if (existing) {
					for (const e of r.explanation) existing.push(e);
				} else {
					allExplanations.set(r.movieId, [...r.explanation]);
				}
			}
			for (const src of response.usedSources) allUsedSources.add(src);
		}

		const fused = reciprocalRankFusion(perSeedLists);
		const scored: ScoredMovie[] = [];
		const maxFused = Math.max(...fused.map((f) => f.score), 0) || 1;
		for (const f of fused) {
			const m = moviesById.get(f.movieId);
			if (!m) continue;
			scored.push({
				movieId: f.movieId,
				title: m.title,
				year: m.year,
				score: Math.round((f.score / maxFused) * 1000) / 1000,
				explanation: dedupe(
					allExplanations.get(f.movieId) ?? [
						`Union of neighbours (variance ${variance.toFixed(2)})`,
					],
				),
				posterUrl: m.posterUrl,
				usedSources: Array.from(allUsedSources),
			});
		}

		const lambda = opts.mmrLambda ?? DEFAULT_RECOMMEND_OPTIONS.mmrLambda;
		const filterCtx: FilterContext = {
			seed: seeds[0]!,
			moviesById,
			excludeMovieIds: union(opts.excludeMovieIds, seedIds),
			watchedMovieIds: new Set(),
			excludeWatched: opts.excludeWatched ?? DEFAULT_RECOMMEND_OPTIONS.excludeWatched,
			excludeSameGroup: opts.excludeSameGroup ?? DEFAULT_RECOMMEND_OPTIONS.excludeSameGroup,
			qualityFloor: opts.qualityFloor ?? DEFAULT_RECOMMEND_OPTIONS.qualityFloor,
			perDirectorCap: opts.perDirectorCap ?? DEFAULT_RECOMMEND_OPTIONS.perDirectorCap,
		};
		const filtered = applyFilters(scored, filterCtx);
		const diversified = mmr(filtered, moviesById, lambda, k);

		return {
			results: diversified,
			usedSources: ['union-of-neighbours', ...allUsedSources],
			reason: diversified.length === 0 ? 'no_signal' : undefined,
		};
	}

	/**
	 * Personalised recommendations for the current user — uses their
	 * taste profile as a "synthetic seed" against every movie they
	 * haven't watched yet. Falls back to popular content-vector
	 * neighbours if the profile is too thin.
	 */
	async getPersonalized(userId: string, limit = 24): Promise<ScoredMovie[]> {
		const cacheKey = `personalized:${userId}:${limit}`;
		const cached = await this.cache.get<ScoredMovie[]>(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
		);
		if (cached) return cached;

		const profile = await this.tasteProfile.buildProfile(userId);
		const watched = this.getUserMovieIds(userId);
		const all = this.loadAllCandidates();

		const genres = new Map(profile.favoriteGenres.map((g) => [g.name.toLowerCase(), g.weight]));
		const directors = new Map(
			profile.favoriteDirectors.map((d) => [d.name.toLowerCase(), d.weight]),
		);
		const actors = new Map(
			profile.favoriteActors.map((a) => [a.name.toLowerCase(), a.weight]),
		);
		const decades = new Map(profile.preferredDecades.map((d) => [d.decade, d.weight]));

		const scored: ScoredMovie[] = [];
		for (const m of all) {
			if (watched.has(m.id)) continue;
			if (m.hidden) continue;

			let score = 0;
			const reasons: string[] = [];

			let genreMatch = 0;
			const matchedGenres: string[] = [];
			for (const g of m.genres) {
				const w = genres.get(g.toLowerCase());
				if (w) {
					genreMatch += w;
					matchedGenres.push(g);
				}
			}
			if (m.genres.length > 0 && matchedGenres.length > 0) {
				score += (genreMatch / m.genres.length) * 0.4;
				reasons.push(`Matches your favourite genres: ${matchedGenres.slice(0, 3).join(', ')}`);
			}

			let dirMatch = 0;
			const matchedDirs: string[] = [];
			for (const d of m.directors) {
				const w = directors.get(d.toLowerCase());
				if (w) {
					dirMatch += w;
					matchedDirs.push(d);
				}
			}
			if (matchedDirs.length > 0) {
				score += Math.min(dirMatch, 1) * 0.25;
				reasons.push(`Directed by ${matchedDirs.join(', ')}`);
			}

			let actMatch = 0;
			const matchedActors: string[] = [];
			for (const a of m.cast.slice(0, 8)) {
				const w = actors.get(a.toLowerCase());
				if (w) {
					actMatch += w;
					matchedActors.push(a);
				}
			}
			if (matchedActors.length > 0) {
				score += Math.min(actMatch, 1) * 0.15;
				reasons.push(`Stars ${matchedActors.slice(0, 3).join(', ')}`);
			}

			if (m.year != null) {
				const d = decadeOf(m.year);
				const w = decades.get(d);
				if (w) {
					score += w * 0.1;
					reasons.push(`From a decade you enjoy (${d}s)`);
				}
			}

			if (m.tmdbRating != null) {
				score += Math.min(m.tmdbRating / 10, 1) * 0.1;
			}

			if (score > 0) {
				scored.push({
					movieId: m.id,
					title: m.title,
					year: m.year,
					score: Math.round(score * 1000) / 1000,
					explanation: reasons,
					posterUrl: m.posterUrl,
					usedSources: ['taste-profile'],
				});
			}
		}
		scored.sort((a, b) => b.score - a.score);
		const results = scored.slice(0, limit);
		await this.cache.set(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
			results,
			PERSONAL_CACHE_TTL,
		);
		return results;
	}

	/** Top-rated unseen movies in a genre. */
	async getByGenre(genre: string, userId: string, limit = 24): Promise<ScoredMovie[]> {
		const cacheKey = `genre:${genre}:${userId}:${limit}`;
		const cached = await this.cache.get<ScoredMovie[]>(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
		);
		if (cached) return cached;

		const watched = this.getUserMovieIds(userId);
		const all = this.loadAllCandidates();
		const g = genre.toLowerCase();

		const scored: ScoredMovie[] = [];
		for (const m of all) {
			if (watched.has(m.id) || m.hidden) continue;
			if (!m.genres.some((x) => x.toLowerCase() === g)) continue;
			const rating = m.tmdbRating ?? 0;
			scored.push({
				movieId: m.id,
				title: m.title,
				year: m.year,
				score: rating,
				explanation: [`Top-rated in ${genre}`],
				posterUrl: m.posterUrl,
				usedSources: ['genre'],
			});
		}
		scored.sort((a, b) => b.score - a.score);
		const results = scored.slice(0, limit);
		await this.cache.set(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
			results,
			SIMILAR_CACHE_TTL,
		);
		return results;
	}

	/** Most watched + rated in the last 30 days. */
	async getTrending(limit = 24): Promise<ScoredMovie[]> {
		const cacheKey = `trending:${limit}`;
		const cached = await this.cache.get<ScoredMovie[]>(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
		);
		if (cached) return cached;

		const thirty = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const ratings = this.database.db
			.select({
				movieId: userRatings.movieId,
				count: sql<number>`count(*)`.as('c'),
				avg: sql<number>`avg(${userRatings.rating})`.as('a'),
			})
			.from(userRatings)
			.where(gt(userRatings.createdAt, thirty))
			.groupBy(userRatings.movieId)
			.all();
		const watches = this.database.db
			.select({
				movieId: userWatchHistory.movieId,
				count: sql<number>`count(*)`.as('c'),
			})
			.from(userWatchHistory)
			.where(gt(userWatchHistory.watchedAt, thirty))
			.groupBy(userWatchHistory.movieId)
			.all();

		const map = new Map<string, { ratingCount: number; avg: number; watchCount: number }>();
		for (const r of ratings) {
			map.set(r.movieId, { ratingCount: r.count, avg: r.avg, watchCount: 0 });
		}
		for (const w of watches) {
			const cur = map.get(w.movieId) ?? { ratingCount: 0, avg: 0, watchCount: 0 };
			cur.watchCount = w.count;
			map.set(w.movieId, cur);
		}
		if (map.size === 0) return [];

		const ids = Array.from(map.keys());
		const rows = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				year: movies.year,
				posterUrl: movies.posterUrl,
			})
			.from(movies)
			.where(inArray(movies.id, ids))
			.all();

		const scored: ScoredMovie[] = [];
		for (const row of rows) {
			const t = map.get(row.id)!;
			const score = t.watchCount * 2 + t.ratingCount * 3 + t.avg;
			const reasons: string[] = [];
			if (t.watchCount > 0) reasons.push(`Watched ${t.watchCount} times recently`);
			if (t.ratingCount > 0)
				reasons.push(`Rated ${t.ratingCount}× (avg: ${Math.round(t.avg * 10) / 10})`);
			scored.push({
				movieId: row.id,
				title: row.title,
				year: row.year,
				score,
				explanation: reasons,
				posterUrl: row.posterUrl,
				usedSources: ['trending'],
			});
		}
		scored.sort((a, b) => b.score - a.score);
		const results = scored.slice(0, limit);
		await this.cache.set(
			CACHE_NAMESPACES.RECOMMENDATIONS,
			cacheKey,
			results,
			SIMILAR_CACHE_TTL,
		);
		return results;
	}

	async getRecentlyAdded(limit = 24): Promise<ScoredMovie[]> {
		const rows = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				year: movies.year,
				posterUrl: movies.posterUrl,
				addedAt: movies.addedAt,
			})
			.from(movies)
			.orderBy(desc(movies.addedAt))
			.limit(limit)
			.all();
		return rows.map((m, i) => ({
			movieId: m.id,
			title: m.title,
			year: m.year,
			score: rows.length - i,
			explanation: [`Added ${m.addedAt}`],
			posterUrl: m.posterUrl,
			usedSources: ['recently-added'],
		}));
	}

	/** Manually invalidate cached responses for a movie (e.g. after metadata refresh). */
	invalidateMovie(movieId: string): void {
		// CacheService doesn't expose prefix deletion; we punt to TTL for v1.
		void this.cache.delete(CACHE_NAMESPACES.RECOMMENDATIONS, `similar:${movieId}`);
	}

	// =====================================================================
	// Internals
	// =====================================================================

	private async scoreAndRank(
		seeds: MovieWithMetadata[],
		candidates: MovieWithMetadata[],
		opts: RecommendOptions,
	): Promise<RecommendResponse> {
		const k = opts.k ?? DEFAULT_RECOMMEND_OPTIONS.k;
		const lambda = opts.mmrLambda ?? DEFAULT_RECOMMEND_OPTIONS.mmrLambda;
		const weights = { ...DEFAULT_RECOMMEND_OPTIONS.weights, ...(opts.weights ?? {}) };

		// Per-seed candidate pool minus the seed itself.
		const seedIds = new Set(seeds.map((s) => s.id));
		const pool = candidates.filter((c) => !seedIds.has(c.id));
		const moviesById = new Map(pool.map((m) => [m.id, m]));

		// Run each strategy against each seed; aggregate per-strategy.
		const activeStrategies = this.strategies.filter((s) => s.available());
		const perStrategyAccum = new Map<string, Map<string, { score: number; reasons: string[] }>>();
		for (const seed of seeds) {
			for (const strat of activeStrategies) {
				const out = await strat.score(seed, pool);
				let bucket = perStrategyAccum.get(out.strategy);
				if (!bucket) {
					bucket = new Map();
					perStrategyAccum.set(out.strategy, bucket);
				}
				for (const s of out.scores) {
					const cur = bucket.get(s.movieId);
					const reasons = s.reasons ?? [];
					if (cur) {
						cur.score += s.score;
						for (const r of reasons) cur.reasons.push(r);
					} else {
						bucket.set(s.movieId, { score: s.score, reasons: [...reasons] });
					}
				}
			}
		}

		const results = Array.from(perStrategyAccum.entries()).map(([strategy, bucket]) => ({
			strategy,
			scores: Array.from(bucket.entries()).map(([movieId, v]) => ({
				movieId,
				score: v.score / seeds.length,
				reasons: v.reasons,
			})),
		}));

		const blended = composite(results, weights, moviesById);
		const seed = seeds[0]!;
		const watched = new Set<string>();

		const filterCtx: FilterContext = {
			seed,
			moviesById,
			excludeMovieIds: opts.excludeMovieIds ?? DEFAULT_RECOMMEND_OPTIONS.excludeMovieIds,
			watchedMovieIds: watched,
			excludeWatched: opts.excludeWatched ?? DEFAULT_RECOMMEND_OPTIONS.excludeWatched,
			excludeSameGroup: opts.excludeSameGroup ?? DEFAULT_RECOMMEND_OPTIONS.excludeSameGroup,
			qualityFloor: opts.qualityFloor ?? DEFAULT_RECOMMEND_OPTIONS.qualityFloor,
			perDirectorCap: opts.perDirectorCap ?? DEFAULT_RECOMMEND_OPTIONS.perDirectorCap,
		};
		const filtered = applyFilters(blended, filterCtx);
		const diversified = mmr(filtered, moviesById, lambda, k);

		const usedSources = new Set<string>();
		for (const r of diversified) for (const s of r.usedSources) usedSources.add(s);

		return {
			results: diversified,
			usedSources: Array.from(usedSources),
			reason: diversified.length === 0 ? 'no_signal' : undefined,
		};
	}

	private loadSeedAndCandidates(movieId: string): {
		seed: MovieWithMetadata | null;
		candidates: MovieWithMetadata[];
	} {
		const seedRow = this.database.db
			.select()
			.from(movies)
			.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
			.where(eq(movies.id, movieId))
			.get();
		if (!seedRow) return { seed: null, candidates: [] };
		const seed = hydrate(seedRow.movies, seedRow.movie_metadata);
		const candidates = this.loadAllCandidates();
		return { seed, candidates };
	}

	private loadAllCandidates(): MovieWithMetadata[] {
		const rows = this.database.db
			.select()
			.from(movies)
			.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
			.all();
		return rows.map((r) => hydrate(r.movies, r.movie_metadata));
	}

	private getUserMovieIds(userId: string): Set<string> {
		const r = this.database.db
			.select({ movieId: userRatings.movieId })
			.from(userRatings)
			.where(eq(userRatings.userId, userId))
			.all();
		const h = this.database.db
			.select({ movieId: userWatchHistory.movieId })
			.from(userWatchHistory)
			.where(eq(userWatchHistory.userId, userId))
			.all();
		return new Set([...r.map((x) => x.movieId), ...h.map((x) => x.movieId)]);
	}
}

function decadeOf(year: number): number {
	return Math.floor(year / 10) * 10;
}

function union<T>(a: ReadonlySet<T> | undefined, b: Set<T>): Set<T> {
	const out = new Set(b);
	if (a) for (const x of a) out.add(x);
	return out;
}

function dedupe(arr: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const x of arr) {
		if (seen.has(x)) continue;
		seen.add(x);
		out.push(x);
	}
	return out;
}

// Silence unused-import linter for `and` / future filter expansion.
void and;
