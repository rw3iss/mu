import { CACHE_NAMESPACES, CACHE_TTL } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { ConfigService } from '../../config/config.service.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
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
			const response = await fetch(`${TMDB_BASE_URL}/search/movie?${params}`);
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
			append_to_response: 'credits,similar,images,videos,keywords,release_dates',
		});

		try {
			const response = await fetch(`${TMDB_BASE_URL}/movie/${tmdbId}?${params}`);
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
}
