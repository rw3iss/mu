import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { WatchlistService } from './watchlist.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('watchlist')
export class WatchlistController {
	constructor(private readonly watchlistService: WatchlistService) {}

	@Get()
	getWatchlist(@CurrentUser('id') userId: string) {
		return this.watchlistService.getWatchlist(userId);
	}

	@Post(':movieId')
	add(
		@Param('movieId') movieId: string,
		@Body() body: { notes?: string },
		@CurrentUser('id') userId: string,
	) {
		return this.watchlistService.add(userId, movieId, body?.notes);
	}

	@Post(':movieId/toggle')
	toggle(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return this.watchlistService.toggle(userId, movieId);
	}

	@Delete(':movieId')
	remove(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		this.watchlistService.remove(userId, movieId);
		return { success: true };
	}
}
