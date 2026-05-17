import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PeopleModule } from '../people/people.module.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';

@Module({
	imports: [DatabaseModule, PeopleModule],
	controllers: [FavoritesController],
	providers: [FavoritesService],
	exports: [FavoritesService],
})
export class FavoritesModule {}
