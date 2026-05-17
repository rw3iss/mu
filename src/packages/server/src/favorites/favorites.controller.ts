import { BadRequestException, Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
	type AddFavoriteInput,
	FavoritesService,
	type RemoveFavoriteInput,
} from './favorites.service.js';

@Controller('favorites')
export class FavoritesController {
	constructor(private readonly favorites: FavoritesService) {}

	@Get()
	async list(@CurrentUser('id') userId: string) {
		const items = await this.favorites.list(userId);
		return { favorites: items };
	}

	@Get('keys')
	keys(@CurrentUser('id') userId: string) {
		return this.favorites.listKeys(userId);
	}

	@Post()
	async add(@CurrentUser('id') userId: string, @Body() body: AddFavoriteInput) {
		if (!body || (body.entityType !== 'person' && body.entityType !== 'movie')) {
			throw new BadRequestException('entityType must be "person" or "movie"');
		}
		if (body.entityType === 'movie' && !body.movieId) {
			throw new BadRequestException('movieId required for movie favorites');
		}
		if (body.entityType === 'person' && !body.tmdbId && !body.name) {
			throw new BadRequestException('tmdbId or name required for person favorites');
		}
		const fav = await this.favorites.add(userId, body);
		return { favorite: fav, ok: true };
	}

	@Delete()
	async remove(@CurrentUser('id') userId: string, @Body() body: RemoveFavoriteInput) {
		if (!body || (body.entityType !== 'person' && body.entityType !== 'movie')) {
			throw new BadRequestException('entityType must be "person" or "movie"');
		}
		const removed = await this.favorites.remove(userId, body);
		return { ok: removed };
	}
}
