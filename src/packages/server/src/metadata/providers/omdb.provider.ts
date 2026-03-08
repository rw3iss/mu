import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { CacheService } from '../../cache/cache.service.js';
import { CACHE_NAMESPACES, CACHE_TTL } from '@mu/shared';

const OMDB_BASE_URL = 'https://www.omdbapi.com';

interface OmdbResult {
  Title: string;
  Year: string;
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
}

export interface OmdbSearchResult extends OmdbData {
  imdbId: string;
  title: string;
  year: number | null;
  runtimeMinutes: number | null;
}

@Injectable()
export class OmdbProvider {
  private readonly logger = new Logger('OmdbProvider');
  private readonly apiKey: string | null;

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {
    this.apiKey = this.config.get<string>('metadata.omdbApiKey', '') || null;
    if (this.apiKey) {
      this.logger.log('OMDB provider initialized');
    } else {
      this.logger.warn('OMDB API key not configured');
    }
  }

  async getByImdbId(imdbId: string): Promise<OmdbData | null> {
    if (!this.apiKey) return null;

    const cacheKey = `omdb:${imdbId}`;
    const cached = await this.cache.get<OmdbData>(CACHE_NAMESPACES.METADATA, cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      apikey: this.apiKey,
      i: imdbId,
      plot: 'full',
    });

    try {
      const response = await fetch(`${OMDB_BASE_URL}/?${params}`);
      if (!response.ok) {
        this.logger.warn(`OMDB request failed: ${response.status}`);
        return null;
      }

      const raw = await response.json() as OmdbResult;
      if (raw.Response === 'False') {
        this.logger.warn(`OMDB error for ${imdbId}: ${raw.Error}`);
        return null;
      }

      const rtRating = raw.Ratings?.find((r) => r.Source === 'Rotten Tomatoes');
      const rtScore = rtRating ? parseInt(rtRating.Value, 10) : null;

      const result: OmdbData = {
        imdbRating: raw.imdbRating && raw.imdbRating !== 'N/A' ? parseFloat(raw.imdbRating) : null,
        imdbVotes: raw.imdbVotes && raw.imdbVotes !== 'N/A'
          ? parseInt(raw.imdbVotes.replace(/,/g, ''), 10)
          : null,
        rottenTomatoesScore: !isNaN(rtScore as number) ? rtScore : null,
        metacriticScore: raw.Metascore && raw.Metascore !== 'N/A' ? parseInt(raw.Metascore, 10) : null,
        plot: raw.Plot && raw.Plot !== 'N/A' ? raw.Plot : null,
        director: raw.Director && raw.Director !== 'N/A' ? raw.Director : null,
        writer: raw.Writer && raw.Writer !== 'N/A' ? raw.Writer : null,
        actors: raw.Actors && raw.Actors !== 'N/A' ? raw.Actors : null,
        genre: raw.Genre && raw.Genre !== 'N/A' ? raw.Genre : null,
      };

      await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, result, CACHE_TTL.METADATA);
      return result;
    } catch (err: any) {
      this.logger.error(`OMDB error: ${err.message}`);
      return null;
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
      const response = await fetch(`${OMDB_BASE_URL}/?${params}`);
      if (!response.ok) {
        this.logger.warn(`OMDB title search failed: ${response.status}`);
        return null;
      }

      const raw = await response.json() as OmdbResult;
      if (raw.Response === 'False') {
        this.logger.debug?.(`OMDB no result for "${title}": ${raw.Error}`);
        return null;
      }

      const rtRating = raw.Ratings?.find((r) => r.Source === 'Rotten Tomatoes');
      const rtScore = rtRating ? parseInt(rtRating.Value, 10) : null;

      const runtimeMatch = raw.Runtime?.match(/(\d+)/);
      const runtimeMinutes = runtimeMatch ? parseInt(runtimeMatch[1]!, 10) : null;

      const yearParsed = raw.Year ? parseInt(raw.Year, 10) : null;

      const result: OmdbSearchResult = {
        imdbId: raw.imdbID,
        title: raw.Title,
        year: !isNaN(yearParsed as number) ? yearParsed : null,
        runtimeMinutes,
        imdbRating: raw.imdbRating && raw.imdbRating !== 'N/A' ? parseFloat(raw.imdbRating) : null,
        imdbVotes: raw.imdbVotes && raw.imdbVotes !== 'N/A'
          ? parseInt(raw.imdbVotes.replace(/,/g, ''), 10)
          : null,
        rottenTomatoesScore: !isNaN(rtScore as number) ? rtScore : null,
        metacriticScore: raw.Metascore && raw.Metascore !== 'N/A' ? parseInt(raw.Metascore, 10) : null,
        plot: raw.Plot && raw.Plot !== 'N/A' ? raw.Plot : null,
        director: raw.Director && raw.Director !== 'N/A' ? raw.Director : null,
        writer: raw.Writer && raw.Writer !== 'N/A' ? raw.Writer : null,
        actors: raw.Actors && raw.Actors !== 'N/A' ? raw.Actors : null,
        genre: raw.Genre && raw.Genre !== 'N/A' ? raw.Genre : null,
      };

      await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, result, CACHE_TTL.METADATA);
      return result;
    } catch (err: any) {
      this.logger.error(`OMDB title search error: ${err.message}`);
      return null;
    }
  }
}
