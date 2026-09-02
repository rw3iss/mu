import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
	constructor(private readonly notifications: NotificationsService) {}

	@RequireAction('view:own-data')
	@Get()
	list(
		@CurrentUser('id') userId: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		return this.notifications.list(
			userId,
			parseInt(page ?? '1', 10) || 1,
			parseInt(pageSize ?? '30', 10) || 30,
		);
	}

	@RequireAction('view:own-data')
	@Get('unread-count')
	unread(@CurrentUser('id') userId: string) {
		return { count: this.notifications.unreadCount(userId) };
	}

	@RequireAction('view:own-data')
	@Post(':id/read')
	markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
		this.notifications.markRead(id, userId);
		return { ok: true };
	}

	@RequireAction('view:own-data')
	@Post('read-all')
	markAllRead(@CurrentUser('id') userId: string) {
		this.notifications.markAllRead(userId);
		return { ok: true };
	}

	@RequireAction('view:own-data')
	@Delete(':id')
	remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
		this.notifications.remove(id, userId);
		return { ok: true };
	}

	/** Admin: create a system-wide announcement (userId null → all users). */
	@Roles('admin')
	@RequireAction('admin:server')
	@Post('system')
	createSystem(@Body() body: { type?: string; data?: Record<string, unknown> }) {
		const n = this.notifications.create(body?.type || 'announcement', body?.data ?? {}, null);
		return { notification: n };
	}
}
