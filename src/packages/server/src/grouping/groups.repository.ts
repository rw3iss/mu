import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	type MovieGroup,
	movieGroups,
	movies,
	type NewMovieGroup,
} from '../database/schema/index.js';

export interface AltParent {
	parentGroupId: string;
	confidence: number;
}

/**
 * Typed data-access for movie_groups + the movies.groupId column.
 * Parallels the SubtitleTracksRepository pattern: pure data layer,
 * no business logic. Higher-level orchestration lives in
 * GroupingService.
 */
@Injectable()
export class GroupsRepository {
	constructor(private readonly database: DatabaseService) {}

	// ── Group reads ────────────────────────────────────────────

	listParents(): MovieGroup[] {
		return this.database.db
			.select()
			.from(movieGroups)
			.where(eq(movieGroups.type, 'parent'))
			.all();
	}

	listChildren(parentId: string): MovieGroup[] {
		return this.database.db
			.select()
			.from(movieGroups)
			.where(eq(movieGroups.parentGroupId, parentId))
			.all();
	}

	/**
	 * For a single parent group, return:
	 *   - totalMembers: sum of movies across every subgroup
	 *   - representativePosterUrl: the first non-null poster URL from
	 *     any member movie (preferring earliest ordinal)
	 *
	 * Used by the Library "Collections" tile grid so each parent tile
	 * has a real poster even though we don't populate group.posterUrl
	 * directly.
	 */
	getParentSummary(parentId: string): {
		totalMembers: number;
		representativePosterUrl: string | null;
		/** Latest `addedAt` across every member — drives the mixed view's sort. */
		latestMemberAddedAt: string | null;
		/** Earliest year across every member — used for year-sort in the mixed view. */
		earliestYear: number | null;
	} {
		const row = this.database.db
			.select({
				totalMembers: sql<number>`COUNT(${movies.id})`,
				poster: sql<
					string | null
				>`(SELECT poster_url FROM movies WHERE group_id IN (SELECT id FROM movie_groups WHERE parent_group_id = ${parentId}) AND poster_url IS NOT NULL ORDER BY group_episode_ordinal LIMIT 1)`,
				latestAdded: sql<string | null>`MAX(${movies.addedAt})`,
				earliestYear: sql<number | null>`MIN(${movies.year})`,
			})
			.from(movies)
			.innerJoin(movieGroups, eq(movieGroups.id, movies.groupId))
			.where(eq(movieGroups.parentGroupId, parentId))
			.get();
		return {
			totalMembers: row?.totalMembers ?? 0,
			representativePosterUrl: row?.poster ?? null,
			latestMemberAddedAt: row?.latestAdded ?? null,
			earliestYear: row?.earliestYear ?? null,
		};
	}

	listUnsure(): MovieGroup[] {
		return this.database.db
			.select()
			.from(movieGroups)
			.where(eq(movieGroups.status, 'unsure'))
			.all();
	}

	get(id: string): MovieGroup | null {
		return (
			this.database.db.select().from(movieGroups).where(eq(movieGroups.id, id)).get() ?? null
		);
	}

	getByNameAndType(name: string, type: 'parent' | 'subgroup'): MovieGroup | null {
		return (
			this.database.db
				.select()
				.from(movieGroups)
				.where(and(eq(movieGroups.name, name), eq(movieGroups.type, type)))
				.get() ?? null
		);
	}

	/**
	 * Resolve an existing PARENT group, preferring a stable identifier
	 * when known. Lookup order:
	 *   1. `tmdbTvId` if provided — survives renames / case differences.
	 *   2. `imdbId` if provided.
	 *   3. Exact-match `name`.
	 *
	 * Returns the first hit. Callers should pass whichever identifiers
	 * they have at detection time; the SxxExx detector typically only
	 * has the parsed show name, but later enrichment may populate the
	 * TMDB id and `findParentByTmdbTvId` is then used for dedupe.
	 */
	findExistingParent(opts: {
		name?: string | null;
		tmdbTvId?: number | null;
		imdbId?: string | null;
	}): MovieGroup | null {
		if (opts.tmdbTvId) {
			const byTmdb = this.findParentByTmdbTvId(opts.tmdbTvId);
			if (byTmdb) return byTmdb;
		}
		if (opts.imdbId) {
			const byImdb = this.findParentByImdbId(opts.imdbId);
			if (byImdb) return byImdb;
		}
		if (opts.name) return this.getByNameAndType(opts.name, 'parent');
		return null;
	}

