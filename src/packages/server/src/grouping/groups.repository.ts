import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	movieGroups,
	type MovieGroup,
	type NewMovieGroup,
	movies,
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

	listUnsure(): MovieGroup[] {
		return this.database.db
			.select()
			.from(movieGroups)
			.where(eq(movieGroups.status, 'unsure'))
			.all();
	}

	get(id: string): MovieGroup | null {
		return (
			this.database.db
				.select()
				.from(movieGroups)
				.where(eq(movieGroups.id, id))
				.get() ?? null
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

	findSubgroup(parentId: string, ordinal: number | null): MovieGroup | null {
		const where =
			ordinal === null
				? and(eq(movieGroups.parentGroupId, parentId), isNull(movieGroups.ordinal))
				: and(
						eq(movieGroups.parentGroupId, parentId),
						eq(movieGroups.ordinal, ordinal),
					);
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

	listMoviesInSubgroup(subgroupId: string): typeof movies.$inferSelect[] {
		return this.database.db
			.select()
			.from(movies)
			.where(eq(movies.groupId, subgroupId))
			.all();
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

	parseAltParents(json: string | null): AltParent[] {
		if (!json) return [];
		try {
			return JSON.parse(json) as AltParent[];
		} catch {
			return [];
		}
	}
}
