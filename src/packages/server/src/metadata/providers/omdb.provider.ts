import { CACHE_NAMESPACES, CACHE_TTL } from '@mu/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { ConfigService } from '../../config/config.service.js';
import { RatingsSyncService } from '../../imdb-datasets/ratings-sync.service.js';

const OMDB_BASE_URL = 'https://www.omdbapi.com';

/**
 * fetch() with a hard timeout so a slow/stalled provider request can't hang a
 * metadata refresh for a minute (the calling methods catch the resulting
 * AbortError and fall back / return null). A 429 leaves a clear log line below.
 */
const PROVIDER_FETCH_TIMEOUT_MS = 12_000;
function fetchWithTimeout(url: string): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS) });
}

interface OmdbResult {
	Title: string;
	Year: string;
	Rated: string;
	imdbRating: string;
	imdbVotes: string;
	imdbID: string;
	Runtime: string;
	Genre: string;
	Director: string;
	Writer: string;
	Actors: string;
	Plot: string;
	Poster: string;
	Ratings: { Source: string; Value: string }[];
	Metascore: string;
	Response: string;
	Language: string;
	Country: string;
	Awards: string;
	Error?: string;
}

export interface OmdbData {
	imdbRating: number | null;
	imdbVotes: number | null;
	rottenTomatoesScore: number | null;
	metacriticScore: number | null;
	plot: string | null;
	director: string | null;
	writer: string | null;
	actors: string | null;
	genre: string | null;
	rated: string | null;
	language: string | null;
	country: string | null;
	awards: string | null;
	runtimeMinutes: number | null;
	year: number | null;
}

export interface OmdbSearchResult extends OmdbData {
	imdbId: string;
	title: string;
}

export interface OmdbBasicSearchHit {
	imdbId: string;
	title: string;
	year?: number;
	posterUrl?: string;
}

@Injectable()
export class OmdbProvider {
	private readonly logger = new Logger('OmdbProvider');
	private readonly apiKey: string | null;

	constructor(
		private readonly config: ConfigService,
		private readonly cache: CacheService,
		@Optional() @Inject(RatingsSyncService) private readonly ratings?: RatingsSyncService,
	) {
		this.apiKey = this.config.get<string>('thirdParty.omdb.apiKey', '') || null;
		if (this.apiKey) {
			this.logger.log('OMDB provider initialized');
		} else {
			this.logger.warn('OMDB API key not configured');
		}
	}

	/**
	 * Fast rating-only lookup. Hits the local IMDB datasets table
	 * first (daily-fresh, no quota); falls back to a full OMDB call
	 * if the dataset isn't enabled or doesn't have this title.
	 *
	 * Callers that just need the rating + vote count (filters, score
	 * tiebreakers) should prefer this over `getByImdbId` to avoid
	 * burning OMDB quota.
	 */
	async getRatingByImdbId(
		imdbId: string,
	): Promise<{ rating: number; votes: number } | null> {
		const local = this.ratings?.get(imdbId);
		if (local) return { rating: local.rating, votes: local.votes };
		const full = await this.getByImdbId(imdbId);
		if (full?.imdbRating != null && full?.imdbVotes != null) {
			return { rating: full.imdbRating, votes: full.imdbVotes };
		}
		return null;
	}

	async getByImdbId(imdbId: string): Promise<OmdbData | null> {
		// Local-only stub the no-OMDB-key and OMDB-failure paths fall
		// back to. Built once up front so both branches use the same
		// shape; daily-fresh local rating still beats no rating at all.
		const localRating = this.ratings?.get(imdbId);
		const localOnlyData = (): OmdbData | null => {
			if (!localRating) return null;
			return {
				imdbRating: localRating.rating,
				imdbVotes: localRating.votes,
				rottenTomatoesScore: null,
				metacriticScore: null,
				plot: null,
				director: null,
				writer: null,
				actors: null,
				genre: null,
				rated: null,
				language: null,
				country: null,
				awards: null,
				runtimeMinutes: null,
				year: null,
			};
		};

		if (!this.apiKey) return localOnlyData();

		const cacheKey = `omdb:${imdbId}`;
		const cached = await this.cache.get<OmdbData>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) {
			// Overlay the local rating onto an old cached row — the
			// daily-fresh value is more trustworthy than whatever
			// OMDB returned on the day we first cached it.
			return localRating
				? { ...cached, imdbRating: localRating.rating, imdbVotes: localRating.votes }
				: cached;
		}

		const params = new URLSearchParams({
			apikey: this.apiKey,
			i: imdbId,
			plot: 'full',
		});