	findParentByTmdbTvId(tmdbTvId: number): MovieGroup | null {
		return (
			this.database.db
				.select()
				.from(movieGroups)
				.where(and(eq(movieGroups.type, 'parent'), eq(movieGroups.tmdbTvId, tmdbTvId)))
				.get() ?? null
		);
	}

	findParentByImdbId(imdbId: string): MovieGroup | null {
		return (
			this.database.db
				.select()
				.from(movieGroups)
				.where(and(eq(movieGroups.type, 'parent'), eq(movieGroups.imdbId, imdbId)))
				.get() ?? null
		);
	}

	/**
	 * List PARENT groups that share `tmdbTvId` with the given one
	 * (excluding the given parent itself). Empty array when no
	 * duplicates exist.
	 */
	findSiblingParentsByTmdbTvId(parentId: string, tmdbTvId: number): MovieGroup[] {
		return this.database.db
			.select()
			.from(movieGroups)
			.where(
				and(
					eq(movieGroups.type, 'parent'),
					eq(movieGroups.tmdbTvId, tmdbTvId),
					sql`${movieGroups.id} != ${parentId}`,
				),
			)
			.all();
	}

	/**
	 * Merge all subgroups + movies from `sourceParentId` into
	 * `targetParentId`, then delete the source. Same-ordinal
	 * subgroups (e.g. both have Season 1) are coalesced: members
	 * move into the target's subgroup and the source's empty
	 * subgroup is dropped. Returns counts for logging.
	 *
	 * NOT a transaction — better-sqlite3 calls already share a single
	 * connection and these are all small writes. If a later step
	 * fails the caller should re-run; the operation is idempotent.
	 */
	mergeParent(
		sourceParentId: string,
		targetParentId: string,
	): { subgroupsMerged: number; subgroupsMoved: number; moviesMoved: number } {
		if (sourceParentId === targetParentId) {
			return { subgroupsMerged: 0, subgroupsMoved: 0, moviesMoved: 0 };
		}
		let subgroupsMerged = 0;
		let subgroupsMoved = 0;
		let moviesMoved = 0;

		const sourceSubs = this.listChildren(sourceParentId);
		for (const src of sourceSubs) {
			const twin = this.findSubgroup(targetParentId, src.ordinal);
			if (twin) {
				// Same season already exists in target — relocate movies.
				const updated = this.database.db
					.update(movies)
					.set({ groupId: twin.id })
					.where(eq(movies.groupId, src.id))
					.run();
				moviesMoved += updated.changes;
				this.delete(src.id);
				subgroupsMerged += 1;
			} else {
				// Adopt the subgroup wholesale.
				this.database.db
					.update(movieGroups)
					.set({ parentGroupId: targetParentId })
					.where(eq(movieGroups.id, src.id))
					.run();
				subgroupsMoved += 1;
			}
		}

		this.delete(sourceParentId);
		return { subgroupsMerged, subgroupsMoved, moviesMoved };
	}

	findSubgroup(parentId: string, ordinal: number | null): MovieGroup | null {
		const where =
			ordinal === null
				? and(eq(movieGroups.parentGroupId, parentId), isNull(movieGroups.ordinal))
				: and(eq(movieGroups.parentGroupId, parentId), eq(movieGroups.ordinal, ordinal));
		return this.database.db.select().from(movieGroups).where(where).get() ?? null;
	}

	// ── Group writes ───────────────────────────────────────────

	insert(row: NewMovieGroup): MovieGroup {
		this.database.db.insert(movieGroups).values(row).run();
		return this.get(row.id!)!;
	}

	update(id: string, patch: Partial<NewMovieGroup>): void {
		this.database.db
			.update(movieGroups)
			.set({ ...patch, updatedAt: new Date().toISOString() })
			.where(eq(movieGroups.id, id))
			.run();
	}

	delete(id: string): void {
		this.database.db.delete(movieGroups).where(eq(movieGroups.id, id)).run();
	}

	deleteEmptyChildrenOf(parentId: string): number {
		// Subgroups with no member movies — delete them. Used after a
		// member is removed.
		const empties = this.database.db
			.select({ id: movieGroups.id })
			.from(movieGroups)
			.where(eq(movieGroups.parentGroupId, parentId))
			.all()
			.filter(
				(g) =>
					this.database.db
						.select({ c: sql<number>`count(*)` })
						.from(movies)
						.where(eq(movies.groupId, g.id))
						.get()?.c === 0,
			);
		for (const g of empties) this.delete(g.id);
		return empties.length;
	}

