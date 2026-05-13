import type { EmbeddingStore } from '../../embeddings/embedding-store.interface.js';
import type { MovieWithMetadata } from '../types.js';

export interface MultiInputAnalysis {
	variance: number;
	policy: 'centroid' | 'union';
	embeddedSeeds: number;
}

/**
 * Decide whether the input set is homogeneous (use centroid +
 * single KNN pass) or heterogeneous (run per-seed neighbours and
 * fuse with reciprocal-rank scoring).
 *
 * Variance is computed as `1 - mean(pairwise cosine similarity)`
 * over the seed embeddings. Below the threshold = homogeneous.
 * If embeddings aren't available we fall back to a genre-Jaccard
 * proxy so the policy decision is still meaningful before
 * Phase 3's library-wide embedding completes.
 */
export async function analyseMultiInputSet(
	seeds: MovieWithMetadata[],
	store: EmbeddingStore | null,
	homogeneousThreshold = 0.35,
): Promise<MultiInputAnalysis> {
	if (seeds.length <= 1) {
		return { variance: 0, policy: 'centroid', embeddedSeeds: seeds.length };
	}

	const vecs: Float32Array[] = [];
	if (store) {
		for (const s of seeds) {
			const v = await store.get(s.id);
			if (v) vecs.push(v);
		}
	}

	let variance: number;
	if (vecs.length >= 2) {
		variance = 1 - meanPairwiseCosine(vecs);
	} else {
		// No embeddings yet — genre Jaccard fallback. Two seeds that
		// share no genres have variance≈1; identical genres → variance≈0.
		const sets = seeds.map((s) => new Set(s.genres.map((g) => g.toLowerCase())));
		let mean = 0;
		let pairs = 0;
		for (let i = 0; i < sets.length; i++) {
			for (let j = i + 1; j < sets.length; j++) {
				mean += jaccard(sets[i]!, sets[j]!);
				pairs++;
			}
		}
		variance = pairs > 0 ? 1 - mean / pairs : 0;
	}

	return {
		variance,
		policy: variance <= homogeneousThreshold ? 'centroid' : 'union',
		embeddedSeeds: vecs.length,
	};
}

/**
 * Compute the mean (centroid) of a list of equal-length vectors.
 * Caller is responsible for non-empty input.
 */
export function centroid(vecs: Float32Array[]): Float32Array {
	if (vecs.length === 0) throw new Error('centroid() of empty list');
	const dim = vecs[0]!.length;
	const out = new Float32Array(dim);
	for (const v of vecs) {
		for (let i = 0; i < dim; i++) out[i]! += v[i]!;
	}
	for (let i = 0; i < dim; i++) out[i]! /= vecs.length;
	return out;
}

/**
 * Reciprocal-rank fusion — pure ranking-based combination for
 * heterogeneous seeds. Each list contributes 1/(k + rank) to its
 * candidate's score; the candidate's final score is the sum over
 * lists. Used by the union-of-neighbours policy.
 */
export function reciprocalRankFusion(
	lists: Array<Array<{ movieId: string; score: number }>>,
	k = 60,
): Array<{ movieId: string; score: number }> {
	const totals = new Map<string, number>();
	for (const list of lists) {
		list.sort((a, b) => b.score - a.score);
		list.forEach((item, idx) => {
			totals.set(item.movieId, (totals.get(item.movieId) ?? 0) + 1 / (k + idx));
		});
	}
	const out = Array.from(totals.entries()).map(([movieId, score]) => ({ movieId, score }));
	out.sort((a, b) => b.score - a.score);
	return out;
}

function meanPairwiseCosine(vecs: Float32Array[]): number {
	let sum = 0;
	let pairs = 0;
	for (let i = 0; i < vecs.length; i++) {
		for (let j = i + 1; j < vecs.length; j++) {
			sum += cosine(vecs[i]!, vecs[j]!);
			pairs++;
		}
	}
	return pairs === 0 ? 1 : sum / pairs;
}

function cosine(a: Float32Array, b: Float32Array): number {
	const len = Math.min(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < len; i++) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	return denom === 0 ? 0 : dot / denom;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}