		try {
			const response = await fetchWithTimeout(`${OMDB_BASE_URL}/?${params}`);
			if (!response.ok) {
				this.logger.warn(`OMDB request failed: ${response.status}`);
				return localOnlyData();
			}

			const raw = (await response.json()) as OmdbResult;
			if (raw.Response === 'False') {
				this.logger.warn(`OMDB error for ${imdbId}: ${raw.Error}`);
				return localOnlyData();
			}

			const result: OmdbData = parseOmdbResult(raw);
			// Same overlay rule on the fresh path — local takes
			// precedence for the rating fields even when OMDB succeeded.
			const merged = localRating
				? { ...result, imdbRating: localRating.rating, imdbVotes: localRating.votes }
				: result;
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, merged, CACHE_TTL.METADATA);
			return merged;
		} catch (err: any) {
			this.logger.error(`OMDB error: ${err.message}`);
			return localOnlyData();
		}
	}

	/**
	 * Multi-result title search (?s=). Returns lightweight hits suitable
	 * for federated search dropdowns. Only minimal fields are returned;
	 * fetching ratings / plot / etc. requires a follow-up `getByImdbId`.
	 */
	async searchMovies(query: string): Promise<OmdbBasicSearchHit[]> {
		if (!this.apiKey) return [];

		const cacheKey = `omdb:search:multi:${query.toLowerCase()}`;
		const cached = await this.cache.get<OmdbBasicSearchHit[]>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;

		const params = new URLSearchParams({
			apikey: this.apiKey,
			s: query,
			type: 'movie',
		});

		try {
			const response = await fetchWithTimeout(`${OMDB_BASE_URL}/?${params}`);
			if (!response.ok) {
				this.logger.warn(`OMDB multi-search failed: ${response.status}`);
				return [];
			}
			const raw = (await response.json()) as {
				Response: string;
				Search?: Array<{
					Title: string;
					Year: string;
					imdbID: string;
					Type: string;
					Poster: string;
				}>;
				Error?: string;
			};
			if (raw.Response === 'False' || !Array.isArray(raw.Search)) return [];
			const out: OmdbBasicSearchHit[] = raw.Search.filter(
				(r) => r.imdbID && r.Title,
			).map((r) => {
				const yearNum = r.Year ? Number.parseInt(r.Year, 10) : Number.NaN;
				return {
					imdbId: r.imdbID,
					title: r.Title,
					year: Number.isFinite(yearNum) ? yearNum : undefined,
					posterUrl: r.Poster && r.Poster !== 'N/A' ? r.Poster : undefined,
				};
			});
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, out, CACHE_TTL.METADATA);
			return out;
		} catch (err: any) {
			this.logger.error(`OMDB multi-search error: ${err.message}`);
			return [];
		}
	}

	async searchByTitle(title: string, year?: number): Promise<OmdbSearchResult | null> {
		if (!this.apiKey) return null;

		const cacheKey = `omdb:search:${title}:${year ?? ''}`;
		const cached = await this.cache.get<OmdbSearchResult>(CACHE_NAMESPACES.METADATA, cacheKey);
		if (cached) return cached;

		const params = new URLSearchParams({
			apikey: this.apiKey,
			t: title,
			plot: 'full',
			type: 'movie',
		});
		if (year) params.set('y', String(year));

		try {
			const response = await fetchWithTimeout(`${OMDB_BASE_URL}/?${params}`);
			if (!response.ok) {
				this.logger.warn(`OMDB title search failed: ${response.status}`);
				return null;
			}

			const raw = (await response.json()) as OmdbResult;
			if (raw.Response === 'False') {
				this.logger.debug?.(`OMDB no result for "${title}": ${raw.Error}`);
				return null;
			}

			const base = parseOmdbResult(raw);
			const result: OmdbSearchResult = {
				...base,
				imdbId: raw.imdbID,
				title: raw.Title,
			};
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, result, CACHE_TTL.METADATA);
			return result;
		} catch (err: any) {
			this.logger.error(`OMDB title search error: ${err.message}`);
			return null;
		}
	}
}

/**
 * Map OMDB's raw response shape to our trimmed OmdbData. Centralised so
 * the by-imdbId and by-title paths populate every field identically —
 * previously `runtimeMinutes` / `year` were only parsed in the title
 * path, so cross-lookups from TMDB silently lost OMDB's runtime.
 */
function parseOmdbResult(raw: OmdbResult): OmdbData {
	const rtRating = raw.Ratings?.find((r) => r.Source === 'Rotten Tomatoes');
	const rtScore = rtRating ? parseInt(rtRating.Value, 10) : null;
	const runtimeMatch = raw.Runtime?.match(/(\d+)/);
	const runtimeMinutes = runtimeMatch ? parseInt(runtimeMatch[1]!, 10) : null;
	const yearParsed = raw.Year ? parseInt(raw.Year, 10) : null;

	return {
		imdbRating: raw.imdbRating && raw.imdbRating !== 'N/A' ? parseFloat(raw.imdbRating) : null,
		imdbVotes:
			raw.imdbVotes && raw.imdbVotes !== 'N/A'
				? parseInt(raw.imdbVotes.replace(/,/g, ''), 10)
				: null,
		rottenTomatoesScore: rtScore != null && !Number.isNaN(rtScore) ? rtScore : null,
		metacriticScore:
			raw.Metascore && raw.Metascore !== 'N/A' ? parseInt(raw.Metascore, 10) : null,
		plot: raw.Plot && raw.Plot !== 'N/A' ? raw.Plot : null,
		director: raw.Director && raw.Director !== 'N/A' ? raw.Director : null,
		writer: raw.Writer && raw.Writer !== 'N/A' ? raw.Writer : null,
		actors: raw.Actors && raw.Actors !== 'N/A' ? raw.Actors : null,
		genre: raw.Genre && raw.Genre !== 'N/A' ? raw.Genre : null,
		rated: raw.Rated && raw.Rated !== 'N/A' ? raw.Rated : null,
		language: raw.Language && raw.Language !== 'N/A' ? raw.Language : null,
		country: raw.Country && raw.Country !== 'N/A' ? raw.Country : null,
		awards: raw.Awards && raw.Awards !== 'N/A' ? raw.Awards : null,
		runtimeMinutes,
		year: yearParsed != null && !Number.isNaN(yearParsed) ? yearParsed : null,
	};
}
