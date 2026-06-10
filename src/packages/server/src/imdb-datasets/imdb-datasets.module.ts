import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { JobModule } from '../jobs/job.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BasicsSyncService } from './basics-sync.service.js';
import { ImdbDatasetsController } from './imdb-datasets.controller.js';
import { ImdbDatasetsService } from './imdb-datasets.service.js';
import { LocalImdbSearchService } from './local-imdb-search.service.js';
import { RatingsSyncService } from './ratings-sync.service.js';

/**
 * IMDB free-dataset integration. Currently ships one sync (ratings);
 * additional bulk datasets — title.basics, title.principals, etc. —
 * land here as more `DatasetSync` implementations.
 *
 * `RatingsSyncService` is exported so OmdbProvider can short-circuit
 * its imdbId rating lookups against the local table.
 */
@Module({
	imports: [DatabaseModule, SettingsModule, JobModule],
	providers: [RatingsSyncService, BasicsSyncService, LocalImdbSearchService, ImdbDatasetsService],
	controllers: [ImdbDatasetsController],
	exports: [RatingsSyncService, BasicsSyncService, LocalImdbSearchService, ImdbDatasetsService],
})
export class ImdbDatasetsModule {}
