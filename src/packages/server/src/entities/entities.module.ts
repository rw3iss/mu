import { Global, Module } from '@nestjs/common';
import { EntitiesController } from './entities.controller.js';
import { EntityLifecycleService } from './entity-lifecycle.service.js';
import { EntityRatingsService } from './entity-ratings.service.js';
import { EntityResolverRegistry } from './entity-resolver.registry.js';

/**
 * Polymorphic entity core: resolver registry, lifecycle purge and generic
 * ratings. Global so feature modules (movies, people, music) can register
 * resolvers and call purge without importing each other. Pulled into the app
 * via CommonModule.
 */
@Global()
@Module({
	providers: [EntityResolverRegistry, EntityLifecycleService, EntityRatingsService],
	controllers: [EntitiesController],
	exports: [EntityResolverRegistry, EntityLifecycleService, EntityRatingsService],
})
export class EntitiesModule {}
