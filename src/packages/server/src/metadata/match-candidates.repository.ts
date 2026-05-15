import { randomUUID } from 'node:crypto';
import { nowISO } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	metadataMatchCandidates,
	type MetadataMatchCandidate,
} from '../database/schema/index.js';

export type CandidateEntityType = 'movie' | 'group';

export interface NewCandidate {
	provider: string;
	externalId: string | number;
	title: string;
	year?: number | null;
	runtimeMinutes?: number | null;
	posterUrl?: string | null;
	overview?: string | null;
	confidence: number;
	isBest?: boolean;
}

/**
 * Persisted candidate matches for movies/groups whose metadata match
 * was ambiguous. Surfaced in the UI as a dropdown — once the user
 * confirms one, we clear them all and apply the picked match.
 */
@Injectable()
export class MatchCandidatesRepository {
	constructor(private readonly database: DatabaseService) {}

	list(entityType: CandidateEntityType, entityId: string): MetadataMatchCandidate[] {
		return this.database.db
			.select()
			.from(metadataMatchCandidates)
			.where(
				and(
					eq(metadataMatchCandidates.entityType, entityType),
					eq(metadataMatchCandidates.entityId, entityId),
				),
			)
			.orderBy(asc(metadataMatchCandidates.rank))
			.all();
	}

	/** Replace all candidates for a given entity in a single transaction. */
	replace(
		entityType: CandidateEntityType,
		entityId: string,
		candidates: NewCandidate[],
	): void {
		const now = nowISO();
		this.database.db
			.delete(metadataMatchCandidates)
			.where(
				and(
					eq(metadataMatchCandidates.entityType, entityType),
					eq(metadataMatchCandidates.entityId, entityId),
				),
			)
			.run();

		for (let i = 0; i < candidates.length; i++) {
			const c = candidates[i]!;
			this.database.db
				.insert(metadataMatchCandidates)
				.values({
					id: randomUUID(),
					entityType,
					entityId,
					provider: c.provider,
					externalId: String(c.externalId),
					title: c.title,
					year: c.year ?? null,
					runtimeMinutes: c.runtimeMinutes ?? null,
					posterUrl: c.posterUrl ?? null,
					overview: c.overview ?? null,
					confidence: c.confidence,
					rank: i,
					isBest: c.isBest ?? i === 0,
					createdAt: now,
				})
				.run();
		}
	}

	clear(entityType: CandidateEntityType, entityId: string): void {
		this.database.db
			.delete(metadataMatchCandidates)
			.where(
				and(
					eq(metadataMatchCandidates.entityType, entityType),
					eq(metadataMatchCandidates.entityId, entityId),
				),
			)
			.run();
	}

	find(
		entityType: CandidateEntityType,
		entityId: string,
		provider: string,
		externalId: string,
	): MetadataMatchCandidate | null {
		return (
			this.database.db
				.select()
				.from(metadataMatchCandidates)
				.where(
					and(
						eq(metadataMatchCandidates.entityType, entityType),
						eq(metadataMatchCandidates.entityId, entityId),
						eq(metadataMatchCandidates.provider, provider),
						eq(metadataMatchCandidates.externalId, externalId),
					),
				)
				.get() ?? null
		);
	}
}
