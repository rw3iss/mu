import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { type MovieGroup, movieGroups, movies } from '../database/schema/index.js';
import { MatchCandidatesRepository } from './match-candidates.repository.js';
import { type MatchCandidate, resolveMatch } from './matching/index.js';
import { TmdbProvider } from './providers/tmdb.provider.js';

/** Job type used by the grouping module to enqueue a metadata pass. */
export const GROUP_METADATA_JOB = 'group-metadata';

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
 * Patch the resolver returns when it decides on a winner. The grouping
 * module applies this to its own `movie_groups` row — this service
 * never writes to that table directly.
 */
export interface ResolvedGroupMetadata {
	tmdbTvId?: number | null;
	imdbId?: string | null;
	posterUrl?: string | null;
	backdropUrl?: string | null;
	overview?: string | null;
}

/**
 * Minimum slice of a `MovieGroup` the resolver needs to do its job.
 * Callers don't have to hand over the whole row — passing this is
 * enough to keep the resolver provider-agnostic and module-boundary
 * clean (no GroupsRepository injection here).
 */
export type GroupForMetadata = Pick<
	MovieGroup,
	'id' | 'name' | 'type' | 'groupType' | 'tmdbTvId' | 'imdbId'
>;

/**
 * Pure metadata resolver for parent groups (TV shows, movie
 * collections). Returns the patch that the *grouping* module then
 * writes onto its own row.
 *
 * This service:
 *   - Reads no group-owned state (the caller passes the group in).
 *   - Writes only to its own `metadata_match_candidates` table.
 *   - Has zero dependency on `GroupsRepository` — the dependency
 *     direction is `grouping → metadata`, never the reverse.
 *
 * The job-queue handler that turns this into an auto-trigger lives in
 * `GroupingService.onModuleInit`, not here.
 */
@Injectable()
export class GroupMetadataService {
	private readonly logger = new Logger(GroupMetadataService.name);

	constructor(
		private readonly database: DatabaseService,
		private readonly tmdb: TmdbProvider,
		private readonly matchCandidates: MatchCandidatesRepository,
	) {}

	/**
	 * Resolve metadata for a parent group. Subgroups are skipped — the
	 * parent owns the show/collection identity.
	 *
	 *   1. Fast-path: if group already has tmdbTvId or imdbId, fetch by
	 *      ID and return the patch.
	 *   2. Otherwise build candidates from TMDB TV and/or Collection
	 *      search (filtered by group.groupType hint).
	 *   3. Score with the shared matcher (year = earliest member year).
	 *   4. Confident → return patch; ambiguous → persist candidates +
	 *      return null; no-match → return null.
	 */
	async resolveForGroup(group: GroupForMetadata): Promise<ResolvedGroupMetadata | null> {
		if (group.type !== 'parent') {
			this.logger.debug(`Skipping non-parent group ${group.id}`);
			return null;
		}

		// Fast-path: known IDs.
		if (group.tmdbTvId || group.imdbId) {
			return this.resolveTvDetails(group.tmdbTvId ?? null);
		}

		const memberAgg = this.aggregateMembers(group.id);

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
			const year = r.first_air_date ? parseInt(r.first_air_date.slice(0, 4), 10) : null;
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

		const outcome = await resolveMatch<GroupCandidate, ResolvedGroupMetadata>({
			entityType: 'group',
			entityId: group.id,
			entityLabel: group.name,
			candidates,
			query: {
				title: group.name,
				year: memberAgg.earliestYear,
				durationMinutes: null,
			},
			repository: this.matchCandidates,
			logger: this.logger,
			overviewOf: (c) => c.overview,
			onConfident: async (winner) => this.resolveByProvider(winner.provider, Number(winner.externalId)),
		});

		return outcome.kind === 'applied' ? outcome.result : null;
	}

	/**
	 * Resolve a user-picked candidate (entity_type='group'). Used by the
	 * grouping module's POST /:id/match-candidates/apply endpoint. The
	 * caller is responsible for clearing the candidate rows + writing
	 * the patch onto the group.
	 */
	async resolveByCandidate(
		provider: string,
		externalId: string,
	): Promise<ResolvedGroupMetadata | null> {
		if (provider !== 'tmdb-tv' && provider !== 'tmdb-collection') return null;
		return this.resolveByProvider(provider, Number(externalId));
	}

	// ── internals ─────────────────────────────────────────────────

	private aggregateMembers(parentGroupId: string): { earliestYear: number | null } {
		const row = this.database.db
			.select({ minYear: sql<number | null>`MIN(${movies.year})` })
			.from(movies)
			.innerJoin(movieGroups, eq(movieGroups.id, movies.groupId))
			.where(eq(movieGroups.parentGroupId, parentGroupId))
			.get();
		return { earliestYear: row?.minYear ?? null };
	}

	private async resolveByProvider(
		provider: ProviderTag,
		externalId: number,
	): Promise<ResolvedGroupMetadata | null> {
		return provider === 'tmdb-tv'
			? this.resolveTvDetails(externalId)
			: this.resolveCollectionDetails(externalId);
	}

	private async resolveTvDetails(tmdbTvId: number | null): Promise<ResolvedGroupMetadata | null> {
		if (!tmdbTvId) return null;
		const details = await this.tmdb.getTvDetails(tmdbTvId);
		if (!details) return null;
		return {
			tmdbTvId: details.id,
			imdbId: details.external_ids?.imdb_id ?? null,
			posterUrl: this.tmdb.getImageUrl(details.poster_path),
			backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280'),
			overview: details.overview || null,
		};
	}

	private async resolveCollectionDetails(
		collectionId: number,
	): Promise<ResolvedGroupMetadata | null> {
		const details = await this.tmdb.getCollectionDetails(collectionId);
		if (!details) return null;
		return {
			// Collections have no IMDB id; tmdbTvId stays null on the group row.
			posterUrl: this.tmdb.getImageUrl(details.poster_path),
			backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280'),
			overview: details.overview || null,
		};
	}
}
