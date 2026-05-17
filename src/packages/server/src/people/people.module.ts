import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { PeopleController } from './people.controller.js';
import { PeopleService } from './people.service.js';

@Module({
	imports: [DatabaseModule, MetadataModule],
	controllers: [PeopleController],
	providers: [PeopleService],
	exports: [PeopleService],
})
export class PeopleModule {}
