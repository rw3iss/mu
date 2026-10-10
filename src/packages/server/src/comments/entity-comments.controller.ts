import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { EntityResolverRegistry } from '../entities/entity-resolver.registry.js';
import { CommentsService } from './comments.service.js';

/**
 * Generic comment routes for any entity (`/entities/:type/:id/comments`).
 * Edit / delete / react stay on `/comments/:id[...]` (keyed by comment id).
 */
@Controller('entities')
export class EntityCommentsController {
	constructor(
		private readonly comments: CommentsService,
		private readonly registry: EntityResolverRegistry,
	) {}

	@RequireAction('view:library')
	@Get(':type/:id/comments')
	async list(
		@Param('type') type: string,
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
	) {
		const ref = await this.registry.require(type, id);
		return {
			comments: this.comments.getForEntity(ref, userId),
			count: this.comments.count(ref),
		};
	}

	@RequireAction('view:own-data')
	@Post(':type/:id/comments')
	async create(
		@Param('type') type: string,
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body() body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	) {
		const ref = await this.registry.require(type, id);
		return { comments: this.comments.create(ref, userId, body ?? ({} as any)) };
	}
}
