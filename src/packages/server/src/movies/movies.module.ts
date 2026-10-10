import { forwardRef, Module, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { EntityResolverRegistry } from '../entities/entity-resolver.registry.js';
import { LibraryModule } from '../library/library.module.js';
import { MediaModule } from '../media/media.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { RemoteModule } from '../remote/remote.module.js';
import { StreamModule } from '../stream/stream.module.js';
import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';
import { MoviesController } from './movies.controller.js';
import { MoviesService } from './movies.service.js';
import { PlaylistsController } from './playlists.controller.js';
import { PlaylistsService } from './playlists.service.js';
import { RatingsController } from './ratings.controller.js';
import { RatingsService } from './ratings.service.js';
import { WatchlistController } from './watchlist.controller.js';
import { WatchlistService } from './watchlist.service.js';

@Module({
	imports: [
		forwardRef(() => LibraryModule),
		MediaModule,
		MetadataModule,
		RemoteModule,
		StreamModule,
	],
	controllers: [
		MoviesController,
		RatingsController,
		HistoryController,
		WatchlistController,
		PlaylistsController,
	],
	providers: [MoviesService, RatingsService, HistoryService, WatchlistService, PlaylistsService],
	exports: [MoviesService, RatingsService, HistoryService, WatchlistService, PlaylistsService],
})
export class MoviesModule implements OnModuleInit {
	constructor(
		private readonly registry: EntityResolverRegistry,
		private readonly database: DatabaseService,
	) {}

	onModuleInit() {
		const row = (id: string) =>
			this.database.db
				.select({
					id: movies.id,
					title: movies.title,
					poster: movies.posterUrl,
					thumb: movies.thumbnailUrl,
				})
				.from(movies)
				.where(eq(movies.id, id))
				.get();
		this.registry.register('movie', {
			exists: async (id) => !!row(id),
			summary: async (id) => {
				const m = row(id);
				return m
					? {
							title: m.title,
							imageUrl: m.poster || m.thumb || null,
							url: `/movie/${m.id}`,
						}
					: null;
			},
		});
	}
}
