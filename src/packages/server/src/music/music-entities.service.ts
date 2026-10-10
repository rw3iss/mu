import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { albums, artists, tracks } from '../database/schema/index.js';
import { EntityRatingsService } from '../entities/entity-ratings.service.js';
import { EntityResolverRegistry } from '../entities/entity-resolver.registry.js';
import { MusicQueryService } from './library/music-query.service.js';

/**
 * Plugs artist/album/track into the generic entity layer: resolvers (so
 * ratings, comments, favourites and playlists accept them) and a rating hook
 * that keeps albums/tracks.rating_avg in step.
 */
@Injectable()
export class MusicEntitiesService implements OnModuleInit {
	constructor(
		private readonly database: DatabaseService,
		private readonly resolvers: EntityResolverRegistry,
		private readonly ratings: EntityRatingsService,
		private readonly query: MusicQueryService,
	) {}

	onModuleInit() {
		const db = this.database.db;
		const tables = { artist: artists, album: albums, track: tracks } as const;
		for (const type of ['artist', 'album', 'track'] as const) {
			const table = tables[type];
			this.resolvers.register(type, {
				exists: async (id) =>
					!!db.select({ id: table.id }).from(table).where(eq(table.id, id)).get(),
				summary: async (id) => this.query.entitySummary(type, id),
				cards: async (ids, userId) => this.query.summariesById(type, ids, userId),
			});
		}
		this.ratings.onChange((ref) => {
			if (ref.type === 'album' || ref.type === 'track')
				this.query.refreshRatingAggregate(ref.type, ref.id);
		});
	}
}
