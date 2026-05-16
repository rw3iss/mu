import { nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import type { JobRecord } from '../jobs/job.interface.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { OmdbProvider } from '../metadata/providers/omdb.provider.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { BudgetExhausted, RateLimitExceeded } from '../providers/exceptions.js';
import { RateLimitService } from '../providers/rate-limit.service.js';

const JOB_TYPE = 'external-enrichment';

/**
 * Background enrichment for external movie stubs. Strategy B: the
 * Discover endpoint returns whatever it has immediately and enqueues
 * enrichment jobs for unenriched candidates. By the user's next visit
 * the metadata + (via the embedding listener) plot embedding are in
 * place, and ranking improves naturally.
 *
 * Wraps `TmdbProvider.getMovieDetails` with the provider platform's
 * rate limiter so a burst of Discover requests doesn't blow our TMDB
 * quota — surplus jobs requeue with a `runAfter` honouring the next
 * bucket reset.
 *
 * Idempotent: short-circuits if the row already has an overview (the
 * cheap "is enriched?" proxy).
 */
@Injectable()
export class ExternalEnrichmentService implements OnModuleInit {
	private readonly logger = new Logger('ExternalEnrichmentService');

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly jobs: JobManagerService,
		private readonly tmdb: TmdbProvider,
		private readonly omdb: OmdbProvider,
		private readonly rateLimit: RateLimitService,
	) {}

	onModuleInit(): void {
		this.jobs.registerHandler(JOB_TYPE, (job) => this.handle(job));
	}

	enqueue(movieId: string): void {
		const existing = this.jobs.findJobsByPayload('movieId', movieId, JOB_TYPE, [
			'pending',
			'running',
		]);
		if (existing.length > 0) return; // already queued
		this.jobs.enqueue({
			type: JOB_TYPE,
			label: `Enrich external movie ${movieId.slice(0, 8)}`,
			payload: { movieId },
			priority: 40,
		});
	}

	enqueueBulk(movieIds: readonly string[]): number {
		let count = 0;
		for (const id of movieIds) {
			this.enqueue(id);
			count++;
		}
		return count;
	}

	private async handle(job: JobRecord): Promise<unknown> {
		const movieId = job.payload?.movieId as string | undefined;
		if (!movieId) throw new Error('Missing movieId payload');

		const movie = this.database.db
			.select({
				id: movies.id,
				tmdbId: movies.tmdbId,
				source: movies.source,
				overview: movies.overview,
			})
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		if (!movie) {
			throw new Error(`Movie ${movieId} not found (likely evicted)`);
		}
		if (movie.overview) {
			// Already enriched — nothing to do.
			return { skipped: 'already-enriched' };
		}
		if (movie.tmdbId == null) {
			throw new Error(`Movie ${movieId} has no tmdbId — cannot enrich`);
		}

		try {
			await this.rateLimit.acquire('tmdb');
		} catch (err) {
			if (err instanceof RateLimitExceeded || err instanceof BudgetExhausted) {
				// Soft fail: leave the job runner to retry via the user's
				// next visit. We don't have native runAfter, so just bail.
				this.logger.debug(`Skipping ${movieId.slice(0, 8)}: ${err.message}`);
				return { skipped: 'rate-limit' };
			}
			throw err;
		}

		const details = await this.tmdb.getMovieDetails(movie.tmdbId);
		this.rateLimit.record('tmdb');
		if (!details) {
			throw new Error(`TMDB returned no details for ${movie.tmdbId}`);
		}

		const now = nowISO();
		this.database.db
			.update(movies)
			.set({
				title: details.title ?? undefined,
				originalTitle:
					details.original_title !== details.title ? details.original_title : null,
				year: details.release_date
					? parseInt(details.release_date.slice(0, 4), 10) || undefined
					: undefined,
				overview: details.overview ?? null,
				tagline: details.tagline ?? null,
				runtimeMinutes: details.runtime ?? null,
				releaseDate: details.release_date ?? null,
				language: details.spoken_languages?.[0]?.iso_639_1 ?? null,
				country: details.production_countries?.[0]?.iso_3166_1 ?? null,
				posterUrl: this.tmdb.getImageUrl(details.poster_path) ?? null,
				backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280') ?? null,
				imdbId: details.imdb_id ?? null,
				updatedAt: now,
			})
			.where(eq(movies.id, movieId))
			.run();

		// Optional OMDB augmentation — adds IMDB rating + RT + Metacritic
		// when:
		//   - TMDB returned an imdb_id we can query by
		//   - OMDB key is configured (provider returns null otherwise)
		//   - the call itself doesn't fail (any error is swallowed; we
		//     still ship TMDB-only metadata).
		let omdbAugment: {
			imdbRating: number | null;
			imdbVotes: number | null;
			rottenTomatoesScore: number | null;
			metacriticScore: number | null;
		} | null = null;
		if (details.imdb_id) {
			try {
				const omdbData = await this.omdb.getByImdbId(details.imdb_id);
				if (omdbData) {
					omdbAugment = {
						imdbRating: omdbData.imdbRating,
						imdbVotes: omdbData.imdbVotes,
						rottenTomatoesScore: omdbData.rottenTomatoesScore,
						metacriticScore: omdbData.metacriticScore,
					};
				}
			} catch (err: any) {
				this.logger.debug(
					`OMDB augment failed for ${details.imdb_id} (non-fatal): ${err?.message}`,
				);
			}
		}

		const metaValues = {
			id: crypto.randomUUID(),
			movieId,
			genres: JSON.stringify(details.genres?.map((g) => g.name) ?? []),
			cast: JSON.stringify(
				(details.credits?.cast ?? []).slice(0, 15).map((c) => ({
					name: c.name,
					character: c.character,
					tmdbId: c.id,
				})),
			),
			directors: JSON.stringify(
				(details.credits?.crew ?? [])
					.filter((c) => c.job === 'Director')
					.map((c) => c.name),
			),
			writers: JSON.stringify(
				(details.credits?.crew ?? [])
					.filter((c) => c.department === 'Writing')
					.map((c) => c.name),
			),
			keywords: JSON.stringify(details.keywords?.keywords?.map((k) => k.name) ?? []),
			productionCompanies: JSON.stringify(
				details.production_companies?.map((c) => c.name) ?? [],
			),
			budget: details.budget ?? null,
			revenue: details.revenue ?? null,
			tmdbRating: details.vote_average ?? null,
			tmdbVotes: details.vote_count ?? null,
			// OMDB augment — null when OMDB isn't configured / unavailable.
			imdbRating: omdbAugment?.imdbRating ?? null,
			imdbVotes: omdbAugment?.imdbVotes ?? null,
			rottenTomatoesScore: omdbAugment?.rottenTomatoesScore ?? null,
			metacriticScore: omdbAugment?.metacriticScore ?? null,
			source: omdbAugment ? 'tmdb+omdb' : 'tmdb',
			fetchedAt: now,
			updatedAt: now,
		};
		// Upsert metadata.
		const existingMeta = this.database.db
			.select({ id: movieMetadata.id })
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
		if (existingMeta) {
			this.database.db
				.update(movieMetadata)
				.set(metaValues)
				.where(eq(movieMetadata.id, existingMeta.id))
				.run();
		} else {
			this.database.db
				.insert(movieMetadata)
				.values(metaValues as any)
				.run();
		}

		// Fire the same event the regular metadata pipeline uses so the
		// embedding listener picks it up automatically.
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
			movieId,
			source: 'external-enrichment',
		});

		this.logger.debug(`Enriched external movie ${movieId.slice(0, 8)} (${details.title})`);
		return { ok: true };
	}
}
