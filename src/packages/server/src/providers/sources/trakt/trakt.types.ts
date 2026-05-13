/**
 * Minimal subset of Trakt API shapes we consume. The full schemas
 * are extensive; we type only the fields we actually read.
 * See https://trakt.docs.apiary.io/ for the complete reference.
 */

export interface TraktMovieIds {
	trakt: number;
	slug: string;
	imdb: string | null;
	tmdb: number | null;
}

export interface TraktMovie {
	title: string;
	year: number | null;
	ids: TraktMovieIds;
}

export interface TraktRelatedMovie extends TraktMovie {}

export interface TraktCredentials {
	clientId: string;
	clientSecret?: string;
}
