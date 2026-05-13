import { WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { ProviderEventsService } from '../providers/provider-events.service.js';
import { RateLimitService } from '../providers/rate-limit.service.js';
import { TraktRecommender } from '../providers/sources/trakt/trakt.recommender.js';
import {
	ExternalRecsRepository,
	type IncomingExternalRec,
} from './external-recs.repository.js';

interface MovieEventPayload {
	movieId?: string;
	source?: string;
}

/**
 * Listens for movie events (new, updated) and snapshots TMDB's
 * `similar` + `recommendations` arrays into `movie_external_recs`.
 *
 * The TMDB details are already in `append_to_response`, so a second
 * `getMovieDetails` call here hits the TmdbProvider cache for free —
 * no extra HTTP traffic.
 *
 * Also back-fills `target_movie_id` on existing rec rows when a new
 * movie lands in the library (a new addition might be the target of
 * a previously-cached neighbour's recs).
 */
@Injectable()
export class ExternalRecsListenerService implements OnModuleInit {
	private readonly logger = new Logger('ExternalRecsListener');

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly tmdb: TmdbProvider,
		private readonly repo: ExternalRecsRepository,
		private readonly trakt: TraktRecommender,
		private readonly rateLimit: RateLimitService,
		private readonly providerEvents: ProviderEventsService,
	) {}

	onModuleInit(): void {
		this.events.on(WsEvent.LIBRARY_MOVIE_UPDATED, (data: unknown) => {
			this.handle(data as MovieEventPayload).catch((err) =>
				this.logger.warn(`UPDATED handler error: ${err?.message ?? err}`),
			);
		});
		this.events.on(WsEvent.LIBRARY_MOVIE_ADDED, (data: unknown) => {
			this.handle(data as MovieEventPayload).catch((err) =>
				this.logger.warn(`ADDED handler error: ${err?.message ?? err}`),
			);
		});
	}

	private async handle(payload: MovieEventPayload): Promise<void> {
		const movieId = payload?.movieId;
		if (!movieId) return;

		const movie = this.database.db
			.select({ id: movies.id, tmdbId: movies.tmdbId, imdbId: movies.imdbId })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		if (!movie) return;

		// Back-fill: this movie might be the target of another movie's recs.
		this.repo.backfillIncomingMovie(movie.id, movie.tmdbId, movie.imdbId);

		// Snapshot TMDB recs.
		if (movie.tmdbId == null) return;
		const details = await this.tmdb.getMovieDetails(movie.tmdbId);
		if (!details) return;

		this.persistTmdbList(movieId, 'tmdb_similar', details.similar?.results ?? []);
		this.persistTmdbList(movieId, 'tmdb_rec', details.recommendations?.results ?? []);

		// Trakt — gated on configured + within rate limit. Best-effort:
		// failures here never block the main metadata path.
		if (this.trakt.isConfigured()) {
			void this.snapshotTrakt(movieId, movie.tmdbId, movie.imdbId);
		}
	}

	private async snapshotTrakt(
		movieId: string,
		tmdbId: number | null,
		imdbId: string | null,
	): Promise<void> {
		try {
			await this.rateLimit.acquire('trakt');
		} catch (err: any) {
			// Quota-exhausted is expected during heavy library scans.
			this.providerEvents.record({
				providerId: 'trakt',
				type: 'rate_limit',
				payload: { reason: err?.name ?? 'rate-limit', movieId },
			});
			return;
		}
		try {
			const client = this.trakt.client();
			if (!client) return;
			const idForCall =
				imdbId ??
				(await client
					.resolveTraktId({ imdb: imdbId, tmdb: tmdbId })
					.then((r) => r?.slug ?? null));
			if (!idForCall) return;
			const started = Date.now();
			const related = await client.related(idForCall, 25);
			this.rateLimit.record('trakt');
			this.providerEvents.record({
				providerId: 'trakt',
				type: 'call',
				statusCode: 200,
				durationMs: Date.now() - started,
			});
			const recs: IncomingExternalRec[] = related.map((m, i) => ({
				rank: i,
				tmdbId: m.ids.tmdb ?? null,
				imdbId: m.ids.imdb ?? null,
				title: m.title,
				year: m.year ?? null,
				raw: { ids: m.ids },
			}));
			this.repo.replace(movieId, 'trakt_related', recs);
		} catch (err: any) {
			this.logger.warn(`Trakt snapshot failed for ${movieId}: ${err?.message ?? err}`);
			this.providerEvents.record({
				providerId: 'trakt',
				type: 'error',
				payload: { message: err?.message ?? 'unknown', movieId },
			});
		}
	}

	private persistTmdbList(
		movieId: string,
		source: 'tmdb_similar' | 'tmdb_rec',
		results: { id: number; title: string; release_date: string; poster_path: string | null }[],
	): void {
		const recs: IncomingExternalRec[] = results.slice(0, 50).map((r, i) => ({
			rank: i,
			tmdbId: r.id,
			title: r.title,
			year: r.release_date ? Number(r.release_date.slice(0, 4)) || null : null,
			raw: { poster_path: r.poster_path },
		}));
		this.repo.replace(movieId, source, recs);
	}
}
