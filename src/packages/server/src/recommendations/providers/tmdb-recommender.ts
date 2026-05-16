import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TmdbProvider } from '../../metadata/providers/tmdb.provider.js';
import type { MovieSeed, Recommendation, Recommender } from '../../providers/provider.interface.js';
import { ProviderEventsService } from '../../providers/provider-events.service.js';
import { ProviderRegistry } from '../../providers/provider-registry.service.js';
import { RateLimitService } from '../../providers/rate-limit.service.js';

/**
 * Adapter that exposes the existing TmdbProvider through the Phase 0
 * `Recommender` interface. The platform's rate limiter, audit log,
 * and credentials surface all consume this transparently; no code
 * outside this file imports TmdbProvider for recommendation purposes.
 *
 * `isConfigured()` defers to the underlying provider's apiKey
 * presence — credentials still live in `config.yml` for backward
 * compat with the existing metadata pipeline. A future migration
 * can move the key into `provider_credentials` without callsite
 * changes.
 */
@Injectable()
export class TmdbRecommender implements Recommender, OnModuleInit {
	readonly id = 'tmdb';
	readonly displayName = 'The Movie Database';
	readonly description =
		'TMDB — content metadata, similar movies, and recommendations. Free, generous rate limit, already used by the metadata pipeline.';
	readonly capabilities = new Set(['recommend', 'enrich'] as const);
	readonly auth = 'apiKey' as const;
	readonly configFields = [
		{
			key: 'apiKey',
			label: 'API Key',
			description:
				'v4 read access token, or v3 API key. Currently sourced from config.yml — paste here to migrate to DB storage.',
			type: 'secret' as const,
			required: true,
		},
	];
	readonly rateLimit = {
		perSecond: 4,
		perDay: 50_000,
	};

	private readonly logger = new Logger('TmdbRecommender');

	constructor(
		private readonly tmdb: TmdbProvider,
		private readonly registry: ProviderRegistry,
		private readonly rateLimitService: RateLimitService,
		private readonly events: ProviderEventsService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	isConfigured(): boolean {
		// The underlying provider stores apiKey internally; reach for
		// the search() probe rather than poking at private state.
		return (this.tmdb as unknown as { apiKey: string | null }).apiKey != null;
	}

	async healthCheck() {
		const started = Date.now();
		try {
			const results = await this.tmdb.searchMovie('Inception', 2010);
			const ok = Array.isArray(results) && results.length > 0;
			const durationMs = Date.now() - started;
			this.events.record({
				providerId: this.id,
				type: 'health_check',
				statusCode: ok ? 200 : 500,
				durationMs,
			});
			return {
				ok,
				detail: ok ? `Returned ${results!.length} results` : 'No results',
				checkedAt: new Date().toISOString(),
			};
		} catch (err: any) {
			return {
				ok: false,
				detail: err?.message ?? 'unknown',
				checkedAt: new Date().toISOString(),
			};
		}
	}

	async recommend(seed: MovieSeed, k: number): Promise<Recommendation[]> {
		if (!seed.tmdbId || !this.isConfigured()) return [];
		await this.rateLimitService.acquire(this.id);
		const started = Date.now();
		try {
			const details = await this.tmdb.getMovieDetails(seed.tmdbId);
			const durationMs = Date.now() - started;
			this.rateLimitService.record(this.id);
			this.events.record({
				providerId: this.id,
				type: 'call',
				statusCode: details ? 200 : 404,
				durationMs,
			});
			const results = details?.similar?.results ?? [];
			return results.slice(0, k).map((r, i) => ({
				tmdbId: r.id,
				title: r.title,
				year: r.release_date ? Number(r.release_date.slice(0, 4)) || null : null,
				score: 1 / (1 + i / 5),
				explanation: 'TMDB similar movies',
				posterUrl: this.tmdb.getImageUrl(r.poster_path) ?? undefined,
				raw: r,
			}));
		} catch (err: any) {
			const durationMs = Date.now() - started;
			this.events.record({
				providerId: this.id,
				type: 'error',
				durationMs,
				payload: { message: err?.message ?? 'unknown' },
			});
			this.logger.warn(`recommend() error: ${err?.message}`);
			return [];
		}
	}
}
