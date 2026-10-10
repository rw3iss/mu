/**
 * Pure scoring for music discovery (no DB / IO) — unit-tested in isolation.
 *
 * The local strategy is a content vector over genres + era + artist overlap:
 * seeds build a {@link SeedProfile}; each library album is scored against it.
 */

export interface SeedProfile {
	/** genre (normalised lower-case) → weight, L2-normalised by {@link cosine}. */
	genres: Map<string, number>;
	artistIds: Set<string>;
	years: number[];
	/** Entities that ARE the seeds — never recommended back. */
	excludeAlbumIds: Set<string>;
	excludeArtistIds: Set<string>;
	excludeTrackIds: Set<string>;
}

export interface AlbumCandidate {
	id: string;
	genres: string[];
	artistIds: string[];
	year: number | null;
}

export const LOCAL_WEIGHTS = { genre: 0.6, artist: 0.25, era: 0.15 } as const;
/** Half-distance (years) at which era similarity falls to ~0.37. */
const ERA_SCALE = 8;

export function emptyProfile(): SeedProfile {
	return {
		genres: new Map(),
		artistIds: new Set(),
		years: [],
		excludeAlbumIds: new Set(),
		excludeArtistIds: new Set(),
		excludeTrackIds: new Set(),
	};
}

export function addGenres(profile: SeedProfile, genres: string[], weight = 1): void {
	for (const g of genres) {
		const k = g.trim().toLowerCase();
		if (k) profile.genres.set(k, (profile.genres.get(k) ?? 0) + weight);
	}
}

/** Cosine similarity between a weighted genre map and a candidate's (binary) genre set. */
export function cosine(weights: Map<string, number>, genres: string[]): number {
	if (!weights.size || !genres.length) return 0;
	const set = new Set(genres.map((g) => g.toLowerCase()));
	let dot = 0;
	let norm = 0;
	for (const [g, w] of weights) {
		norm += w * w;
		if (set.has(g)) dot += w;
	}
	return norm ? dot / (Math.sqrt(norm) * Math.sqrt(set.size)) : 0;
}

/** Era similarity: closeness of the candidate year to the nearest seed year. */
export function eraSimilarity(years: number[], year: number | null): number {
	if (year == null || !years.length) return 0;
	const d = Math.min(...years.map((y) => Math.abs(y - year)));
	return Math.exp(-d / ERA_SCALE);
}

export interface LocalScore {
	score: number;
	reasons: string[];
}

export function scoreAlbum(profile: SeedProfile, c: AlbumCandidate): LocalScore {
	const g = cosine(profile.genres, c.genres);
	const shared = c.artistIds.some((a) => profile.artistIds.has(a));
	const era = eraSimilarity(profile.years, c.year);
	const score =
		LOCAL_WEIGHTS.genre * g + LOCAL_WEIGHTS.artist * (shared ? 1 : 0) + LOCAL_WEIGHTS.era * era;
	const reasons: string[] = [];
	if (g > 0) {
		const common = c.genres.filter((x) => profile.genres.has(x.toLowerCase())).slice(0, 3);
		if (common.length) reasons.push(`Shares genres: ${common.join(', ')}`);
	}
	if (shared) reasons.push('Same artist');
	if (era >= 0.6 && c.year != null) reasons.push(`Same era (${c.year})`);
	return { score, reasons };
}

/**
 * Noisy-OR blend of per-strategy scores: 1 − Π(1 − wᵢ·sᵢ). Agreement between
 * strategies lifts an item above any single strategy, and the result stays in 0..1.
 */
export function blendScores(parts: Array<{ weight: number; score: number }>): number {
	let miss = 1;
	for (const p of parts) miss *= 1 - Math.max(0, Math.min(1, p.weight * p.score));
	return 1 - miss;
}

/** Normalise ListenBrainz raw similarity scores (unbounded counts) to 0..1 by the max. */
export function normaliseByMax<T extends { score: number }>(items: T[]): T[] {
	const max = Math.max(0, ...items.map((i) => i.score));
	return max > 0 ? items.map((i) => ({ ...i, score: i.score / max })) : items;
}
