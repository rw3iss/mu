import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { type BookmarkInput, BookmarksService } from './bookmarks.service.js';

@Controller('bookmarks')
export class BookmarksController {
	constructor(private readonly bookmarks: BookmarksService) {}

	@RequireAction('view:own-data')
	@Get()
	list(@CurrentUser() user: { sub: string }) {
		return { bookmarks: this.bookmarks.listBookmarks(user.sub) };
	}

	@RequireAction('view:own-data')
	@Post()
	async add(@CurrentUser() user: { sub: string }, @Body() body: BookmarkInput) {
		if (!body || (body.tmdbId == null && !body.imdbId && !body.title)) {
			throw new BadRequestException('Provide at least one of: tmdbId, imdbId, title');
		}
		const movieId = await this.bookmarks.addBookmark(user.sub, body);
		return { movieId, ok: true };
	}

	@RequireAction('view:own-data')
	@Delete(':movieId')
	remove(@CurrentUser() user: { sub: string }, @Param('movieId') movieId: string) {
		const removed = this.bookmarks.removeBookmark(user.sub, movieId);
		return { ok: removed };
	}
}
