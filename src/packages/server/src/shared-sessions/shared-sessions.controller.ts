import type { SharedSessionSettings } from '@mu/shared';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { SharedSessionsService } from './shared-sessions.service.js';

/**
 * Shared Sessions ("watch party") REST surface. Every route requires
 * `view:library` (any member who can watch); admin-only actions are enforced
 * in the service against `session.adminUserId`. Playback-sync commands, chat,
 * and WebRTC signaling do NOT live here — they flow over the WS gateway.
 */
@Controller('shared-sessions')
export class SharedSessionsController {
	constructor(private readonly sessions: SharedSessionsService) {}

	/** Create a session (caller becomes admin). */
	@RequireAction('view:library')
	@Post()
	create(@CurrentUser('id') userId: string, @Body() body: { movieId: string; name?: string }) {
		return this.sessions.create(userId, body?.movieId, body?.name);
	}

	/** The caller's active session, for reload rehydrate. */
	@RequireAction('view:library')
	@Get('mine')
	mine(@CurrentUser('id') userId: string) {
		return this.sessions.getMine(userId);
	}

	/** STUN + short-lived TURN credentials for WebRTC voice. */
	@RequireAction('view:library')
	@Get('ice-config')
	iceConfig(@CurrentUser('id') userId: string) {
		return this.sessions.iceConfig(userId);
	}

	/** Invite users (admin, or members when `allowMemberInvites`). */
	@RequireAction('view:library')
	@Post(':id/invite')
	invite(
		@CurrentUser('id') userId: string,
		@Param('id') id: string,
		@Body() body: { userIds: string[] },
	) {
		return this.sessions.invite(id, userId, body?.userIds ?? []);
	}

	/** Accept an invite / join the session. */
	@RequireAction('view:library')
	@Post(':id/join')
	join(@CurrentUser('id') userId: string, @Param('id') id: string) {
		return this.sessions.join(id, userId);
	}

	/** Leave (an admin must transfer, or ends when last). */
	@RequireAction('view:library')
	@Post(':id/leave')
	leave(
		@CurrentUser('id') userId: string,
		@Param('id') id: string,
		@Body() body: { newAdminUserId?: string },
	) {
		return this.sessions.leave(id, userId, body?.newAdminUserId);
	}

	/** Transfer the admin role (admin only). */
	@RequireAction('view:library')
	@Post(':id/transfer-admin')
	transferAdmin(
		@CurrentUser('id') userId: string,
		@Param('id') id: string,
		@Body() body: { userId: string },
	) {
		return this.sessions.transferAdmin(id, userId, body?.userId);
	}

	/** End the session (admin only). */
	@RequireAction('view:library')
	@Post(':id/end')
	end(@CurrentUser('id') userId: string, @Param('id') id: string) {
		return this.sessions.end(id, userId);
	}

	/** Update settings (admin only). */
	@RequireAction('view:library')
	@Patch(':id/settings')
	updateSettings(
		@CurrentUser('id') userId: string,
		@Param('id') id: string,
		@Body() body: { settings: Partial<SharedSessionSettings> },
	) {
		return this.sessions.updateSettings(id, userId, body?.settings ?? {});
	}

	/** Chat backlog for the session. */
	@RequireAction('view:library')
	@Get(':id/messages')
	messages(@Param('id') id: string) {
		return this.sessions.listMessages(id);
	}

	/** Full session view (member-scoped). */
	@RequireAction('view:library')
	@Get(':id')
	get(@CurrentUser('id') userId: string, @Param('id') id: string) {
		return this.sessions.getView(id, userId);
	}
}
