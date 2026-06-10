import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { CommentsService } from './comments.service.js';

@Controller('comments')
export class CommentsController {
	constructor(private readonly comments: CommentsService) {}

	/**
	 * Comment tree for a movie. `view:library` is satisfied by a valid
	 * movie-scoped share token too (X-Share-Token / ?shareToken=), so public
	 * watch pages can load comments — `/api/v1/comments` is in the share
	 * route allowlist.
	 */
	@RequireAction('view:library')
	@Get('movie/:movieId')
	list(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return {
			comments: this.comments.getForMovie(movieId, userId),
			count: this.comments.count(movieId),
		};
	}

	@RequireAction('view:own-data')
	@Post('movie/:movieId')
	create(
		@Param('movieId') movieId: string,
		@CurrentUser('id') userId: string,
		@Body() body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	) {
		return { comments: this.comments.create(movieId, userId, body ?? ({} as any)) };
	}

	@RequireAction('view:own-data')
	@Patch(':id')
	update(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body() body: { text?: string; timeSeconds?: number | null },
	) {
		return { comments: this.comments.update(id, userId, body ?? {}) };
	}

	@RequireAction('view:own-data')
	@Delete(':id')
	remove(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@CurrentUser('role') role: string,
	) {
		return { comments: this.comments.remove(id, userId, role === 'admin') };
	}

	@RequireAction('view:own-data')
	@Post(':id/react')
	react(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body() body: { emoji: string },
	) {
		return { comments: this.comments.toggleReaction(id, userId, body?.emoji ?? '') };
	}
}
