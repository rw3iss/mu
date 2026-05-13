import type { MovieWithMetadata, ScoredMovie, StrategyResult } from '../types.js';

/**
 * Blend the outputs of N strategies into a single ranked list.
 *
 * Per-strategy normalisation: divide every strategy's scores by its
 * own max so the strategies sit on comparable scales before the
 * weighted sum. This matters because different strategies have very
 * different "shapes" — content-vector tops out around 0.6, the
 * external-cache around 0.7 (rank-driven), embeddings closer to 0.9.
 * Without normalisation a strategy with a high natural ceiling would
 * dominate independent of how well it actually matches.
 */
export function composite(
	results: StrategyResult[],
	weights: Record<string, number>,
	candidatesById: Map<string, MovieWithMetadata>,
): ScoredMovie[] {
	const blended = new Map<
		string,
		{ score: number; reasons: string[]; sources: Set<string> }
	>();

	for (const r of results) {
		if (r.scores.length === 0) continue;
		const max = Math.max(...r.scores.map((s) => s.score));
		if (max <= 0) continue;
		const w = weights[r.strategy] ?? 0;
		if (w <= 0) continue;

		for (const s of r.scores) {
			const norm = s.score / max;
			const contrib = norm * w;
			const cur = blended.get(s.movieId);
			if (cur) {
				cur.score += contrib;
				if (s.reasons) for (const reason of s.reasons) cur.reasons.push(reason);
				cur.sources.add(r.strategy);
			} else {
				blended.set(s.movieId, {
					score: contrib,
					reasons: s.reasons ? [...s.reasons] : [],
					sources: new Set([r.strategy]),
				});
			}
		}
	}

	const out: ScoredMovie[] = [];
	for (const [movieId, agg] of blended) {
		const movie = candidatesById.get(movieId);
		if (!movie) continue;
		out.push({
			movieId,
			title: movie.title,
			year: movie.year,
			score: Math.round(agg.score * 1000) / 1000,
			explanation: dedupe(agg.reasons),
			posterUrl: movie.posterUrl,
			usedSources: Array.from(agg.sources),
		});
	}
	out.sort((a, b) => b.score - a.score);
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
