import { randomUUID } from 'node:crypto';
import { nowISO } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	metadataMatchCandidates,
	type MetadataMatchCandidate,
} from '../database/schema/index.js';
import type { MatchCandidate, ScoredCandidate } from './matching/index.js';

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
 * Maximum number of scored candidates we keep around for the user
 * to disambiguate from. Centralised so both movie + group paths
 * agree on the cap (used to be duplicated as a per-service constant).
 */
export const MAX_PERSISTED_CANDIDATES = 8;

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

	/**
	 * Convenience wrapper around `replace()` that takes a matcher's
	 * ranked output directly and persists the top-N rows. The
	 * `overviewExtractor` argument lets callers pull provider-specific
	 * overview text off the candidate without forcing every matcher
	 * candidate type to declare `.overview` on the base interface.
	 *
	 * Used by both the movie- and group-metadata paths so the
	 * mapping shape stays in lock-step.
	 */
	replaceFromRanked<C extends MatchCandidate>(
		entityType: CandidateEntityType,
		entityId: string,
		ranked: ScoredCandidate<C>[],
		opts: {
			limit?: number;
			overviewOf?: (candidate: C) => string | null | undefined;
		} = {},
	): void {
		const limit = opts.limit ?? MAX_PERSISTED_CANDIDATES;
		const getOverview = opts.overviewOf ?? (() => null);
		const persisted: NewCandidate[] = ranked.slice(0, limit).map((s) => ({
			provider: s.candidate.provider,
			externalId: s.candidate.externalId,
			title: s.candidate.title,
			year: s.candidate.year ?? null,
			runtimeMinutes: s.candidate.runtimeMinutes ?? null,
			posterUrl: s.candidate.posterUrl ?? null,
			overview: getOverview(s.candidate) ?? null,
			confidence: s.confidence,
		}));
		this.replace(entityType, entityId, persisted);
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
