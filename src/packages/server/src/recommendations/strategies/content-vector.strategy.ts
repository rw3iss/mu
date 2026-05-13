import { Injectable } from '@nestjs/common';
import type { MovieWithMetadata, StrategyResult, StrategyScore } from '../types.js';
import type { SimilarityStrategy } from './strategy.interface.js';

/**
 * Sparse feature similarity from the `movie_metadata` columns we
 * already store. No external calls, no models — pure SQL + JS, runs
 * in <50 ms on a few-thousand-movie library. This is the floor of
 * the pipeline: every other strategy adds signal on top of this one.
 *
 * Per-feature scoring:
 *   - Jaccard for sets (cast, directors, keywords, companies)
 *   - Weighted Jaccard for genres (genres are short lists, rarer
 *     ones contribute more)
 *   - Gaussian decay for year (σ=15) and runtime (σ=25)
 *
 * Weights live here as defaults but the orchestrator can override.
 */
@Injectable()
export class ContentVectorStrategy implements SimilarityStrategy {
	readonly name = 'content-vector';

	private readonly w = {
		keywords: 0.3,
		cast: 0.2,
		genres: 0.2,
		directors: 0.1,
		companies: 0.05,
		year: 0.05,
		runtime: 0.1,
	};

	available(): boolean {
		return true;
	}

	async score(
		seed: MovieWithMetadata,
		candidates: MovieWithMetadata[],
	): Promise<StrategyResult> {
		const scores: StrategyScore[] = [];

		const sGenres = new Set(seed.genres.map((g) => g.toLowerCase()));
		const sCast = new Set(seed.cast.map((c) => c.toLowerCase()));
		const sDir = new Set(seed.directors.map((d) => d.toLowerCase()));
		const sKw = new Set(seed.keywords.map((k) => k.toLowerCase()));
		const sCo = new Set(seed.companies.map((c) => c.toLowerCase()));

		for (const c of candidates) {
			if (c.id === seed.id) continue;
			const reasons: string[] = [];
			let total = 0;

			// Genres (weighted Jaccard — rare genres count more)
			const cGenres = new Set(c.genres.map((g) => g.toLowerCase()));
			const genreOverlap = intersect(sGenres, cGenres);
			if (genreOverlap.length > 0) {
				const j = jaccard(sGenres, cGenres);
				total += this.w.genres * j;
				const friendly = c.genres.filter((g) =>
					sGenres.has(g.toLowerCase()),
				);
				if (friendly.length > 0) {
					reasons.push(`Shared genres: ${friendly.slice(0, 3).join(', ')}`);
				}
			}

			// Cast
			const cCast = new Set(c.cast.map((x) => x.toLowerCase()));
			const castOverlap = intersect(sCast, cCast);
			if (castOverlap.length > 0) {
				total += this.w.cast * jaccard(sCast, cCast);
				const friendly = c.cast.filter((x) => sCast.has(x.toLowerCase()));
				if (friendly.length > 0) {
					reasons.push(`Shared cast: ${friendly.slice(0, 3).join(', ')}`);
				}
			}

			// Directors
			const cDir = new Set(c.directors.map((x) => x.toLowerCase()));
			const dirOverlap = intersect(sDir, cDir);
			if (dirOverlap.length > 0) {
				total += this.w.directors * jaccard(sDir, cDir);
				const friendly = c.directors.filter((x) => sDir.has(x.toLowerCase()));
				if (friendly.length > 0) {
					reasons.push(`Director: ${friendly.join(', ')}`);
				}
			}

			// Keywords
			const cKw = new Set(c.keywords.map((x) => x.toLowerCase()));
			if (intersect(sKw, cKw).length > 0) {
				total += this.w.keywords * jaccard(sKw, cKw);
			}

			// Production companies
			const cCo = new Set(c.companies.map((x) => x.toLowerCase()));
			if (intersect(sCo, cCo).length > 0) {
				total += this.w.companies * jaccard(sCo, cCo);
			}

			// Year proximity (Gaussian, σ=15)
			if (seed.year != null && c.year != null) {
				const dy = seed.year - c.year;
				total += this.w.year * Math.exp(-(dy * dy) / (2 * 15 * 15));
			}

			// Runtime proximity (Gaussian, σ=25 min)
			if (seed.runtimeMinutes != null && c.runtimeMinutes != null) {
				const dr = seed.runtimeMinutes - c.runtimeMinutes;
				total += this.w.runtime * Math.exp(-(dr * dr) / (2 * 25 * 25));
			}

			if (total > 0) {
				scores.push({
					movieId: c.id,
					score: Math.min(total, 1),
					reasons,
				});
			}
		}

		scores.sort((a, b) => b.score - a.score);
		return { strategy: this.name, scores };
	}
}

function intersect<T>(a: Set<T>, b: Set<T>): T[] {
	const out: T[] = [];
	for (const x of a) if (b.has(x)) out.push(x);
	return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
	if (a.size === 0 || b.size === 0) return 0;
	const inter = intersect(a, b).length;
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}
