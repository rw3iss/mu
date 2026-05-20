import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { movieMetadata, movies } from '../../database/schema/index.js';
import type { JobRecord } from '../../jobs/job.interface.js';
import { JobManagerService } from '../../jobs/job-manager.service.js';
import { BudgetExhausted, RateLimitExceeded } from '../exceptions.js';
import { MovieIdentityService } from '../identity/movie-identity.service.js';
import { MovieSourcePayloadsService } from '../identity/movie-source-payloads.service.js';
import { MergeEngine } from '../merge/merge-engine.js';
import type { CanonicalField, SourceContribution } from '../merge/merge-types.js';
import {
	type EnrichField,
	isEnricher,
	isSearcher,
	type MovieSeed,
	type SearchHit,
} from '../provider.interface.js';
import { ProviderRegistry } from '../provider-registry.service.js';
import { RateLimitService } from '../rate-limit.service.js';

const JOB_TYPE = 'source-backfill';
const WANT_FIELDS = new Set<EnrichField>(['keywords', 'tags', 'themes', 'ratings', 'comparables']);

/**
 * Re-enriches the library through a newly-configured source.
 *
 * Trigger flow:
 *   Sources UI → POST /providers/:id/backfill → enqueueForLibrary(id)
 *   → one `source-backfill` job per movie
 *   → handler runs provider.search() (if Searcher) and / or
 *     provider.enrich() (if Enricher) → MergeEngine → persist
 *
 * SOLID:
 *   - SRP: this service ONLY drives "iterate library through a
 *     provider"; it doesn't know HOW any specific provider works,
 *     only that it conforms to the Searcher / Enricher contracts.
 *   - OCP: adding a new source needs ZERO changes here. The new
 *     provider's onModuleInit registration auto-makes it eligible.
 *   - DIP: depends on ProviderRegistry abstraction, not concrete
 *     provider classes.
 */
@Injectable()
export class SourceBackfillService implements OnModuleInit {
	private readonly logger = new Logger('SourceBackfillService');

	constructor(
		private readonly database: DatabaseService,
		private readonly jobs: JobManagerService,
		private readonly registry: ProviderRegistry,
		private readonly rateLimit: RateLimitService,
		private readonly mergeEngine: MergeEngine,
		private readonly identityService: MovieIdentityService,
		private readonly payloadsService: MovieSourcePayloadsService,
	) {}

	onModuleInit(): void {
		this.jobs.registerHandler(JOB_TYPE, (job) => this.handle(job));
	}

