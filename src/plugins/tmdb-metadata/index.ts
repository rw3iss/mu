import type {
	IPlugin,
	PluginContext,
	PluginInfo,
} from '../../packages/server/src/plugins/plugin.interface.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

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
	adult: boolean;
	popularity: number;
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
	budget: number;
	revenue: number;
	imdb_id: string | null;
	adult: boolean;
	genres: { id: number; name: string }[];
	production_companies: {
		id: number;
		name: string;
		logo_path: string | null;
		origin_country: string;
	}[];
	credits?: {
		cast: {
			id: number;
			name: string;
			character: string;
			profile_path: string | null;
			order: number;
		}[];
		crew: {
			id: number;
			name: string;
			job: string;
			department: string;
			profile_path: string | null;
		}[];
	};
	images?: {
		posters: { file_path: string; width: number; height: number }[];
		backdrops: { file_path: string; width: number; height: number }[];
	};
	similar?: {
		results: { id: number; title: string; poster_path: string | null }[];
	};
}

export default class TmdbMetadataPlugin implements IPlugin {
	private context!: PluginContext;
	private metadataHandler: ((...args: unknown[]) => void) | null = null;

	async onLoad(context: PluginContext): Promise<void> {
		this.context = context;
		this.context.logger.log('TMDB Metadata plugin loaded');

		this.metadataHandler = async (...args: unknown[]) => {
			const data = args[0] as { movieId?: string; title?: string; year?: number } | undefined;
			if (!data?.movieId || !data?.title) return;

			try {
				await this.handleMovieNeedsMetadata(data.movieId, data.title, data.year);
			} catch (err) {
				this.context.logger.error(
					`Failed to fetch metadata for "${data.title}": ${err instanceof Error ? err.message : err}`,
				);
			}
		};

		this.context.events.on('movie:needs-metadata', this.metadataHandler);
		this.context.logger.log('Registered listener for movie:needs-metadata events');
	}

	async onUnload(): Promise<void> {
		this.metadataHandler = null;
		this.context.logger.log('TMDB Metadata plugin unloaded');
	}

	getInfo(): PluginInfo {
		return {
			name: 'tmdb-metadata',
			version: '1.0.0',
			description: 'Fetch movie metadata from The Movie Database (TMDB)',
			author: 'Mu',
			enabled: true,
			loaded: true,
			permissions: ['read:movies', 'write:metadata', 'network', 'cache'],
		};
	}

	async searchMovie(title: string, year?: number): Promise<TmdbSearchResult[]> {
		const apiKey = this.getApiKey();
		const language = (this.context.config.language as string) ?? 'en-US';
		const includeAdult = (this.context.config.includeAdult as boolean) ?? false;

		const cacheKey = `search:${title}:${year ?? ''}`;
		const cached = await this.context.cache.get<TmdbSearchResult[]>(cacheKey);

		if (cached) {
			this.context.logger.debug(`Cache hit for search: "${title}"`);
			return cached;
		}

		const params = new URLSearchParams({
			api_key: apiKey,
			query: title,
			language,
			include_adult: String(includeAdult),
		});

		if (year) {
			params.set('year', String(year));
		}

		const url = `${TMDB_API_BASE}/search/movie?${params.toString()}`;
		this.context.logger.debug(`Searching TMDB: "${title}" (${year ?? 'no year'})`);

		const response = await this.context.http.fetch(url);

		if (!response.ok) {
			throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { results: TmdbSearchResult[] };
		const results = data.results;

		await this.context.cache.set(cacheKey, results, CACHE_TTL_SECONDS);

		return results;
	}

	async getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
		const apiKey = this.getApiKey();
		const language = (this.context.config.language as string) ?? 'en-US';

		const cacheKey = `details:${tmdbId}`;
		const cached = await this.context.cache.get<TmdbMovieDetails>(cacheKey);

		if (cached) {
			this.context.logger.debug(`Cache hit for TMDB ID: ${tmdbId}`);
			return cached;
		}

		const params = new URLSearchParams({
			api_key: apiKey,
			language,
			append_to_response: 'credits,images,similar',
		});

		const url = `${TMDB_API_BASE}/movie/${tmdbId}?${params.toString()}`;
		this.context.logger.debug(`Fetching TMDB details for ID: ${tmdbId}`);

		const response = await this.context.http.fetch(url);

		if (!response.ok) {
			throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
		}

		const details = (await response.json()) as TmdbMovieDetails;

		await this.context.cache.set(cacheKey, details, CACHE_TTL_SECONDS);

		return details;
	}

	private async handleMovieNeedsMetadata(
		movieId: string,
		title: string,
		year?: number,
	): Promise<void> {
		this.context.logger.log(`Fetching metadata for "${title}" (${year ?? 'unknown year'})`);

		const searchResults = await this.searchMovie(title, year);

		if (searchResults.length === 0) {
			this.context.logger.warn(`No TMDB results found for "${title}"`);
			return;
		}

		const bestMatch = searchResults[0];
		const details = await this.getMovieDetails(bestMatch.id);

		const directors =
			details.credits?.crew.filter((c) => c.job === 'Director').map((c) => c.name) ?? [];

		const writers =
			details.credits?.crew.filter((c) => c.department === 'Writing').map((c) => c.name) ??
			[];

		const castMembers =
			details.credits?.cast.slice(0, 20).map((c) => ({
				name: c.name,
				character: c.character,
				profilePath: c.profile_path,
				order: c.order,
			})) ?? [];

		const genres = details.genres.map((g) => g.name);

		const productionCompanies = details.production_companies.map((c) => ({
			name: c.name,
			logoPath: c.logo_path,
			country: c.origin_country,
		}));

		const metadataUpdate: Record<string, unknown> = {
			genres: JSON.stringify(genres),
			cast: JSON.stringify(castMembers),
			directors: JSON.stringify(directors),
			writers: JSON.stringify(writers),
			productionCompanies: JSON.stringify(productionCompanies),
			budget: details.budget || null,
			revenue: details.revenue || null,
			tmdbRating: details.vote_average,
			tmdbVotes: details.vote_count,
			extendedData: JSON.stringify({
				tmdbId: details.id,
				imdbId: details.imdb_id,
				tagline: details.tagline,
				runtime: details.runtime,
				posterPath: details.poster_path,
				backdropPath: details.backdrop_path,
				similar: details.similar?.results.slice(0, 10).map((s) => ({
					tmdbId: s.id,
					title: s.title,
					posterPath: s.poster_path,
				})),
			}),
		};

		await this.context.updateMovieMetadata(movieId, metadataUpdate);

		this.context.logger.log(`Metadata updated for "${title}" (TMDB ID: ${details.id})`);

		this.context.events.emit('metadata:updated', {
			movieId,
			source: 'tmdb',
			tmdbId: details.id,
		});
	}

	private getApiKey(): string {
		const apiKey = this.context.config.apiKey as string | undefined;

		if (!apiKey) {
			throw new Error('TMDB API key is not configured. Set it in the plugin settings.');
		}

		return apiKey;
	}
}
