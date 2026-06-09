import { Module } from '@nestjs/common';
import { FavoritesModule } from '../favorites/favorites.module.js';
import { MoviesModule } from '../movies/movies.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { MembersController, ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
	imports: [FavoritesModule, MoviesModule, SettingsModule],
	controllers: [ProfileController, MembersController],
	providers: [ProfileService],
	exports: [ProfileService],
})
export class ProfileModule {}
