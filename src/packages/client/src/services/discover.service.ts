import { api } from './api';

export interface DiscoverFilters {
	minRating?: number;
	minVotes?: number;
	genres?: string[];
	yearFrom?: number;
	yearTo?: number;
	person?: string;
	language?: string;
	minRuntime?: number;
	maxRuntime?: number;
	/** Client-only: filters the rendered results by watch state. */
	watched?: 'all' | 'watched' | 'unwatched' | 'in-progress';
}

export type IncludeMode = 'owned' | 'notOwned' | 'all';

export interface ScoredMovie {
	movieId: string;
	title: string;
	year: number | null;
	score: number;
	explanation: string[];
	posterUrl: string | null;
	usedSources: string[];
	source?: 'library' | 'external' | 'bookmark';
	inLibrary?: boolean;
	tmdbId?: number | null;
	enriching?: boolean;
	/** Best-available rating, IMDB preferred, TMDB fallback. */
	rating?: number | null;
	ratingSource?: 'imdb' | 'tmdb' | null;
	/** Vote count from whichever rating source was used. */
	votes?: number | null;
	/** Per-source ratings, so the card can render both side-by-side. */
	tmdbRating?: number | null;
	tmdbVotes?: number | null;
	imdbRating?: number | null;
	imdbVotes?: number | null;
	/** Hydrated alongside ratings so the card can render extra
	 * context (runtime pill, primary genre, language) without a
	 * follow-up movie fetch. */
	runtimeMinutes?: number | null;
	genres?: string[];
	language?: string | null;
}

export interface DiscoverResponse {
	results: ScoredMovie[];
	usedSources: string[];
	reason?: string;
	enrichmentsQueued?: number;
	/** Movie ids the server inferred from `personKeys`. */
	personDerivedSeedIds?: string[];
	/** Person keys the server couldn't resolve to in-library credits. */
	unresolvedPersonKeys?: string[];
}

export interface DiscoverRequest {
	seedMovieId?: string;
	seedMovieIds?: string[];
	/**
	 * Server-side resolves these (e.g. `tmdb:287`) into in-library
	 * credit movie ids via the people↔library bridge. Merged with
	 * `seedMovieIds`. Surface in the response under
	 * `personDerivedSeedIds` / `unresolvedPersonKeys`.
	 */
	personKeys?: string[];
	limit?: number;
	filters?: DiscoverFilters;
	include?: IncludeMode;
	/**
	 * Blend the user's taste profile (favorites, ratings, watch
	 * history) into the recommendation. Default true. When false AND
	 * no seeds present, the server returns a filter-only cold browse
	 * sorted by votes/rating. Seeds-present + useProfile=false is
	 * equivalent to seeds-present + useProfile=true (the seed-driven
	 * strategies don't blend profile signal regardless).
	 */
	useProfile?: boolean;
}

function toQueryParams(req: DiscoverRequest): Record<string, string> {
	const p: Record<string, string> = {};
	if (req.seedMovieId) p.seedMovieId = req.seedMovieId;
	if (req.seedMovieIds && req.seedMovieIds.length > 0)
		p.seedMovieIds = req.seedMovieIds.join(',');
	if (req.personKeys && req.personKeys.length > 0) p.personKeys = req.personKeys.join(',');
	if (req.limit) p.limit = String(req.limit);
	if (req.include && req.include !== 'owned') p.include = req.include;
	// Only serialise when explicitly false — server defaults to true.
	if (req.useProfile === false) p.useProfile = 'false';
	const f = req.filters;
	if (f) {
		if (f.minRating != null) p.minRating = String(f.minRating);
		if (f.minVotes != null) p.minVotes = String(f.minVotes);
		if (f.genres && f.genres.length > 0) p.genres = f.genres.join(',');
		if (f.yearFrom != null) p.yearFrom = String(f.yearFrom);
		if (f.yearTo != null) p.yearTo = String(f.yearTo);
		if (f.person) p.person = f.person;
		if (f.language) p.language = f.language;
		if (f.minRuntime != null) p.minRuntime = String(f.minRuntime);
		if (f.maxRuntime != null) p.maxRuntime = String(f.maxRuntime);
		// `watched` is client-side only — never serialise it.
	}
	return p;
}

export const discoverService = {
	fetch: (req: DiscoverRequest, opts?: { signal?: AbortSignal }) =>
		api.get<DiscoverResponse>('/recommendations/discover', toQueryParams(req), opts),
};

export interface Bookmark {
	id: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	overview: string | null;
	tmdbId: number | null;
	imdbId: string | null;
	addedAt: string;
}

export const bookmarksService = {
	list: () => api.get<{ bookmarks: Bookmark[] }>('/bookmarks'),
	add: (input: {
		tmdbId?: number | null;
		imdbId?: string | null;
		title?: string;
		year?: number | null;
	}) => api.post<{ movieId: string; ok: boolean }>('/bookmarks', input),
	remove: (movieId: string) => api.delete<{ ok: boolean }>(`/bookmarks/${movieId}`),
};
