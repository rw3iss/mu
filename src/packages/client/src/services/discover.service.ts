import { api } from './api';

export interface DiscoverFilters {
	minRating?: number;
	minVotes?: number;
	genres?: string[];
	yearFrom?: number;
	yearTo?: number;
	person?: string;
	language?: string;
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
}

export interface DiscoverResponse {
	results: ScoredMovie[];
	usedSources: string[];
	reason?: string;
	enrichmentsQueued?: number;
}

export interface DiscoverRequest {
	seedMovieId?: string;
	seedMovieIds?: string[];
	limit?: number;
	filters?: DiscoverFilters;
	include?: IncludeMode;
}

function toQueryParams(req: DiscoverRequest): Record<string, string> {
	const p: Record<string, string> = {};
	if (req.seedMovieId) p.seedMovieId = req.seedMovieId;
	if (req.seedMovieIds && req.seedMovieIds.length > 0)
		p.seedMovieIds = req.seedMovieIds.join(',');
	if (req.limit) p.limit = String(req.limit);
	if (req.include && req.include !== 'owned') p.include = req.include;
	const f = req.filters;
	if (f) {
		if (f.minRating != null) p.minRating = String(f.minRating);
		if (f.minVotes != null) p.minVotes = String(f.minVotes);
		if (f.genres && f.genres.length > 0) p.genres = f.genres.join(',');
		if (f.yearFrom != null) p.yearFrom = String(f.yearFrom);
		if (f.yearTo != null) p.yearTo = String(f.yearTo);
		if (f.person) p.person = f.person;
		if (f.language) p.language = f.language;
	}
	return p;
}

export const discoverService = {
	fetch: (req: DiscoverRequest) =>
		api.get<DiscoverResponse>('/recommendations/discover', toQueryParams(req)),
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
