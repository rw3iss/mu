import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { HistoryService } from './history.service.js';

@Controller('history')
export class HistoryController {
	constructor(private readonly historyService: HistoryService) {}

	/**
	 * Bulk fetch of every in-progress resume position for the current
	 * user. The client hydrates its `watchPositions` signal from this
	 * once on app load + occasionally on focus, so movie cards in any
	 * view can show the resume bar without a per-card request.
	 */
	@RequireAction('view:own-data')
	@Get('positions')
	getAllPositions(@CurrentUser('id') userId: string) {
		return this.historyService.getAllPositions(userId);
	}

	/**
	 * Clear the resume position for a single movie. Called when the
	 * player reaches the end of the stream or when the user picks
	 * "Start from beginning". Idempotent — returns `{ cleared: false }`
	 * if no row existed.
	 */
	@RequireAction('view:own-data')
	@Delete('movies/:movieId/position')
	clearPosition(@CurrentUser('id') userId: string, @Param('movieId') movieId: string) {
		const cleared = this.historyService.clearPosition(userId, movieId);
		return { success: true, cleared };
	}

	@RequireAction('view:own-data')
	@Get()
	getHistory(
		@CurrentUser('id') userId: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		return this.historyService.getHistory(
			userId,
			page ? parseInt(page, 10) : undefined,
			pageSize ? parseInt(pageSize, 10) : undefined,
		);
	}

	@RequireAction('view:own-data')
	@Get('watched/count')
	getWatchedCount(@CurrentUser('id') userId: string) {
		return { count: this.historyService.getWatchedCount(userId) };
	}

	@RequireAction('view:own-data')
	@Delete('watched')
	clearWatched(@CurrentUser('id') userId: string) {
		const cleared = this.historyService.clearWatchedFlags(userId);
		return { success: true, clearedCount: cleared };
	}

	@RequireAction('view:own-data')
	@Delete()
	clearHistory(@CurrentUser('id') userId: string) {
		this.historyService.clearHistory(userId);
		return { success: true };
	}

	@RequireAction('view:own-data')
	@Get('continue')
	getContinueWatching(@CurrentUser('id') userId: string) {
		return this.historyService.getContinueWatching(userId);
	}
}
