import type { MovieWithMetadata, ScoredMovie } from '../types.js';

export interface FilterContext {
	seed: MovieWithMetadata;
	moviesById: Map<string, MovieWithMetadata>;
	excludeMovieIds: ReadonlySet<string>;
	watchedMovieIds: ReadonlySet<string>;
	excludeWatched: boolean;
	excludeSameGroup: boolean;
	qualityFloor: number;
	perDirectorCap: number;
}

/**
 * Apply post-scoring filters (exclusions, quality floor, per-director
 * cap, hidden movies). Returns a new list — does not mutate.
 *
 * Same-group exclusion is important UX: when the user is on "The Lord
 * of the Rings: Fellowship", we don't want "Two Towers" and "Return
 * of the King" eating slots — those should be surfaced via the group
 * view. The filter compares group_id when set.
 */
export function applyFilters(scored: ScoredMovie[], ctx: FilterContext): ScoredMovie[] {
	const seedGroup = ctx.seed.groupId;
	const directorCount = new Map<string, number>();
	const out: ScoredMovie[] = [];

	for (const s of scored) {
		if (ctx.excludeMovieIds.has(s.movieId)) continue;
		const movie = ctx.moviesById.get(s.movieId);
		if (!movie) continue;
		if (movie.hidden) continue;
		if (movie.id === ctx.seed.id) continue;

		if (ctx.excludeSameGroup && seedGroup && movie.groupId === seedGroup) continue;
		if (ctx.excludeWatched && ctx.watchedMovieIds.has(movie.id)) continue;

		if (ctx.qualityFloor > 0) {
			// Use the highest available rating so a movie with strong
			// IMDB but missing TMDB (or vice versa) doesn't get unfairly
			// dropped. Mirrors the minRating logic in discover-filters.
			const rating = Math.max(movie.tmdbRating ?? 0, movie.imdbRating ?? 0);
			if (rating > 0 && rating < ctx.qualityFloor) continue;
		}

		if (ctx.perDirectorCap > 0 && movie.directors.length > 0) {
			let skip = false;
			for (const d of movie.directors) {
				const key = d.toLowerCase();
				const c = directorCount.get(key) ?? 0;
				if (c >= ctx.perDirectorCap) {
					skip = true;
					break;
				}
			}
			if (skip) continue;
			for (const d of movie.directors) {
				const key = d.toLowerCase();
				directorCount.set(key, (directorCount.get(key) ?? 0) + 1);
			}
		}

		out.push(s);
	}

	return out;
}
