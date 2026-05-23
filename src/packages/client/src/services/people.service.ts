import { api } from './api';

export interface PersonCreditView {
	tmdbId: number;
	title: string;
	year: number | null;
	posterUrl: string | null;
	character?: string | null;
	job?: string | null;
	department?: string | null;
	mediaType: 'movie' | 'tv';
	movieId?: string | null;
	/** TMDB vote average for the credit. For library hits the server
	 * overrides with the more-authoritative locally-stored value. */
	tmdbRating?: number | null;
	tmdbVotes?: number | null;
	/** Only populated when the credit resolves to a library row that
	 * was enriched via OMDB. Lets the card show IMDB on owned movies. */
	imdbRating?: number | null;
}

export interface PersonView {
	id: string;
	key: string;
	name: string;
	tmdbId: number | null;
	imdbId: string | null;
	profileUrl: string | null;
	birthday: string | null;
	placeOfBirth: string | null;
	deathday: string | null;
	biography: string | null;
	knownForDepartment: string | null;
	gender: number | null;
	popularity: number | null;
	alsoKnownAs: string[];
	knownForMovies: PersonCreditView[];
}

export const peopleService = {
	get(key: string): Promise<{ person: PersonView }> {
		return api.get<{ person: PersonView }>(`/people/${encodeURIComponent(key)}`);
	},
};
