import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BudgetExhausted, RateLimitExceeded } from '../../exceptions.js';
import type { MovieSeed, Recommendation, Recommender } from '../../provider.interface.js';
import { ProviderCredentialsService } from '../../provider-credentials.service.js';
import { ProviderEventsService } from '../../provider-events.service.js';
import { ProviderRegistry } from '../../provider-registry.service.js';
import { RateLimitService } from '../../rate-limit.service.js';
import { TraktHttpClient } from './trakt.http-client.js';
import type { TraktCredentials } from './trakt.types.js';

/**
 * Trakt.tv recommender. Implements the Phase 0 `Recommender`
 * interface against Trakt's `/movies/{id}/related` endpoint —
 * community-driven "people who watched X also watched Y" signal,
 * a strong diversifier on top of TMDB's surface-features algorithm.
 *
 * App-level access (read-only public data) only needs the `client_id`
 * sent as `trakt-api-key`. User OAuth is a future addition for
 * personalised endpoints like `/users/me/recommendations/movies`.
 */
@Injectable()
export class TraktRecommender implements Recommender, OnModuleInit {
	readonly id = 'trakt';
	readonly displayName = 'Trakt.tv';
	readonly description =
		'Community-driven "people who watched X also watched Y" recommendations. Diversifies the TMDB-only signal.';
	readonly capabilities = new Set(['recommend'] as const);
	readonly auth = 'apiKey' as const;
	readonly configFields = [
		{
			key: 'clientId',
			label: 'Client ID',
			description:
				'Trakt API application client_id. Create at https://trakt.tv/oauth/applications (use the OOB redirect URI urn:ietf:wg:oauth:2.0:oob).',
			type: 'string' as const,
			required: true,
		},
		{
			key: 'clientSecret',
			label: 'Client Secret',
			description:
				'Only needed if you want to wire user OAuth later (e.g. for personalised /users/me endpoints). Not used by the recommender itself.',
			type: 'secret' as const,
			required: false,
		},
	];
	readonly rateLimit = {
		perSecond: 1,
		perMinute: 60,
		perDay: 50_000,
	};

	private readonly logger = new Logger('TraktRecommender');

	constructor(
		private readonly registry: ProviderRegistry,
		private readonly credentials: ProviderCredentialsService,
		private readonly rateLimitService: RateLimitService,
		private readonly events: ProviderEventsService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	isConfigured(): boolean {
		const creds = this.credentials.getRaw(this.id) as TraktCredentials | null;
		return !!creds?.clientId;
	}

	async healthCheck() {
		const started = Date.now();
		try {
			const client = this.client();
			if (!client) {
				return { ok: false, detail: 'Not configured', checkedAt: new Date().toISOString() };
			}
			// Trakt has a /search endpoint that's a safe probe.
			const found = await client.resolveTraktId({ title: 'Inception', year: 2010 });
			const ok = !!found;
			this.events.record({
				providerId: this.id,
				type: 'health_check',
				statusCode: ok ? 200 : 404,
				durationMs: Date.now() - started,
			});
			return {
				ok,
				detail: ok ? `Resolved Inception → slug=${found.slug}` : 'No resolution',
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
		if (!this.isConfigured()) return [];
		const client = this.client();
		if (!client) return [];

		try {
			await this.rateLimitService.acquire(this.id);
		} catch (err) {
			if (err instanceof RateLimitExceeded || err instanceof BudgetExhausted) {
				this.events.record({
					providerId: this.id,
					type: 'rate_limit',
					payload: { window: (err as RateLimitExceeded).window },
				});
				throw err;
			}
			throw err;
		}

		const started = Date.now();
		try {
			// Trakt accepts imdb id directly; otherwise resolve to slug first.
			const idForCall =
				seed.imdbId ??
				(await client
					.resolveTraktId({
						imdb: seed.imdbId,
						tmdb: seed.tmdbId,
						title: seed.title,
						year: seed.year ?? undefined,
					})
					.then((r) => r?.slug ?? null));
			if (!idForCall) {
				this.events.record({
					providerId: this.id,
					type: 'call',
					statusCode: 404,
					durationMs: Date.now() - started,
					payload: { reason: 'no_trakt_id' },
				});
				return [];
			}

			const related = await client.related(idForCall, Math.min(k, 25));
			this.rateLimitService.record(this.id);
			this.events.record({
				providerId: this.id,
				type: 'call',
				statusCode: 200,
				durationMs: Date.now() - started,
			});

			return related.map((m, i) => ({
				tmdbId: m.ids.tmdb ?? undefined,
				imdbId: m.ids.imdb ?? undefined,
				title: m.title,
				year: m.year,
				score: 1 / (1 + i / 5),
				explanation: 'Trakt: people who watched this also watched',
				raw: m,
			}));
		} catch (err: any) {
			this.logger.warn(`recommend() error: ${err?.message ?? err}`);
			this.events.record({
				providerId: this.id,
				type: 'error',
				durationMs: Date.now() - started,
				payload: { message: err?.message ?? 'unknown' },
			});
			return [];
		}
	}

	/** Internal helper — also used by the cache listener for snapshotting. */
	client(): TraktHttpClient | null {
		const creds = this.credentials.getRaw(this.id) as TraktCredentials | null;
		if (!creds?.clientId) return null;
		return new TraktHttpClient({ clientId: creds.clientId });
	}
}
