import { WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { EventsService } from '../events/events.service.js';

interface MovieEventPayload {
	movieId?: string;
}

/**
 * Subscribes to `LIBRARY_MOVIE_ADDED` and `LIBRARY_MOVIE_UPDATED`
 * and enqueues plot embedding work. Single-flight per movie: a
 * concurrent embed for the same id is collapsed. Best-effort — a
 * failure to embed never blocks the metadata pipeline.
 */
@Injectable()
export class EmbeddingListenerService implements OnModuleInit {
	private readonly logger = new Logger('EmbeddingListener');
	private readonly inflight = new Set<string>();

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly embeddings: EmbeddingsService,
	) {}

	onModuleInit(): void {
		const handler = (data: unknown) => {
			const payload = data as MovieEventPayload;
			if (!payload?.movieId) return;
			void this.handle(payload.movieId).catch((err) =>
				this.logger.warn(`embed handler error: ${err?.message ?? err}`),
			);
		};
		this.events.on(WsEvent.LIBRARY_MOVIE_UPDATED, handler);
		this.events.on(WsEvent.LIBRARY_MOVIE_ADDED, handler);
	}

	private async handle(movieId: string): Promise<void> {
		if (this.inflight.has(movieId)) return;
		this.inflight.add(movieId);
		try {
			const movie = this.database.db
				.select({ overview: movies.overview })
				.from(movies)
				.where(eq(movies.id, movieId))
				.get();
			const text = movie?.overview?.trim();
			if (!text) return;
			const changed = await this.embeddings.embedMovie(movieId, text);
			if (changed) {
				this.logger.debug(`Embedded movie ${movieId.slice(0, 8)}`);
			}
		} finally {
			this.inflight.delete(movieId);
		}
	}
}
