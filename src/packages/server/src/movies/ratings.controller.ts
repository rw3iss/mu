import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { RatingsService } from './ratings.service.js';

@Controller('ratings')
export class RatingsController {
	constructor(private readonly ratingsService: RatingsService) {}

	@RequireAction('view:own-data')
	@Get()
	getUserRatings(
		@CurrentUser('id') userId: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		return this.ratingsService.getUserRatings(
			userId,
			page ? parseInt(page, 10) : undefined,
			pageSize ? parseInt(pageSize, 10) : undefined,
		);
	}

	@RequireAction('view:own-data')
	@Get('unrated')
	getUnrated(
		@CurrentUser('id') userId: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		return this.ratingsService.getUnrated(
			userId,
			page ? parseInt(page, 10) : undefined,
			pageSize ? parseInt(pageSize, 10) : undefined,
		);
	}
}
