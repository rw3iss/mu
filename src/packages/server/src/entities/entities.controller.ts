import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { EntityRatingsService } from './entity-ratings.service.js';
import { EntityResolverRegistry } from './entity-resolver.registry.js';

/**
 * Generic per-entity user data, keyed by `/entities/:type/:id`. Comment routes
 * for entities live in the comments module (`EntityCommentsController`).
 */
@Controller('entities')
export class EntitiesController {
	constructor(
		private readonly registry: EntityResolverRegistry,
		private readonly ratings: EntityRatingsService,
	) {}

	@RequireAction('view:own-data')
	@Get(':type/:id/rating')
	async getRating(
		@Param('type') type: string,
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
	) {
		const ref = await this.registry.require(type, id);
		return { rating: this.ratings.get(userId, ref)?.rating ?? null };
	}

	@RequireAction('view:own-data')
	@Put(':type/:id/rating')
	async setRating(
		@Param('type') type: string,
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body() body: { rating: number },
	) {
		const ref = await this.registry.require(type, id);
		return this.ratings.rate(userId, ref, body?.rating);
	}

	@RequireAction('view:own-data')
	@Delete(':type/:id/rating')
	async removeRating(
		@Param('type') type: string,
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
	) {
		const ref = await this.registry.require(type, id);
		this.ratings.remove(userId, ref);
		return { success: true };
	}

	@RequireAction('view:library')
	@Get(':type/:id/rating-summary')
	async ratingSummary(
		@Param('type') type: string,
		@Param('id') id: string,
		@CurrentUser('id') userId?: string,
	) {
		const ref = await this.registry.require(type, id);
		return this.ratings.summary(ref, userId);
	}
}
