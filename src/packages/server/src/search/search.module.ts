import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ImdbDatasetsModule } from '../imdb-datasets/imdb-datasets.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { MoviesModule } from '../movies/movies.module.js';
import { PeopleModule } from '../people/people.module.js';
import { TraktModule } from '../providers/sources/trakt/trakt.module.js';
import { FederatedMovieSearchService } from './federated-movie-search.service.js';
import { FederatedPeopleSearchService } from './federated-people-search.service.js';
import { SearchController } from './search.controller.js';
import { SearchCacheService } from './search-cache.service.js';

@Module({
	imports: [
		DatabaseModule,
		MetadataModule,
		MoviesModule,
		PeopleModule,
		TraktModule,
		ImdbDatasetsModule,
	],
	controllers: [SearchController],
	providers: [SearchCacheService, FederatedMovieSearchService, FederatedPeopleSearchService],
	exports: [FederatedMovieSearchService, FederatedPeopleSearchService],
})
export class SearchModule {}
