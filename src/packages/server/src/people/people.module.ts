import { Module, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { people } from '../database/schema/index.js';
import { EntityResolverRegistry } from '../entities/entity-resolver.registry.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { PeopleController } from './people.controller.js';
import { PeopleService } from './people.service.js';

@Module({
	imports: [DatabaseModule, MetadataModule],
	controllers: [PeopleController],
	providers: [PeopleService],
	exports: [PeopleService],
})
export class PeopleModule implements OnModuleInit {
	constructor(
		private readonly registry: EntityResolverRegistry,
		private readonly database: DatabaseService,
	) {}

	/** Person entity ids are internal `people.id` values (as stored by favorites). */
	onModuleInit() {
		const row = (id: string) =>
			this.database.db
				.select({
					id: people.id,
					name: people.name,
					key: people.externalId,
					img: people.profileUrl,
				})
				.from(people)
				.where(eq(people.id, id))
				.get();
		this.registry.register('person', {
			exists: async (id) => !!row(id),
			summary: async (id) => {
				const p = row(id);
				return p
					? { title: p.name, imageUrl: p.img ?? null, url: `/person/${p.key}` }
					: null;
			},
		});
	}
}
