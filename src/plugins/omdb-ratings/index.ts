import type {
	IPlugin,
	PluginContext,
	PluginInfo,
} from '../../packages/server/src/plugins/plugin.interface.js';

const OMDB_API_BASE = 'https://www.omdbapi.com/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

interface OmdbRating {
	Source: string;
	Value: string;
}

interface OmdbResponse {
	Title?: string;
	Year?: string;
	imdbID?: string;
	imdbRating?: string;
	imdbVotes?: string;
	Metascore?: string;
	Ratings?: OmdbRating[];
	Response: string;
	Error?: string;
}

interface RatingData {
	imdbRating: number | null;
	imdbVotes: number | null;
	rottenTomatoesScore: number | null;
	metacriticScore: number | null;
}

export default class OmdbRatingsPlugin implements IPlugin {
	private context!: PluginContext;
	private metadataFetchedHandler: ((...args: unknown[]) => void) | null = null;

	async onLoad(context: PluginContext): Promise<void> {
		this.context = context;
		this.context.logger.log('OMDB Ratings plugin loaded');

		// Listen for metadata-fetched events to enrich movies with ratings
		this.metadataFetchedHandler = async (...args: unknown[]) => {
			const data = args[0] as
				| {
						movieId?: string;
						source?: string;
						tmdbId?: number;
				  }
				| undefined;

			if (!data?.movieId) return;

			try {
				await this.handleMetadataFetched(data.movieId);
			} catch (err) {
				this.context.logger.error(
					`Failed to fetch OMDB ratings for movie ${data.movieId}: ${err instanceof Error ? err.message : err}`,
				);
			}
		};

		this.context.events.on('movie:metadata-fetched', this.metadataFetchedHandler);
		this.context.logger.log('Registered listener for movie:metadata-fetched events');
	}

	async onUnload(): Promise<void> {
		this.metadataFetchedHandler = null;
		this.context.logger.log('OMDB Ratings plugin unloaded');
	}

	getInfo(): PluginInfo {
		return {
			name: 'omdb-ratings',
			version: '1.0.0',
			description: 'Fetch movie ratings from OMDB (IMDb, Rotten Tomatoes, Metacritic)',
			author: 'Mu',
			enabled: true,
			loaded: true,
			permissions: ['network', 'cache'],
		};
	}

