import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieGroups, movies } from '../database/schema/index.js';
import { GroupsRepository } from '../grouping/groups.repository.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import type { JobRecord } from '../jobs/job.interface.js';
import { MatchCandidatesRepository, NewCandidate } from './match-candidates.repository.js';
import {
	DEFAULT_MATCHER_CONFIG,
	findBestMatch,
	type MatchCandidate,
} from './matching/index.js';
import { TmdbProvider } from './providers/tmdb.provider.js';

/** Job type the GroupingService enqueues to trigger this service. */
export const GROUP_METADATA_JOB = 'group-metadata';

const MAX_PERSISTED_CANDIDATES = 8;

/** Group-types that should hit TMDB's TV-search endpoint. */
const TV_GROUP_TYPES = new Set(['series', 'show', 'tv', 'season']);
/** Group-types that should hit TMDB's collection-search endpoint. */
const COLLECTION_GROUP_TYPES = new Set(['collection', 'trilogy', 'saga', 'franchise']);

type ProviderTag = 'tmdb-tv' | 'tmdb-collection';

interface GroupCandidate extends MatchCandidate {
	provider: ProviderTag;
	overview?: string | null;
	imdbId?: string;
}

/**
 * Metadata enrichment for parent groups (TV shows, movie collections).
 *
 * Picks the right TMDB endpoint based on `group.groupType`; if the hint
 * is ambiguous (e.g. groupType='series' but it's really a film series)
 * both endpoints are searched and the matcher picks the winner.
 *
 * Auto-triggers from GroupingService via a `group-metadata` job —
 * decoupled so the orchestrator doesn't have to depend on this service
 * directly.
 */
@Injectable()
export class GroupMetadataService implements OnModuleInit {
	private readonly logger = new Logger(GroupMetadataService.name);

	constructor(
		private readonly database: DatabaseService,
		private readonly groups: GroupsRepository,
		private readonly tmdb: TmdbProvider,
		private readonly matchCandidates: MatchCandidatesRepository,
		private readonly jobs: JobManagerService,
	) {}

	onModuleInit(): void {
		this.jobs.registerHandler(GROUP_METADATA_JOB, async (job: JobRecord) => {
			const groupId = job.payload?.groupId as string | undefined;
			if (!groupId) {
				this.logger.warn(`group-metadata job ${job.id} has no groupId payload — skipping`);
				return { skipped: true };
			}
			try {
				const result = await this.fetchForGroup(groupId);
				return { groupId, applied: !!result };
			} catch (err: any) {
				this.logger.warn(`fetchForGroup(${groupId}) failed: ${err?.message}`);
				return { groupId, error: err?.message };
			}
		});
	}

