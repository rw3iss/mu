import type { SourceContribution } from '../../providers/merge/merge-types.js';
import type { OmdbData } from '../providers/omdb.provider.js';

/**
 * OMDB-response → canonical {@link SourceContribution} adapter.
 *
 * OMDB returns most fields as comma-separated strings; the engine's
 * `merge-arrays` strategy handles splitting via valueToList, so we
 * pass the raw strings through without pre-splitting.
 */
export function omdbToContribution(
	o: OmdbData | null,
	queryImdbId?: string | null,
): SourceContribution {
	if (!o) {
		// Defensive: never happens in the orchestrator (it null-checks
		// before calling), but keep the contract clean.
		return { source: 'omdb', fetchedAt: new Date().toISOString(), fields: {} };
	}
	return {
		source: 'omdb',
		fetchedAt: new Date().toISOString(),
		fields: {
			// Contributed, not omitted: when a match resolves to an IMDB id
			// TMDB can't find, OMDB is the ONLY source, and skipping these
			// left the movie on its filename-derived title with no poster.
			// merge-rules still ranks tmdb (10) above omdb (title 6 /
			// posterUrl 3), so TMDB wins whenever it has them.
			title: o.title || null,
			posterUrl: o.posterUrl || null,
			year: o.year || null,
			overview: o.plot || null,
			// OMDB returns the IMDB id it queried by; we re-attach
			// queryImdbId in case OmdbData omits it in its trimmed shape.
			imdbId: queryImdbId || null,
			runtimeMinutes: o.runtimeMinutes || null,
			language: o.language || null,
			country: o.country || null,
			contentRating: o.rated || null,
			genres: o.genre || null, // engine's mergeArrayValues splits commas
			cast: o.actors || null,
			directors: o.director || null,
			writers: o.writer || null,
			imdbRating: o.imdbRating ?? null,
			imdbVotes: o.imdbVotes ?? null,
			rottenTomatoesScore: o.rottenTomatoesScore ?? null,
			metacriticScore: o.metacriticScore ?? null,
		},
	};
}
