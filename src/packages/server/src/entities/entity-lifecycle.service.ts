import type { EntityRef, EntityType } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	entityComments,
	entityRatings,
	entityWatchlist,
	favorites,
	playHistory,
	playlistItems,
} from '../database/schema/index.js';

type PurgeListener = (ref: EntityRef) => void;

/**
 * Cleans up polymorphic user data when a catalogue entity is hard-deleted.
 * The entity_* tables have no FK to movies/tracks/etc., so this replaces the
 * old ON DELETE CASCADE. Services holding per-entity caches subscribe via
 * `onPurge` to drop stale entries.
 */
@Injectable()
export class EntityLifecycleService {
	private readonly logger = new Logger('EntityLifecycleService');
	private readonly listeners: PurgeListener[] = [];

	constructor(private readonly database: DatabaseService) {}

	onPurge(listener: PurgeListener): void {
		this.listeners.push(listener);
	}

	/** Delete every user-data row that points at `ref`. Reactions cascade via FK. */
	purge(ref: EntityRef): void {
		this.purgeMany(ref.type, [ref.id]);
	}

	purgeMany(type: EntityType, ids: string[]): void {
		if (ids.length === 0) return;
		const db = this.database.db;
		// Chunk to stay well under SQLite's bound-parameter limit.
		for (let i = 0; i < ids.length; i += 500) {
			const chunk = ids.slice(i, i + 500);
			db.transaction((tx) => {
				tx.delete(entityRatings)
					.where(
						and(
							eq(entityRatings.entityType, type),
							inArray(entityRatings.entityId, chunk),
						),
					)
					.run();
				tx.delete(entityComments)
					.where(
						and(
							eq(entityComments.entityType, type),
							inArray(entityComments.entityId, chunk),
						),
					)
					.run();
				tx.delete(playHistory)
					.where(
						and(eq(playHistory.entityType, type), inArray(playHistory.entityId, chunk)),
					)
					.run();
				tx.delete(entityWatchlist)
					.where(
						and(
							eq(entityWatchlist.entityType, type),
							inArray(entityWatchlist.entityId, chunk),
						),
					)
					.run();
				tx.delete(playlistItems)
					.where(
						and(eq(playlistItems.itemType, type), inArray(playlistItems.itemId, chunk)),
					)
					.run();
				tx.delete(favorites)
					.where(and(eq(favorites.entityType, type), inArray(favorites.entityId, chunk)))
					.run();
			});
		}
		for (const id of ids) {
			for (const l of this.listeners) {
				try {
					l({ type, id });
				} catch (err) {
					this.logger.warn(`purge listener failed: ${(err as Error).message}`);
				}
			}
		}
	}
}
