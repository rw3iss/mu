import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { MoviesModule } from '../movies/movies.module.js';
import { PeopleModule } from '../people/people.module.js';
import { FederatedMovieSearchService } from './federated-movie-search.service.js';
import { FederatedPeopleSearchService } from './federated-people-search.service.js';
import { SearchCacheService } from './search-cache.service.js';
import { SearchController } from './search.controller.js';

@Module({
	imports: [DatabaseModule, MetadataModule, MoviesModule, PeopleModule],
	controllers: [SearchController],
	providers: [
		SearchCacheService,
		FederatedMovieSearchService,
		FederatedPeopleSearchService,
	],
	exports: [FederatedMovieSearchService, FederatedPeopleSearchService],
})
export class SearchModule {}
