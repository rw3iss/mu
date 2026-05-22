export type SearchSource = 'local' | 'cache' | 'tmdb' | 'omdb' | 'trakt';

export interface MovieSearchHit {
	movieId?: string;
	imdbId?: string;
	tmdbId?: number;
	traktId?: number;
	title: string;
	year?: number;
	posterUrl?: string;
	overview?: string;
	/** TMDB rating, 0–10 scale. Pulled from the search response when present. */
	tmdbRating?: number;
	/** TMDB vote count. Useful for confidence-weighting alongside the score. */
	tmdbVotes?: number;
	/** IMDB rating, 0–10 scale. Pulled from OMDB when available. */
	imdbRating?: number;
	imdbVotes?: number;
	sources: SearchSource[];
	isOwned: boolean;
	matchScore: number;
}

export interface PersonSearchHit {
	personKey: string;
	tmdbId?: number;
	traktId?: number;
	name: string;
	profileUrl?: string;
	role?: string;
	knownFor?: string[];
	sources: SearchSource[];
	isOwned: boolean;
	matchScore: number;
}

export type SearchHit = MovieSearchHit | PersonSearchHit;

export interface SearchResultsEvent<T> {
	kind: 'results';
	source: SearchSource;
	items: T[];
}
export interface SearchErrorEvent {
	kind: 'error';
	source: SearchSource;
	message: string;
}
export interface SearchDoneEvent {
	kind: 'done';
	sourcesQueried: SearchSource[];
}
export type SearchEvent<T> = SearchResultsEvent<T> | SearchErrorEvent | SearchDoneEvent;
