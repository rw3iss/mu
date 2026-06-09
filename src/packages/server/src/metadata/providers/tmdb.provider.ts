import { CACHE_NAMESPACES, CACHE_TTL } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { ConfigService } from '../../config/config.service.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/**
 * fetch() with a hard timeout so a slow/stalled provider request can't hang a
 * metadata refresh for a minute (the calling methods catch the resulting
 * AbortError and fall back / return null). A 429 leaves a clear log line below.
 */
const PROVIDER_FETCH_TIMEOUT_MS = 12_000;
function fetchWithTimeout(url: string): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS) });
}
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

interface TmdbSearchResult {
	id: number;
	title: string;
	original_title: string;
	overview: string;
	release_date: string;
	poster_path: string | null;
	backdrop_path: string | null;
	vote_average: number;
	vote_count: number;
	genre_ids: number[];
	popularity?: number;
}

export interface TmdbTvSearchResult {
	id: number;
	name: string;
	original_name: string;
	overview: string;
	first_air_date: string;
	poster_path: string | null;
	backdrop_path: string | null;
	vote_average: number;
	vote_count: number;
	popularity?: number;
}

export interface TmdbCollectionSearchResult {
	id: number;
	name: string;
	overview: string;
	poster_path: string | null;
	backdrop_path: string | null;
}

export interface TmdbEpisodeDetails {
	id: number;
	name: string;
	overview: string;
	air_date: string | null;
	episode_number: number;
	season_number: number;
	runtime: number | null;
	still_path: string | null;
	vote_average: number;
	vote_count: number;
	crew?: { id: number; name: string; job: string; department: string }[];
	guest_stars?: { id: number; name: string; character: string; profile_path: string | null }[];
}

export interface TmdbTvDetails {
	id: number;
	name: string;
	original_name: string;
	overview: string;
	tagline: string;
	first_air_date: string;
	last_air_date: string | null;
	number_of_seasons: number;
	number_of_episodes: number;
	episode_run_time: number[];
	poster_path: string | null;
	backdrop_path: string | null;
	vote_average: number;
	vote_count: number;
	popularity: number;
	genres: { id: number; name: string }[];
	networks: { id: number; name: string }[];
	external_ids?: { imdb_id: string | null; tvdb_id: number | null };
	credits?: {
		cast: { id: number; name: string; character: string; profile_path: string | null }[];
		crew: { id: number; name: string; job: string; department: string }[];
	};
	videos?: {
		results: { key: string; site: string; type: string }[];
	};
	images?: {
		posters: { file_path: string }[];
		backdrops: { file_path: string }[];
	};
	keywords?: {
		results: { id: number; name: string }[];
	};
}

export interface TmdbCollectionDetails {
	id: number;
	name: string;
	overview: string;
	poster_path: string | null;
	backdrop_path: string | null;
	parts: TmdbSearchResult[];
}

export interface TmdbPersonDetails {
	id: number;
	name: string;
	also_known_as?: string[];
	biography?: string;
	birthday?: string | null;
	deathday?: string | null;
	place_of_birth?: string | null;
	gender?: number;
	known_for_department?: string;
	popularity?: number;
	profile_path?: string | null;
	imdb_id?: string | null;
	homepage?: string | null;
	external_ids?: { imdb_id?: string | null };
}

export interface TmdbPersonMovieCredit {
	id: number;
	title: string;
	original_title?: string;
	release_date?: string | null;
	poster_path?: string | null;
	character?: string;
	job?: string;
	department?: string;
	vote_average?: number;
	vote_count?: number;
	popularity?: number;
}

export interface TmdbPersonCombinedCredits {
	cast: (TmdbPersonMovieCredit & { media_type: 'movie' | 'tv'; name?: string })[];
	crew: (TmdbPersonMovieCredit & { media_type: 'movie' | 'tv'; name?: string })[];
}

interface TmdbMovieDetails {
	id: number;
	title: string;
	original_title: string;
	overview: string;
	tagline: string;
	release_date: string;
	runtime: number;
	poster_path: string | null;
	backdrop_path: string | null;
	vote_average: number;
	vote_count: number;
	imdb_id: string | null;
	budget: number;
	revenue: number;
	spoken_languages: { iso_639_1: string; name: string }[];
	production_countries: { iso_3166_1: string; name: string }[];
	production_companies: { id: number; name: string }[];
	genres: { id: number; name: string }[];
	credits?: {
		cast: { id: number; name: string; character: string; profile_path: string | null }[];
		crew: { id: number; name: string; job: string; department: string }[];
	};
	similar?: { results: TmdbSearchResult[] };
	recommendations?: { results: TmdbSearchResult[] };
	images?: {
		posters: { file_path: string }[];
		backdrops: { file_path: string }[];
	};
	videos?: {
		results: { key: string; site: string; type: string }[];
	};
	keywords?: {
		keywords: { id: number; name: string }[];
	};
	release_dates?: {
		results: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[];
	};
}

