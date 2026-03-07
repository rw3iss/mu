import type {
  IPlugin,
  PluginContext,
  PluginInfo,
} from '../../packages/server/src/plugins/plugin.interface.js';

const OMDB_API_BASE = 'https://www.omdbapi.com/';
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface OmdbRating {
  Source: string;
  Value: string;
}

interface OmdbResponse {
  Title?: string;
  Year?: string;
  imdbID?: string;
  Ratings?: OmdbRating[];
  Response: string;
  Error?: string;
}

interface RottenTomatoesScore {
  title: string;
  year: string | null;
  tomatoScore: number | null;
  tomatoConsensus: string | null;
  imdbId: string | null;
  source: string;
}

export default class RottenTomatoesPlugin implements IPlugin {
  private context!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context;
    this.context.logger.log('Rotten Tomatoes Scores plugin loaded');
  }

  async onUnload(): Promise<void> {
    this.context.logger.log('Rotten Tomatoes Scores plugin unloaded');
  }

  getInfo(): PluginInfo {
    return {
      name: 'rotten-tomatoes',
      version: '1.0.0',
      description: 'Fetch Rotten Tomatoes scores via OMDB API',
      author: 'Mu',
      enabled: true,
      loaded: true,
      permissions: ['network', 'cache'],
    };
  }

  /**
   * GET /score?title=Movie+Name&year=2024
   * Looks up the Rotten Tomatoes score for a movie by title and optional year.
   * Uses OMDB API to extract the Rotten Tomatoes score since RT has no public API.
   */
  async getScore(title: string, year?: number): Promise<RottenTomatoesScore> {
    if (!title || title.trim().length === 0) {
      throw new Error('Movie title is required');
    }

    const normalizedTitle = title.trim().toLowerCase();
    const cacheKey = `rt:score:${normalizedTitle}:${year ?? ''}`;
    const cached = await this.context.cache.get<RottenTomatoesScore>(cacheKey);

    if (cached) {
      this.context.logger.debug(`Cache hit for RT score: "${title}"`);
      return cached;
    }

    this.context.logger.debug(
      `Looking up Rotten Tomatoes score for "${title}" (${year ?? 'no year'})`,
    );

    // Try OMDB lookup by title (and optionally year)
    let score = await this.lookupViaOmdb(title, year);

    // If no score found and year was provided, retry without year as fallback
    if (score.tomatoScore === null && year) {
      this.context.logger.debug(
        `No RT score found with year ${year}, retrying without year constraint`,
      );
      const fallbackScore = await this.lookupViaOmdb(title);
      if (fallbackScore.tomatoScore !== null) {
        score = fallbackScore;
      }
    }

    await this.context.cache.set(cacheKey, score, CACHE_TTL_SECONDS);

    if (score.tomatoScore !== null) {
      this.context.logger.log(
        `Rotten Tomatoes score for "${title}": ${score.tomatoScore}%`,
      );
    } else {
      this.context.logger.debug(
        `No Rotten Tomatoes score found for "${title}"`,
      );
    }

    return score;
  }

  /**
   * Looks up a movie via the OMDB API and extracts the Rotten Tomatoes score.
   */
  private async lookupViaOmdb(
    title: string,
    year?: number,
  ): Promise<RottenTomatoesScore> {
    const apiKey = this.getApiKey();

    const params = new URLSearchParams({
      apikey: apiKey,
      t: title,
      type: 'movie',
    });

    if (year) {
      params.set('y', String(year));
    }

    const url = `${OMDB_API_BASE}?${params.toString()}`;

    try {
      const response = await this.context.http.fetch(url);

      if (!response.ok) {
        this.context.logger.error(
          `OMDB API HTTP error: ${response.status} ${response.statusText}`,
        );
        return this.buildEmptyScore(title, year);
      }

      const data = (await response.json()) as OmdbResponse;

      if (data.Response === 'False') {
        this.context.logger.debug(
          `OMDB returned no results for "${title}": ${data.Error ?? 'Movie not found'}`,
        );
        return this.buildEmptyScore(title, year);
      }

      return this.extractRottenTomatoesScore(data);
    } catch (err) {
      this.context.logger.error(
        `Failed to fetch OMDB data for "${title}": ${err instanceof Error ? err.message : err}`,
      );
      return this.buildEmptyScore(title, year);
    }
  }

  /**
   * Extracts the Rotten Tomatoes score from an OMDB response.
   * The OMDB API includes Rotten Tomatoes scores in the Ratings array.
   */
  private extractRottenTomatoesScore(data: OmdbResponse): RottenTomatoesScore {
    const result: RottenTomatoesScore = {
      title: data.Title ?? '',
      year: data.Year ?? null,
      tomatoScore: null,
      tomatoConsensus: null,
      imdbId: data.imdbID ?? null,
      source: 'omdb',
    };

    if (!data.Ratings || !Array.isArray(data.Ratings)) {
      return result;
    }

    // Find the Rotten Tomatoes entry in the Ratings array
    const rtRating = data.Ratings.find(
      (rating) => rating.Source === 'Rotten Tomatoes',
    );

    if (!rtRating || !rtRating.Value) {
      return result;
    }

    // Parse the percentage value (e.g., "91%")
    const match = rtRating.Value.match(/^(\d+)%$/);
    if (match?.[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed)) {
        result.tomatoScore = parsed;
      }
    }

    return result;
  }

  /**
   * Builds an empty score result for when no data is available.
   */
  private buildEmptyScore(
    title: string,
    year?: number,
  ): RottenTomatoesScore {
    return {
      title,
      year: year ? String(year) : null,
      tomatoScore: null,
      tomatoConsensus: null,
      imdbId: null,
      source: 'omdb',
    };
  }

  /**
   * Gets the OMDB API key from plugin configuration.
   * Since Rotten Tomatoes has no public API, we use OMDB which includes RT scores.
   * The API key can be shared with the omdb-ratings plugin or configured separately.
   */
  private getApiKey(): string {
    // Check for a dedicated API key first, then fall back to a shared OMDB key
    const apiKey = (this.context.config.apiKey as string | undefined) ??
      (this.context.config.omdbApiKey as string | undefined);

    if (!apiKey) {
      throw new Error(
        'OMDB API key is not configured. Since Rotten Tomatoes has no public API, ' +
        'this plugin uses OMDB to retrieve RT scores. Set the apiKey in plugin settings.',
      );
    }

    return apiKey;
  }
}