	/**
	 * Resolve & persist metadata for a parent group. Subgroups are
	 * skipped — the parent owns the show / collection identity.
	 *
	 *   1. Fast-path: if group already has tmdbTvId or imdbId, fetch by
	 *      ID and write missing fields.
	 *   2. Otherwise build candidate list from TMDB TV and/or Collection
	 *      search (filtered by group.groupType hint).
	 *   3. Score with the shared matcher (year = earliest member year).
	 *   4. Confident → apply; ambiguous → persist candidates; no-match → bail.
	 */
	async fetchForGroup(groupId: string): Promise<any> {
		const group = this.groups.get(groupId);
		if (!group) throw new NotFoundException(`Group ${groupId} not found`);
		if (group.type !== 'parent') {
			this.logger.debug(`Skipping non-parent group ${groupId}`);
			return null;
		}

		// Fast-path: known IDs.
		if (group.tmdbTvId || group.imdbId) {
			const applied = await this.applyTvDetails(group.id, group.tmdbTvId ?? null);
			if (applied) this.matchCandidates.clear('group', group.id);
			return applied;
		}

		// Aggregate member context (earliest year, average runtime).
		const memberAgg = this.aggregateMembers(groupId);

		// Search providers per the groupType hint.
		const groupType = (group.groupType ?? 'series').toLowerCase();
		const wantTv = TV_GROUP_TYPES.has(groupType) || !COLLECTION_GROUP_TYPES.has(groupType);
		const wantCollection =
			COLLECTION_GROUP_TYPES.has(groupType) || !TV_GROUP_TYPES.has(groupType);

		const [tvRes, colRes] = await Promise.allSettled([
			wantTv ? this.tmdb.searchTv(group.name, memberAgg.earliestYear ?? undefined) : Promise.resolve(null),
			wantCollection ? this.tmdb.searchCollection(group.name) : Promise.resolve(null),
		]);
		const tvResults = tvRes.status === 'fulfilled' ? (tvRes.value ?? []) : [];
		const colResults = colRes.status === 'fulfilled' ? (colRes.value ?? []) : [];
		if (tvRes.status === 'rejected') {
			this.logger.warn(`TMDB TV search failed: ${tvRes.reason}`);
		}
		if (colRes.status === 'rejected') {
			this.logger.warn(`TMDB collection search failed: ${colRes.reason}`);
		}

		const candidates: GroupCandidate[] = [];
		for (const r of tvResults) {
			const year = r.first_air_date
				? parseInt(r.first_air_date.slice(0, 4), 10)
				: null;
			candidates.push({
				provider: 'tmdb-tv',
				externalId: r.id,
				title: r.name,
				year: Number.isFinite(year) ? year : null,
				runtimeMinutes: null,
				popularity: r.popularity ?? null,
				posterUrl: this.tmdb.getImageUrl(r.poster_path),
				overview: r.overview,
			});
		}
		for (const r of colResults) {
			candidates.push({
				provider: 'tmdb-collection',
				externalId: r.id,
				title: r.name,
				year: null,
				runtimeMinutes: null,
				popularity: null,
				posterUrl: this.tmdb.getImageUrl(r.poster_path),
				overview: r.overview,
			});
		}

		if (candidates.length === 0) {
			this.matchCandidates.clear('group', groupId);
			this.logger.debug(`No TMDB candidates for group "${group.name}"`);
			return null;
		}

		const match = findBestMatch(
			{
				title: group.name,
				year: memberAgg.earliestYear,
				durationMinutes: null,
			},
			candidates,
			DEFAULT_MATCHER_CONFIG,
		);

		if (match.noMatch || !match.best) {
			this.matchCandidates.clear('group', groupId);
			this.logger.debug(`No confident group match for "${group.name}"`);
			return null;
		}

		if (match.ambiguous) {
			const persisted: NewCandidate[] = match.ranked
				.slice(0, MAX_PERSISTED_CANDIDATES)
				.map((s) => ({
					provider: s.candidate.provider,
					externalId: s.candidate.externalId,
					title: s.candidate.title,
					year: s.candidate.year ?? null,
					runtimeMinutes: s.candidate.runtimeMinutes ?? null,
					posterUrl: s.candidate.posterUrl ?? null,
					overview: (s.candidate as GroupCandidate).overview ?? null,
					confidence: s.confidence,
				}));
			this.matchCandidates.replace('group', groupId, persisted);
			this.logger.log(
				`Ambiguous group match for "${group.name}" — saved ${persisted.length} candidates (best: ${match.best.confidence.toFixed(2)})`,
			);
			return null;
		}

		// Confident pick → apply.
		this.matchCandidates.clear('group', groupId);
		const winner = match.best.candidate as GroupCandidate;
		if (winner.provider === 'tmdb-tv') {
			const result = await this.applyTvDetails(groupId, Number(winner.externalId));
			this.logger.log(
				`Group "${group.name}" matched TMDB-TV id=${winner.externalId} confidence=${match.best.confidence.toFixed(2)}`,
			);
			return result;
		}
		// tmdb-collection
		const result = await this.applyCollectionDetails(groupId, Number(winner.externalId));
		this.logger.log(
			`Group "${group.name}" matched TMDB-Collection id=${winner.externalId} confidence=${match.best.confidence.toFixed(2)}`,
		);
		return result;
	}

	/**
	 * Apply a user-picked candidate from the dropdown (entityType=group).
	 */
	async applyCandidate(
		groupId: string,
		provider: string,
		externalId: string,
	): Promise<any> {
		const row = this.matchCandidates.find('group', groupId, provider, externalId);
		if (!row) {
			throw new NotFoundException(
				`Candidate not found: group=${groupId} provider=${provider} externalId=${externalId}`,
			);
		}
		const result =
			provider === 'tmdb-tv'
				? await this.applyTvDetails(groupId, Number(externalId))
				: provider === 'tmdb-collection'
					? await this.applyCollectionDetails(groupId, Number(externalId))
					: null;
		this.matchCandidates.clear('group', groupId);
		return result;
	}

	// ── internals ─────────────────────────────────────────────────

	private aggregateMembers(parentGroupId: string): {
		earliestYear: number | null;
	} {
		// All movies under any subgroup of this parent.
		const row = this.database.db
			.select({ minYear: sql<number | null>`MIN(${movies.year})` })
			.from(movies)
			.innerJoin(movieGroups, eq(movieGroups.id, movies.groupId))
			.where(eq(movieGroups.parentGroupId, parentGroupId))
			.get();
		return { earliestYear: row?.minYear ?? null };
	}

	private async applyTvDetails(groupId: string, tmdbTvId: number | null): Promise<any> {
		if (!tmdbTvId) return null;
		const details = await this.tmdb.getTvDetails(tmdbTvId);
		if (!details) return null;
		const imdbId = details.external_ids?.imdb_id ?? null;
		this.groups.update(groupId, {
			tmdbTvId: details.id,
			imdbId,
			posterUrl: this.tmdb.getImageUrl(details.poster_path),
			backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280'),
			overview: details.overview || null,
		});
		return this.groups.get(groupId);
	}

	private async applyCollectionDetails(
		groupId: string,
		collectionId: number,
	): Promise<any> {
		const details = await this.tmdb.getCollectionDetails(collectionId);
		if (!details) return null;
		this.groups.update(groupId, {
			// Collections have no IMDB id; tmdbTvId is left null (it's not a TV
			// show). The cosmetic poster/backdrop/overview are what users see.
			posterUrl: this.tmdb.getImageUrl(details.poster_path),
			backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280'),
			overview: details.overview || null,
		});
		return this.groups.get(groupId);
	}
}