	deleteIfEmpty(parentId: string): boolean {
		const childCount = this.database.db
			.select({ c: sql<number>`count(*)` })
			.from(movieGroups)
			.where(eq(movieGroups.parentGroupId, parentId))
			.get()?.c;
		if (!childCount || childCount === 0) {
			this.delete(parentId);
			return true;
		}
		return false;
	}

	wipeAutoAndUnsure(): { groupsDeleted: number; moviesDetached: number } {
		// Detach movies whose group is non-confirmed.
		const detachable = this.database.db
			.select({ groupId: movieGroups.id })
			.from(movieGroups)
			.where(
				and(
					eq(movieGroups.type, 'subgroup'),
					sql`${movieGroups.status} in ('auto', 'unsure')`,
				),
			)
			.all()
			.map((r) => r.groupId);

		let moviesDetached = 0;
		for (const gid of detachable) {
			const res = this.database.db
				.update(movies)
				.set({ groupId: null, groupEpisodeOrdinal: null })
				.where(eq(movies.groupId, gid))
				.run();
			moviesDetached += res.changes;
		}

		const delRes = this.database.db
			.delete(movieGroups)
			.where(sql`${movieGroups.status} in ('auto', 'unsure')`)
			.run();

		return { groupsDeleted: delRes.changes, moviesDetached };
	}

	// ── Movie→group attachments ────────────────────────────────

	attachMovie(movieId: string, subgroupId: string, episodeOrdinal: number | null): void {
		this.database.db
			.update(movies)
			.set({ groupId: subgroupId, groupEpisodeOrdinal: episodeOrdinal })
			.where(eq(movies.id, movieId))
			.run();
	}

	detachMovie(movieId: string): void {
		this.database.db
			.update(movies)
			.set({ groupId: null, groupEpisodeOrdinal: null })
			.where(eq(movies.id, movieId))
			.run();
	}

	listMoviesInSubgroup(subgroupId: string): (typeof movies.$inferSelect)[] {
		return this.database.db.select().from(movies).where(eq(movies.groupId, subgroupId)).all();
	}

	movieCountInSubgroup(subgroupId: string): number {
		return (
			this.database.db
				.select({ c: sql<number>`count(*)` })
				.from(movies)
				.where(eq(movies.groupId, subgroupId))
				.get()?.c ?? 0
		);
	}

	/**
	 * Find every subgroup that has fewer than `minMembers` movies in
	 * it. Used by the pruning sweep after a full rebuild — a TV "show"
	 * with only one episode isn't a group, just a movie.
	 *
	 * Uses LEFT JOIN + GROUP BY rather than a correlated subquery:
	 * Drizzle's `sql` template can interpolate column refs inside
	 * subqueries inconsistently across versions, which caused the
	 * member count to come back as 0 for every row and led to the
	 * prune sweep wiping every subgroup regardless of size.
	 */
	findUnderfilledSubgroups(minMembers: number): {
		id: string;
		parentGroupId: string | null;
		memberCount: number;
	}[] {
		const rows = this.database.db
			.select({
				id: movieGroups.id,
				parentGroupId: movieGroups.parentGroupId,
				memberCount: sql<number>`COUNT(${movies.id})`,
			})
			.from(movieGroups)
			.leftJoin(movies, eq(movies.groupId, movieGroups.id))
			.where(eq(movieGroups.type, 'subgroup'))
			.groupBy(movieGroups.id, movieGroups.parentGroupId)
			.all();
		return rows.filter((r) => r.memberCount < minMembers);
	}

	/**
	 * Snapshot of every subgroup with its current membership count.
	 * Used by the rebuild's diagnostics so we can see what got created
	 * and at what populations.
	 */
	listSubgroupsWithMemberCounts(): {
		id: string;
		name: string;
		parentGroupId: string | null;
		memberCount: number;
	}[] {
		return this.database.db
			.select({
				id: movieGroups.id,
				name: movieGroups.name,
				parentGroupId: movieGroups.parentGroupId,
				memberCount: sql<number>`COUNT(${movies.id})`,
			})
			.from(movieGroups)
			.leftJoin(movies, eq(movies.groupId, movieGroups.id))
			.where(eq(movieGroups.type, 'subgroup'))
			.groupBy(movieGroups.id, movieGroups.name, movieGroups.parentGroupId)
			.all();
	}

	parseAltParents(json: string | null): AltParent[] {
		if (!json) return [];
		try {
			return JSON.parse(json) as AltParent[];
		} catch {
			return [];
		}
	}
}
