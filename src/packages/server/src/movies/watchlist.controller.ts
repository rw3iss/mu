import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { WatchlistService } from './watchlist.service.js';

@Controller('watchlist')
export class WatchlistController {
	constructor(private readonly watchlistService: WatchlistService) {}

	@RequireAction('view:own-data')
	@Get()
	getWatchlist(@CurrentUser('id') userId: string) {
		return this.watchlistService.getWatchlist(userId);
	}

	@RequireAction('view:own-data')
	@Post(':movieId')
	add(
		@Param('movieId') movieId: string,
		@Body() body: { notes?: string },
		@CurrentUser('id') userId: string,
	) {
		return this.watchlistService.add(userId, movieId, body?.notes);
	}

	@RequireAction('view:own-data')
	@Post(':movieId/toggle')
	toggle(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return this.watchlistService.toggle(userId, movieId);
	}

	@RequireAction('view:own-data')
	@Delete(':movieId')
	remove(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		this.watchlistService.remove(userId, movieId);
		return { success: true };
	}
}
