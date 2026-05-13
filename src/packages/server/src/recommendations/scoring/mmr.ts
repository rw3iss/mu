import type { MovieWithMetadata, ScoredMovie } from '../types.js';

/**
 * Maximum Marginal Relevance — re-rank a list to balance relevance
 * with diversity. At each step pick the candidate that maximises:
 *
 *     λ · relevance(d) − (1 − λ) · max_{s in selected} similarity(d, s)
 *
 * `relevance` is the composite score already on each item.
 * `similarity` is a cheap proxy until Phase 3's embeddings land:
 * Jaccard over (genres ∪ directors ∪ top-5 cast).
 *
 * λ near 1 = pure relevance, λ near 0 = pure diversity. The default
 * (0.7) keeps the top of the list strong but breaks up runs of
 * near-duplicates.
 */
export function mmr(
	scored: ScoredMovie[],
	moviesById: Map<string, MovieWithMetadata>,
	lambda: number,
	k: number,
): ScoredMovie[] {
	if (scored.length === 0 || k <= 0) return [];
	if (scored.length <= 1) return scored.slice(0, k);

	const remaining = [...scored];
	const selected: ScoredMovie[] = [];
	const selectedSignatures: Set<string>[] = [];

	// Pre-compute relevance bounds so the relevance term stays in [0,1]
	const maxRel = Math.max(...scored.map((s) => s.score)) || 1;

	while (selected.length < k && remaining.length > 0) {
		let bestIdx = 0;
		let bestScore = -Infinity;

		for (let i = 0; i < remaining.length; i++) {
			const cand = remaining[i]!;
			const rel = cand.score / maxRel;
			const candSig = signature(moviesById.get(cand.movieId));

			let maxSim = 0;
			for (const sig of selectedSignatures) {
				const sim = jaccard(candSig, sig);
				if (sim > maxSim) maxSim = sim;
			}

			const score = lambda * rel - (1 - lambda) * maxSim;
			if (score > bestScore) {
				bestScore = score;
				bestIdx = i;
			}
		}

		const picked = remaining.splice(bestIdx, 1)[0]!;
		selected.push(picked);
		selectedSignatures.push(signature(moviesById.get(picked.movieId)));
	}

	return selected;
}

function signature(m: MovieWithMetadata | undefined): Set<string> {
	if (!m) return new Set();
	const sig = new Set<string>();
	for (const g of m.genres) sig.add(`g:${g.toLowerCase()}`);
	for (const d of m.directors) sig.add(`d:${d.toLowerCase()}`);
	for (const c of m.cast.slice(0, 5)) sig.add(`c:${c.toLowerCase()}`);
	return sig;
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}
