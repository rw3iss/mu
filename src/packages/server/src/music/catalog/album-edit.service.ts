import { randomUUID } from 'node:crypto';
import { nowISO } from '@mu/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
	albumAliases,
	albumArtists,
	albumGenres,
	albums,
	tracks,
} from '../../database/schema/index.js';
import { EntityLifecycleService } from '../../entities/entity-lifecycle.service.js';
import { normKey, sortName } from '../ingest/normalize.js';
import { MusicCatalogService } from './catalog.service.js';

/** Polymorphic user-data tables whose album rows follow a merge. */
const ENTITY_TABLES: { table: string; type: string; id: string }[] = [
	{ table: 'entity_ratings', type: 'entity_type', id: 'entity_id' },
	{ table: 'entity_comments', type: 'entity_type', id: 'entity_id' },
	{ table: 'play_history', type: 'entity_type', id: 'entity_id' },
	{ table: 'entity_watchlist', type: 'entity_type', id: 'entity_id' },
	{ table: 'favorites', type: 'entity_type', id: 'entity_id' },
];

/**
 * Admin fixes for album grouping mistakes (plan §12 risk 3): merge two albums
 * the grouping rule split apart, or split tracks off into a new album.
 */
@Injectable()
export class AlbumEditService {
	constructor(
		private readonly database: DatabaseService,
		private readonly catalog: MusicCatalogService,
		private readonly lifecycle: EntityLifecycleService,
	) {}

	private album(id: string) {
		const a = this.database.db.select().from(albums).where(eq(albums.id, id)).get();
		if (!a) throw new NotFoundException(`Album ${id} not found`);
		return a;
	}

	/**
	 * Move every track of `sourceId` into `targetId`, then delete the source.
	 * Ratings / comments / favourites / history of the source move to the target
	 * (a user's duplicate row is dropped), and the source's grouping key becomes
	 * an alias so re-scans of its folder keep landing in the target.
	 */
	merge(sourceId: string, targetId: string): { albumId: string; movedTracks: number } {
		if (sourceId === targetId)
			throw new BadRequestException('Cannot merge an album into itself');
		const source = this.album(sourceId);
		const target = this.album(targetId);
		const db = this.database.db;
		let moved = 0;
		db.transaction((tx) => {
			moved = tx
				.update(tracks)
				.set({ albumId: targetId, updatedAt: nowISO() })
				.where(eq(tracks.albumId, sourceId))
				.run().changes;
			for (const a of tx
				.select()
				.from(albumArtists)
				.where(eq(albumArtists.albumId, sourceId))
				.all()) {
				tx.insert(albumArtists)
					.values({ ...a, albumId: targetId })
					.onConflictDoNothing()
					.run();
			}
			for (const g of tx
				.select()
				.from(albumGenres)
				.where(eq(albumGenres.albumId, sourceId))
				.all()) {
				tx.insert(albumGenres)
					.values({ ...g, albumId: targetId })
					.onConflictDoNothing()
					.run();
			}
			for (const t of ENTITY_TABLES) {
				// OR IGNORE: a user who rated/favourited both keeps the target's row.
				tx.run(
					sql`UPDATE OR IGNORE ${sql.raw(t.table)} SET ${sql.raw(t.id)} = ${targetId} WHERE ${sql.raw(t.type)} = 'album' AND ${sql.raw(t.id)} = ${sourceId}`,
				);
			}
			const fill: Partial<typeof albums.$inferInsert> = {};
			if (!target.artId && source.artId) fill.artId = source.artId;
			if (!target.year && source.year) fill.year = source.year;
			if (!target.mbidReleaseGroup && source.mbidReleaseGroup) {
				fill.mbidReleaseGroup = source.mbidReleaseGroup;
			}
			if (Object.keys(fill).length) {
				tx.update(albums).set(fill).where(eq(albums.id, targetId)).run();
			}
			if (source.groupKey) {
				tx.insert(albumAliases)
					.values({ groupKey: source.groupKey, albumId: targetId })
					.onConflictDoUpdate({
						target: albumAliases.groupKey,
						set: { albumId: targetId },
					})
					.run();
			}
			// Aliases that pointed at the source now point at the target.
			tx.update(albumAliases)
				.set({ albumId: targetId })
				.where(eq(albumAliases.albumId, sourceId))
				.run();
		});
		// Leftover (duplicate) user rows for the source, then the album itself.
		this.lifecycle.purge({ type: 'album', id: sourceId });
		db.delete(albums).where(eq(albums.id, sourceId)).run();
		this.catalog.recomputeAlbumAggregates(targetId);
		return { albumId: targetId, movedTracks: moved };
	}

	/** Move `trackIds` (all on `albumId`) into a new album titled `title`. */
	split(
		albumId: string,
		trackIds: string[],
		title: string,
	): { albumId: string; movedTracks: number } {
		const source = this.album(albumId);
		const name = title.trim();
		if (!name) throw new BadRequestException('A title is required');
		const ids = [...new Set(trackIds)];
		if (ids.length === 0) throw new BadRequestException('Pick at least one track');
		const db = this.database.db;
		const owned = db
			.select({ id: tracks.id })
			.from(tracks)
			.where(and(eq(tracks.albumId, albumId), inArray(tracks.id, ids)))
			.all();
		if (owned.length !== ids.length) {
			throw new BadRequestException('Every track must belong to this album');
		}
		const total = db
			.select({ n: sql<number>`count(*)` })
			.from(tracks)
			.where(eq(tracks.albumId, albumId))
			.get()?.n;
		if (owned.length === total)
			throw new BadRequestException('Leave at least one track behind');

		const id = randomUUID();
		const now = nowISO();
		db.transaction((tx) => {
			tx.insert(albums)
				.values({
					id,
					title: name,
					sortTitle: sortName(name),
					normTitle: normKey(name),
					primaryType: source.primaryType,
					isCompilation: source.isCompilation,
					year: source.year,
					artistCredit: source.artistCredit,
					artId: source.artId,
					folderPath: source.folderPath,
					// Unique key so a re-scan never folds it back into the source.
					groupKey: `split:${id}`,
					addedAt: now,
					updatedAt: now,
				})
				.run();
			for (const a of tx
				.select()
				.from(albumArtists)
				.where(eq(albumArtists.albumId, albumId))
				.all()) {
				tx.insert(albumArtists)
					.values({ ...a, albumId: id })
					.onConflictDoNothing()
					.run();
			}
			tx.update(tracks)
				.set({ albumId: id, updatedAt: now })
				.where(inArray(tracks.id, ids))
				.run();
		});
		this.catalog.recomputeAlbumAggregates(albumId);
		this.catalog.recomputeAlbumAggregates(id);
		return { albumId: id, movedTracks: ids.length };
	}
}
