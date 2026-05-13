import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieRecExplanations } from '../database/schema/index.js';
import { AnthropicClient } from '../llm/anthropic.client.js';
import type { MovieSeed } from '../providers/provider.interface.js';

/**
 * On-demand cache of LLM-generated "why X is similar to Y"
 * explanations. Called by the orchestrator when an `LLMClient` is
 * configured and the matching settings request explanations.
 *
 * Idempotent: cache hit returns instantly; misses cost a sub-cent
 * call. Bounded by the same monthly budget as everything else.
 */
@Injectable()
export class ExplanationsService {
	private readonly logger = new Logger('ExplanationsService');

	constructor(
		private readonly database: DatabaseService,
		private readonly llm: AnthropicClient,
	) {}

	available(): boolean {
		return this.llm.isConfigured();
	}

	async explain(seed: MovieSeed, target: MovieSeed): Promise<string | null> {
		if (!this.available()) return null;
		const cached = this.database.db
			.select({ explanation: movieRecExplanations.explanation })
			.from(movieRecExplanations)
			.where(
				and(
					eq(movieRecExplanations.seedId, seed.id),
					eq(movieRecExplanations.targetId, target.id),
					eq(movieRecExplanations.model, this.llm.id),
				),
			)
			.get();
		if (cached) return cached.explanation;

		try {
			const text = await this.llm.explain(seed, target);
			if (!text) return null;
			this.database.db
				.insert(movieRecExplanations)
				.values({
					seedId: seed.id,
					targetId: target.id,
					model: this.llm.id,
					explanation: text,
					generatedAt: nowISO(),
				})
				.run();
			return text;
		} catch (err: any) {
			this.logger.warn(`explain failed: ${err?.message ?? err}`);
			return null;
		}
	}
}
