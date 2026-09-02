import { nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieLlmFeatures, movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { AnthropicClient } from '../llm/anthropic.client.js';
import { SettingsService } from '../settings/settings.service.js';

interface MovieEventPayload {
	movieId?: string;
}

/**
 * Optional one-time LLM enrichment per movie: extracts tone, pace,
 * themes, audience, comparables. Runs only when an LLM client is
 * configured. Bounded by per-day rate limit + monthly budget at the
 * platform layer; we just need to skip on cache hit so we don't
 * re-bill on every metadata refresh.
 */
@Injectable()
export class LlmFeaturesListenerService implements OnModuleInit {
	private readonly logger = new Logger('LlmFeaturesListener');
	private readonly inflight = new Set<string>();

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly llm: AnthropicClient,
		private readonly settings: SettingsService,
	) {}

	onModuleInit(): void {
		const handler = (data: unknown) => {
			const payload = data as MovieEventPayload;
			if (!payload?.movieId) return;
			void this.handle(payload.movieId).catch((err) =>
				this.logger.warn(`features handler error: ${err?.message ?? err}`),
			);
		};
		this.events.on(WsEvent.LIBRARY_MOVIE_UPDATED, handler);
		this.events.on(WsEvent.LIBRARY_MOVIE_ADDED, handler);
	}

	private async handle(movieId: string): Promise<void> {
		// Admin can disable auto LLM feature extraction via Settings >
		// Matching. Default true; respects the per-provider budget
		// even when on.
		const enabled = this.settings.get<boolean>('recommendations.autoEnrichLlmFeatures', true);
		if (!enabled) return;
		if (!this.llm.isConfigured()) return;
		if (this.inflight.has(movieId)) return;
		this.inflight.add(movieId);
		try {
			const existing = this.database.db
				.select({ movieId: movieLlmFeatures.movieId })
				.from(movieLlmFeatures)
				.where(
					and(
						eq(movieLlmFeatures.movieId, movieId),
						eq(movieLlmFeatures.model, this.llm.id),
					),
				)
				.get();
			if (existing) return;

			const row = this.database.db
				.select({
					id: movies.id,
					title: movies.title,
					year: movies.year,
					overview: movies.overview,
					genres: movieMetadata.genres,
					directors: movieMetadata.directors,
				})
				.from(movies)
				.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
				.where(eq(movies.id, movieId))
				.get();
			if (!row || !row.overview) return;

			const features = await this.llm.features({
				id: row.id,
				title: row.title,
				year: row.year ?? null,
				overview: row.overview,
				genres: parseArr(row.genres),
				directors: parseArr(row.directors),
			});
			if (!features || Object.keys(features).length === 0) return;

			this.database.db
				.insert(movieLlmFeatures)
				.values({
					movieId,
					model: this.llm.id,
					features: JSON.stringify(features),
					generatedAt: nowISO(),
				})
				.run();
			this.logger.debug(`Extracted LLM features for ${movieId.slice(0, 8)}`);
		} finally {
			this.inflight.delete(movieId);
		}
	}
}

function parseArr(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const p = JSON.parse(value);
		return Array.isArray(p) ? p : [];
	} catch {
		return [];
	}
}
