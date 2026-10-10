export type SearchSource =
	| 'local'
	| 'cache'
	| 'tmdb'
	| 'omdb'
	| 'trakt'
	| 'imdb'
	| 'musicbrainz'
	| 'lastfm'
	| 'discogs';

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

export type MusicSearchKind = 'artist' | 'album' | 'track';

/**
 * One music search result (federated: local FTS5 + MusicBrainz + optional
 * Last.fm / Discogs). `mbid` is the artist MBID, the release-group MBID (album)
 * or the recording MBID (track). `localId` is set when the entity is in the
 * library; otherwise the client links to the `mb:` stub page.
 */
export interface MusicSearchHit {
	kind: MusicSearchKind;
	localId?: string;
	mbid?: string;
	/** Artist name (kind=artist) or album / track title. */
	title: string;
	/** Artist credit for albums and tracks. */
	artist?: string;
	/** Album title for tracks. */
	album?: string;
	/** Local album id (tracks in the library). */
	albumId?: string;
	/** Release-group MBID for tracks (links to the album stub). */
	albumMbid?: string;
	year?: number;
	artUrl?: string;
	primaryType?: string;
	durationSeconds?: number;
	/** Short descriptor (artist disambiguation, country, album count). */
	detail?: string;
	sources: SearchSource[];
	isOwned: boolean;
	matchScore: number;
}

export type SearchHit = MovieSearchHit | PersonSearchHit | MusicSearchHit;

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
