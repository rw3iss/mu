import { isUserSettingKey } from '@mu/shared';
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	NotFoundException,
	Param,
	Put,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { type JwtUser, PermissionsService } from '../common/permissions/index.js';
import { SettingsService } from './settings.service.js';

/**
 * Per-user settings surface.
 *
 * - `/settings/me`            — current user's merged view
 * - `/settings/me/:key`       — write / delete a single override
 * - `/users/:id/settings`     — admin support endpoint to view another
 *                               user's overrides
 * - `/users/:id/settings/:key` — admin or self, allowlist-enforced
 */
@Controller()
export class UserSettingsController {
	constructor(
		private readonly settings: SettingsService,
		private readonly permissions: PermissionsService,
	) {}

	@Get('settings/me')
	@RequireAction('view:library')
	getMine(@CurrentUser() user: JwtUser) {
		const userId = user?.sub ?? user?.id;
		if (!userId || user.role === 'share') {
			throw new ForbiddenException('No user context');
		}
		return this.settings.getAllForUser(userId);
	}

	@Put('settings/me/:key')
	@RequireAction('edit:own-settings')
	setMine(
		@CurrentUser() user: JwtUser,
		@Param('key') key: string,
		@Body() body: { value: unknown },
	) {
		const userId = user?.sub ?? user?.id;
		if (!userId) throw new ForbiddenException('No user context');
		if (!isUserSettingKey(key)) {
			throw new BadRequestException(`Key not user-overridable: ${key}`);
		}
		this.settings.setForUser(key, body.value, userId);
		return { key, value: body.value };
	}

	@Delete('settings/me/:key')
	@RequireAction('edit:own-settings')
	deleteMine(@CurrentUser() user: JwtUser, @Param('key') key: string) {
		const userId = user?.sub ?? user?.id;
		if (!userId) throw new ForbiddenException('No user context');
		const deleted = this.settings.deleteForUser(key, userId);
		return { deleted };
	}

	// --- Admin / self access to another user's settings -------------------

	@Get('users/:id/settings')
	@RequireAction('view:library')
	getUserSettings(@CurrentUser() actor: JwtUser, @Param('id') id: string) {
		this.assertReadAccess(actor, id);
		return {
			overrides: this.settings.getUserOverrides(id),
			merged: this.settings.getAllForUser(id),
		};
	}

	@Put('users/:id/settings/:key')
	@RequireAction('edit:own-settings')
	setUserSetting(
		@CurrentUser() actor: JwtUser,
		@Param('id') id: string,
		@Param('key') key: string,
		@Body() body: { value: unknown },
	) {
		const isAllowlisted = isUserSettingKey(key);
		if (!this.permissions.canEditUserSettings(actor, id, isAllowlisted)) {
			throw new ForbiddenException(
				isAllowlisted ? 'Cannot edit another user’s settings' : 'Key not user-overridable',
			);
		}
		const skipAllowlist = this.permissions.can(actor?.role, 'admin:any-user-setting');
		this.settings.setForUser(key, body.value, id, skipAllowlist);
		return { key, value: body.value };
	}

	@Delete('users/:id/settings/:key')
	@RequireAction('edit:own-settings')
	deleteUserSetting(
		@CurrentUser() actor: JwtUser,
		@Param('id') id: string,
		@Param('key') key: string,
	) {
		// Admins can drop any key; self can drop their own allowlisted keys.
		if (!this.permissions.canEditUserSettings(actor, id, isUserSettingKey(key))) {
			throw new ForbiddenException('Cannot edit settings');
		}
		const deleted = this.settings.deleteForUser(key, id);
		if (!deleted) throw new NotFoundException(`No override for ${key}`);
		return { deleted };
	}

	private assertReadAccess(actor: JwtUser, targetUserId: string): void {
		if (this.permissions.canManageUsers(actor)) return;
		if (this.permissions.isSelf(actor, targetUserId)) return;
		throw new ForbiddenException('Cannot view another user’s settings');
	}
}