	/**
	 * GET /lookup?imdbId=tt1234567
	 * Fetches ratings from OMDB for a given IMDb ID.
	 */
	async lookup(imdbId: string): Promise<RatingData> {
		const apiKey = this.getApiKey();

		const cacheKey = `omdb:ratings:${imdbId}`;
		const cached = await this.context.cache.get<RatingData>(cacheKey);

		if (cached) {
			this.context.logger.debug(`Cache hit for OMDB ratings: ${imdbId}`);
			return cached;
		}

		const url = `${OMDB_API_BASE}?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(imdbId)}`;
		this.context.logger.debug(`Fetching OMDB data for: ${imdbId}`);

		const response = await this.context.http.fetch(url);

		if (!response.ok) {
			throw new Error(`OMDB API HTTP error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as OmdbResponse;

		if (data.Response === 'False') {
			throw new Error(`OMDB API error: ${data.Error ?? 'Unknown error'}`);
		}

		const ratings = this.parseRatings(data);

		await this.context.cache.set(cacheKey, ratings, CACHE_TTL_SECONDS);

		return ratings;
	}

	/**
	 * Handles the movie:metadata-fetched event.
	 * Looks up the movie's extendedData for an imdbId and fetches OMDB ratings.
	 */
	private async handleMetadataFetched(movieId: string): Promise<void> {
		const movie = await this.context.getMovieById(movieId);

		if (!movie) {
			this.context.logger.warn(`Movie not found: ${movieId}`);
			return;
		}

		// Extract imdbId from the movie's extended data
		const movieRecord = movie as Record<string, unknown>;
		const imdbId = this.extractImdbId(movieRecord);

		if (!imdbId) {
			this.context.logger.debug(
				`No IMDb ID found for movie ${movieId}, skipping OMDB ratings lookup`,
			);
			return;
		}

		this.context.logger.log(`Fetching OMDB ratings for movie ${movieId} (IMDb: ${imdbId})`);

		const ratings = await this.lookup(imdbId);

		// Only update if we got at least one valid rating
		if (
			ratings.imdbRating !== null ||
			ratings.rottenTomatoesScore !== null ||
			ratings.metacriticScore !== null
		) {
			const metadataUpdate: Record<string, unknown> = {};

			if (ratings.imdbRating !== null) {
				metadataUpdate.imdbRating = ratings.imdbRating;
			}
			if (ratings.imdbVotes !== null) {
				metadataUpdate.imdbVotes = ratings.imdbVotes;
			}
			if (ratings.rottenTomatoesScore !== null) {
				metadataUpdate.rottenTomatoesScore = ratings.rottenTomatoesScore;
			}
			if (ratings.metacriticScore !== null) {
				metadataUpdate.metacriticScore = ratings.metacriticScore;
			}

			await this.context.updateMovieMetadata(movieId, metadataUpdate);

			this.context.logger.log(
				`OMDB ratings updated for movie ${movieId}: IMDb=${ratings.imdbRating}, RT=${ratings.rottenTomatoesScore}%, Metacritic=${ratings.metacriticScore}`,
			);

			this.context.events.emit('ratings:updated', {
				movieId,
				source: 'omdb',
				ratings,
			});
		} else {
			this.context.logger.warn(`No valid ratings found from OMDB for IMDb ID: ${imdbId}`);
		}
	}

	/**
	 * Extracts the IMDb ID from a movie record.
	 * Checks both top-level imdbId and nested extendedData.imdbId.
	 */
	private extractImdbId(movie: Record<string, unknown>): string | null {
		// Check top-level imdbId
		if (typeof movie.imdbId === 'string' && movie.imdbId) {
			return movie.imdbId;
		}

		// Check extendedData (may be a JSON string or object)
		let extendedData = movie.extendedData;

		if (typeof extendedData === 'string') {
			try {
				extendedData = JSON.parse(extendedData) as unknown;
			} catch {
				return null;
			}
		}

		if (extendedData && typeof extendedData === 'object' && 'imdbId' in extendedData) {
			const id = (extendedData as Record<string, unknown>).imdbId;
			if (typeof id === 'string' && id) {
				return id;
			}
		}

		return null;
	}

	/**
	 * Parses the OMDB response into a normalized RatingData object.
	 */
	private parseRatings(data: OmdbResponse): RatingData {
		const ratings: RatingData = {
			imdbRating: null,
			imdbVotes: null,
			rottenTomatoesScore: null,
			metacriticScore: null,
		};

		// Parse IMDb rating (e.g., "8.1")
		if (data.imdbRating && data.imdbRating !== 'N/A') {
			const parsed = parseFloat(data.imdbRating);
			if (!Number.isNaN(parsed)) {
				ratings.imdbRating = parsed;
			}
		}

		// Parse IMDb votes (e.g., "1,234,567")
		if (data.imdbVotes && data.imdbVotes !== 'N/A') {
			const cleaned = data.imdbVotes.replace(/,/g, '');
			const parsed = parseInt(cleaned, 10);
			if (!Number.isNaN(parsed)) {
				ratings.imdbVotes = parsed;
			}
		}

		// Parse Metacritic score (e.g., "74")
		if (data.Metascore && data.Metascore !== 'N/A') {
			const parsed = parseInt(data.Metascore, 10);
			if (!Number.isNaN(parsed)) {
				ratings.metacriticScore = parsed;
			}
		}

		// Parse Rotten Tomatoes score from the Ratings array (e.g., "91%")
		if (data.Ratings && Array.isArray(data.Ratings)) {
			const rtRating = data.Ratings.find((r) => r.Source === 'Rotten Tomatoes');
			if (rtRating?.Value) {
				const match = rtRating.Value.match(/^(\d+)%$/);
				if (match?.[1]) {
					const parsed = parseInt(match[1], 10);
					if (!Number.isNaN(parsed)) {
						ratings.rottenTomatoesScore = parsed;
					}
				}
			}
		}

		return ratings;
	}

	private getApiKey(): string {
		const apiKey = this.context.config.apiKey as string | undefined;

		if (!apiKey) {
			throw new Error('OMDB API key is not configured. Set it in the plugin settings.');
		}

		return apiKey;
	}
}