@Injectable()
export class TmdbProvider {
	private readonly logger = new Logger('TmdbProvider');
	private readonly apiKey: string | null;

	constructor(
		private readonly config: ConfigService,
		private readonly cache: CacheService,
	) {
		this.apiKey = this.config.get<string>('thirdParty.tmdb.apiKey', '') || null;
		if (this.apiKey) {
			this.logger.log('TMDB provider initialized');
		} else {
			this.logger.warn('TMDB API key not configured');
		}
	}

	async searchMovie(title: string, year?: number): Promise<TmdbSearchResult[] | null> {
		if (!this.apiKey) return null;

		const cacheKey = `search:${title}:${year ?? ''}`;
		const cached = await this.cache.get<TmdbSearchResult[]>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			query: title,
			include_adult: 'false',
		});
		if (year) params.set('year', String(year));

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/search/movie?${params}`);
			if (!response.ok) {
				this.logger.warn(`TMDB search failed: ${response.status}`);
				return null;
			}

			const data = (await response.json()) as { results: TmdbSearchResult[] };
			const results = data.results ?? [];

			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, results, CACHE_TTL.METADATA);
			return results;
		} catch (err: any) {
			this.logger.error(`TMDB search error: ${err.message}`);
			return null;
		}
	}

	async getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails | null> {
		if (!this.apiKey) return null;

		const cacheKey = `details:${tmdbId}`;
		const cached = await this.cache.get<TmdbMovieDetails>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			append_to_response:
				'credits,similar,recommendations,images,videos,keywords,release_dates',
		});

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/movie/${tmdbId}?${params}`);
			if (!response.ok) {
				this.logger.warn(`TMDB details failed for ${tmdbId}: ${response.status}`);
				return null;
			}

			const data = (await response.json()) as TmdbMovieDetails;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, data, CACHE_TTL.METADATA);
			return data;
		} catch (err: any) {
			this.logger.error(`TMDB details error: ${err.message}`);
			return null;
		}
	}

	getImageUrl(path: string | null, size: string = 'w500'): string | null {
		if (!path) return null;
		return `${TMDB_IMAGE_BASE}/${size}${path}`;
	}

	async searchTv(name: string, year?: number): Promise<TmdbTvSearchResult[] | null> {
		if (!this.apiKey) return null;

		const cacheKey = `tv:search:${name}:${year ?? ''}`;
		const cached = await this.cache.get<TmdbTvSearchResult[]>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			query: name,
			include_adult: 'false',
		});
		if (year) params.set('first_air_date_year', String(year));

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/search/tv?${params}`);
			if (!response.ok) {
				this.logger.warn(`TMDB TV search failed: ${response.status}`);
				return null;
			}
			const data = (await response.json()) as { results: TmdbTvSearchResult[] };
			const results = data.results ?? [];
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, results, CACHE_TTL.METADATA);
			return results;
		} catch (err: any) {
			this.logger.error(`TMDB TV search error: ${err.message}`);
			return null;
		}
	}

	async getTvDetails(tmdbTvId: number): Promise<TmdbTvDetails | null> {
		if (!this.apiKey) return null;

		const cacheKey = `tv:details:${tmdbTvId}`;
		const cached = await this.cache.get<TmdbTvDetails>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			append_to_response: 'credits,videos,images,keywords,external_ids',
		});

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/tv/${tmdbTvId}?${params}`);
			if (!response.ok) {
				this.logger.warn(`TMDB TV details failed for ${tmdbTvId}: ${response.status}`);
				return null;
			}
			const data = (await response.json()) as TmdbTvDetails;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, data, CACHE_TTL.METADATA);
			return data;
		} catch (err: any) {
			this.logger.error(`TMDB TV details error: ${err.message}`);
			return null;
		}
	}

	/**
	 * Fetch full details for a single TV episode. Used when a movie row
	 * is actually a TV episode (SxxEyy detected in the filename) — we
	 * pull the episode's name, overview, runtime, and still image to
	 * apply onto the row.
	 */
	async getTvEpisodeDetails(
		tmdbTvId: number,
		seasonNumber: number,
		episodeNumber: number,
	): Promise<TmdbEpisodeDetails | null> {
		if (!this.apiKey) return null;

		const cacheKey = `tv:episode:${tmdbTvId}:${seasonNumber}:${episodeNumber}`;
		const cached = await this.cache.get<TmdbEpisodeDetails>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			append_to_response: 'credits',
		});

		try {
			const response = await fetchWithTimeout(
				`${TMDB_BASE_URL}/tv/${tmdbTvId}/season/${seasonNumber}/episode/${episodeNumber}?${params}`,
			);
			if (!response.ok) {
				this.logger.warn(
					`TMDB episode details failed for ${tmdbTvId} S${seasonNumber}E${episodeNumber}: ${response.status}`,
				);
				return null;
			}
			const data = (await response.json()) as TmdbEpisodeDetails;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, data, CACHE_TTL.METADATA);
			return data;
		} catch (err: any) {
			this.logger.error(`TMDB episode details error: ${err.message}`);
			return null;
		}
	}

	async searchCollection(name: string): Promise<TmdbCollectionSearchResult[] | null> {
		if (!this.apiKey) return null;

		const cacheKey = `collection:search:${name}`;
		const cached = await this.cache.get<TmdbCollectionSearchResult[]>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			query: name,
		});

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/search/collection?${params}`);
			if (!response.ok) return null;
			const data = (await response.json()) as { results: TmdbCollectionSearchResult[] };
			const results = data.results ?? [];
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, results, CACHE_TTL.METADATA);
			return results;
		} catch (err: any) {
			this.logger.error(`TMDB collection search error: ${err.message}`);
			return null;
		}
	}

	async getCollectionDetails(collectionId: number): Promise<TmdbCollectionDetails | null> {
		if (!this.apiKey) return null;

		const cacheKey = `collection:details:${collectionId}`;
		const cached = await this.cache.get<TmdbCollectionDetails>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({ api_key: this.apiKey });

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/collection/${collectionId}?${params}`);
			if (!response.ok) return null;
			const data = (await response.json()) as TmdbCollectionDetails;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, data, CACHE_TTL.METADATA);
			return data;
		} catch (err: any) {
			this.logger.error(`TMDB collection details error: ${err.message}`);
			return null;
		}
	}

	/**
	 * Reverse lookup from IMDB ID. Useful when OMDB returned an imdbId
	 * but our title-based TMDB search missed.
	 */
	async findByImdbId(imdbId: string): Promise<{
		movie?: TmdbSearchResult;
		tv?: TmdbTvSearchResult;
	} | null> {
		if (!this.apiKey) return null;

		const cacheKey = `find:imdb:${imdbId}`;
		const cached = await this.cache.get<{
			movie?: TmdbSearchResult;
			tv?: TmdbTvSearchResult;
		}>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			external_source: 'imdb_id',
		});

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/find/${imdbId}?${params}`);
			if (!response.ok) return null;
			const data = (await response.json()) as {
				movie_results: TmdbSearchResult[];
				tv_results: TmdbTvSearchResult[];
			};
			const result = {
				movie: data.movie_results?.[0],
				tv: data.tv_results?.[0],
			};
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, result, CACHE_TTL.METADATA);
			return result;
		} catch (err: any) {
			this.logger.error(`TMDB find error: ${err.message}`);
			return null;
		}
	}

	async getPersonDetails(personId: number): Promise<TmdbPersonDetails | null> {
		if (!this.apiKey) return null;

		const cacheKey = `person:${personId}`;
		const cached = await this.cache.get<TmdbPersonDetails>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			append_to_response: 'external_ids',
		});

		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/person/${personId}?${params}`);
			if (!response.ok) {
				this.logger.warn(`TMDB person details failed for ${personId}: ${response.status}`);
				return null;
			}
			const data = (await response.json()) as TmdbPersonDetails;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, data, CACHE_TTL.METADATA);
			return data;
		} catch (err: any) {
			this.logger.error(`TMDB person details error: ${err.message}`);
			return null;
		}
	}

	async getPersonCombinedCredits(personId: number): Promise<TmdbPersonCombinedCredits | null> {
		if (!this.apiKey) return null;

		const cacheKey = `person:${personId}:combined_credits`;
		const cached = await this.cache.get<TmdbPersonCombinedCredits>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({ api_key: this.apiKey });
		try {
			const response = await fetchWithTimeout(
				`${TMDB_BASE_URL}/person/${personId}/combined_credits?${params}`,
			);
			if (!response.ok) {
				this.logger.warn(`TMDB person credits failed for ${personId}: ${response.status}`);
				return null;
			}
			const data = (await response.json()) as TmdbPersonCombinedCredits;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, data, CACHE_TTL.METADATA);
			return data;
		} catch (err: any) {
			this.logger.error(`TMDB person credits error: ${err.message}`);
			return null;
		}
	}

	async searchPerson(name: string): Promise<
		| {
				id: number;
				name: string;
				profile_path: string | null;
				known_for_department?: string;
				popularity?: number;
		  }[]
		| null
	> {
		if (!this.apiKey) return null;

		const cacheKey = `person:search:${name}`;
		const cached = await this.cache.get<any[]>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) return cached;

		const params = new URLSearchParams({
			api_key: this.apiKey,
			query: name,
			include_adult: 'false',
		});
		try {
			const response = await fetchWithTimeout(`${TMDB_BASE_URL}/search/person?${params}`);
			if (!response.ok) return null;
			const data = (await response.json()) as { results: any[] };
			const results = data.results ?? [];
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, results, CACHE_TTL.METADATA);
			return results;
		} catch (err: any) {
			this.logger.error(`TMDB person search error: ${err.message}`);
			return null;
		}
	}
}
