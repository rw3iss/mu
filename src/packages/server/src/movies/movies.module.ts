import { Module } from '@nestjs/common';
import { MoviesService } from './movies.service.js';
import { RatingsService } from './ratings.service.js';
import { HistoryService } from './history.service.js';
import { WatchlistService } from './watchlist.service.js';
import { PlaylistsService } from './playlists.service.js';
import { MoviesController } from './movies.controller.js';
import { RatingsController } from './ratings.controller.js';
import { HistoryController } from './history.controller.js';
import { WatchlistController } from './watchlist.controller.js';
import { PlaylistsController } from './playlists.controller.js';
import { LibraryModule } from '../library/library.module.js';
import { MediaModule } from '../media/media.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { StreamModule } from '../stream/stream.module.js';

@Module({
  imports: [LibraryModule, MediaModule, MetadataModule, StreamModule],
  controllers: [
    MoviesController,
    RatingsController,
    HistoryController,
    WatchlistController,
    PlaylistsController,
  ],
  providers: [
    MoviesService,
    RatingsService,
    HistoryService,
    WatchlistService,
    PlaylistsService,
  ],
  exports: [
    MoviesService,
    RatingsService,
    HistoryService,
    WatchlistService,
    PlaylistsService,
  ],
})
export class MoviesModule {}