	/**
	 * Enqueue one backfill job per movie in the library. Idempotent:
	 * if a job for the same (providerId, movieId) is already pending
	 * or running, we skip — repeated calls don't multiply queue size.
	 *
	 * Returns the count of jobs newly enqueued (not the total queued).
	 */
	enqueueForLibrary(providerId: string): {
		queued: number;
		alreadyQueued: number;
		totalMovies: number;
	} {
		const provider = this.registry.get(providerId);
		if (!provider) {
			throw new Error(`Provider "${providerId}" not registered`);
		}
		if (!isSearcher(provider) && !isEnricher(provider)) {
			throw new Error(
				`Provider "${providerId}" supports neither 'search' nor 'enrich' — nothing to back-fill`,
			);
		}

		const ids = this.database.db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.source, 'library'))
			.all()
			.map((r) => r.id);

		let queued = 0;
		let alreadyQueued = 0;
		for (const movieId of ids) {
			const existing = this.jobs.findJobsByPayload('movieId', movieId, JOB_TYPE, [
				'pending',
				'running',
			]);
			const sameProvider = existing.find((j) => j.payload?.providerId === providerId);
			if (sameProvider) {
				alreadyQueued++;
				continue;
			}
			this.jobs.enqueue({
				type: JOB_TYPE,
				label: `Back-fill ${provider.displayName} for movie ${movieId.slice(0, 8)}`,
				payload: { providerId, movieId },
				priority: 60, // lower than user-triggered enrichment (40)
			});
			queued++;
		}
		return { queued, alreadyQueued, totalMovies: ids.length };
	}

	/**
	 * One movie × one provider. Returns a small status object the
	 * job system records for observability.
	 */
	private async handle(job: JobRecord): Promise<unknown> {
		const providerId = job.payload?.providerId as string | undefined;
		const movieId = job.payload?.movieId as string | undefined;
		if (!providerId || !movieId) {
			throw new Error('Missing providerId / movieId payload');
		}

		const provider = this.registry.get(providerId);
		if (!provider) return { skipped: 'provider-unregistered' };
		if (!provider.isConfigured()) return { skipped: 'provider-not-configured' };

		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) return { skipped: 'movie-not-found' };

		const seed: MovieSeed = {
			id: movie.id,
			title: movie.title,
			year: movie.year ?? null,
			tmdbId: movie.tmdbId ?? null,
			imdbId: movie.imdbId ?? null,
			overview: movie.overview ?? null,
		};

		// Rate-limit: respect this provider's bucket. Soft-fail (skip
		// + leave the job to retry later) so a hot bucket doesn't lose
		// the whole back-fill batch.
		try {
			await this.rateLimit.acquire(providerId);
		} catch (err) {
			if (err instanceof RateLimitExceeded || err instanceof BudgetExhausted) {
				return { skipped: 'rate-limit' };
			}
			throw err;
		}

		let bestHit: SearchHit | null = null;
		const contributions: SourceContribution[] = [];
		const rawPayloads: unknown[] = [];

		// --- Searcher pass: cross-ID resolution + best-match ----------------
		if (isSearcher(provider)) {
			const hits = await provider.search(
				{
					title: seed.title,
					year: seed.year ?? null,
					imdbId: seed.imdbId ?? null,
					tmdbId: seed.tmdbId ?? null,
				},
				5,
			);
			if (hits.length > 0) {
				bestHit = hits[0]!;
				rawPayloads.push({ kind: 'search', hits });
				// Record every cross-ID the provider knows about.
				const ids: { source: string; externalId: string | number }[] = [];
				for (const [src, ext] of Object.entries(bestHit.externalIds)) {
					if (src === providerId) continue; // skip self
					ids.push({ source: src, externalId: ext });
				}
				if (ids.length > 0) {
					await this.identityService.linkMany({ movieId: seed.id, identities: ids });
				}
				// The Searcher itself: link the provider's own id for the movie.
				const selfId = bestHit.externalIds[providerId] ?? bestHit.externalIds.wikidata;
				if (selfId) {
					await this.identityService.link({
						movieId: seed.id,
						source: providerId,
						externalId: selfId,
						confidence: bestHit.confidence ?? 1,
					});
				}
				// Title/year contribution (low precedence by default — TMDB wins).
				contributions.push({
					source: providerId,
					fields: {
						title: bestHit.title,
						year: bestHit.year ?? null,
						posterUrl: bestHit.posterUrl ?? null,
						runtimeMinutes: bestHit.durationMinutes ?? null,
					},
				});
			}
		}

		// --- Enricher pass: per-source extras --------------------------------
		if (isEnricher(provider)) {
			const result = await provider.enrich(seed, WANT_FIELDS);
			rawPayloads.push({ kind: 'enrich', result });
			// EnrichResult doesn't map 1:1 to CanonicalFields — keywords is
			// our closest match. Future per-source adapters can map more
			// fields; this is the safe baseline.
			const fields: Partial<Record<CanonicalField, unknown>> = {};
			if (result.keywords && result.keywords.length > 0) fields.keywords = result.keywords;
			if (Object.keys(fields).length > 0) {
				contributions.push({ source: providerId, fields });
			}
		}

		this.rateLimit.record(providerId);

		if (rawPayloads.length > 0) {
			void this.payloadsService.store({ movieId, source: providerId, payload: rawPayloads });
		}

		if (contributions.length === 0) {
			return { ok: true, matched: !!bestHit, fields: 0 };
		}

		// --- Merge + persist -------------------------------------------------
		const existingMeta = this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
		const existingProvenance = parseProvenance(existingMeta?.provenance);
		const existingCanonical = {
			title: movie.title,
			year: movie.year ?? null,
			posterUrl: movie.posterUrl ?? null,
			runtimeMinutes: movie.runtimeMinutes ?? null,
			keywords: existingMeta?.keywords ? safeParse(existingMeta.keywords) : [],
		};

		const merge = this.mergeEngine.apply(existingCanonical, existingProvenance, contributions);
		const now = new Date().toISOString();

		// Apply movie-row fields (only the few we touched).
		const movieUpdate: Record<string, unknown> = { updatedAt: now };
		const setIf = (k: keyof typeof movieUpdate, v: unknown) => {
			if (v != null && v !== '') movieUpdate[k] = v;
		};
		setIf('title', merge.merged.title);
		setIf('year', merge.merged.year);
		setIf('posterUrl', merge.merged.posterUrl);
		setIf('runtimeMinutes', merge.merged.runtimeMinutes);
		if (Object.keys(movieUpdate).length > 1) {
			this.database.db.update(movies).set(movieUpdate).where(eq(movies.id, movieId)).run();
		}

		// Metadata row.
		const metaValues: Record<string, unknown> = {
			keywords: JSON.stringify(merge.merged.keywords ?? []),
			provenance: JSON.stringify(merge.provenance),
			updatedAt: now,
		};
		if (existingMeta) {
			this.database.db
				.update(movieMetadata)
				.set(metaValues)
				.where(eq(movieMetadata.id, existingMeta.id))
				.run();
		}

		return { ok: true, matched: !!bestHit, fieldChanges: merge.diff.length };
	}
}

function parseProvenance(input: string | null | undefined): Record<string, string> {
	if (!input) return {};
	try {
		const parsed = JSON.parse(input);
		return typeof parsed === 'object' && parsed != null ? parsed : {};
	} catch {
		return {};
	}
}

function safeParse(input: string): any {
	try {
		return JSON.parse(input);
	} catch {
		return null;
	}
}
