import { CACHE_NAMESPACES, CACHE_TTL } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service.js';
import { ProviderCredentialsService } from '../../provider-credentials.service.js';
import {
	TraktHttpClient,
	type TraktMovieSearchHit,
	type TraktPersonSearchHit,
} from './trakt.http-client.js';

/**
 * Federated-search adapter for Trakt. Reads credentials from the
 * provider credentials store on each call (cheap, single-row lookup)
 * and degrades gracefully when no client_id is configured — no
 * thrown errors, just empty results.
 */
@Injectable()
export class TraktSearchProvider {
	private readonly logger = new Logger('TraktSearchProvider');

	constructor(
		private readonly credentials: ProviderCredentialsService,
		private readonly cache: CacheService,
	) {}

	private getClient(): TraktHttpClient | null {
		const raw = this.credentials.getRaw('trakt');
		const clientId = typeof raw?.clientId === 'string' ? raw.clientId : undefined;
		if (!clientId) return null;
		return new TraktHttpClient({ clientId });
	}

	async searchMovies(query: string): Promise<TraktMovieSearchHit[]> {
		const client = this.getClient();
		if (!client) return [];
		const cacheKey = `trakt:search:movie:${query.toLowerCase()}`;
		const cached = await this.cache.get<TraktMovieSearchHit[]>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;
		try {
			const out = await client.searchMovies(query);
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, out, CACHE_TTL.METADATA);
			return out;
		} catch (err: any) {
			this.logger.warn(`Trakt searchMovies failed: ${err.message}`);
			return [];
		}
	}

	async searchPeople(query: string): Promise<TraktPersonSearchHit[]> {
		const client = this.getClient();
		if (!client) return [];
		const cacheKey = `trakt:search:person:${query.toLowerCase()}`;
		const cached = await this.cache.get<TraktPersonSearchHit[]>(
			CACHE_NAMESPACES.METADATA,
			cacheKey,
		);
		if (cached) return cached;
		try {
			const out = await client.searchPeople(query);
			await this.cache.set(CACHE_NAMESPACES.METADATA, cacheKey, out, CACHE_TTL.METADATA);
			return out;
		} catch (err: any) {
			this.logger.warn(`Trakt searchPeople failed: ${err.message}`);
			return [];
		}
	}
}
