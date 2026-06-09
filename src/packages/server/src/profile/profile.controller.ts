import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import type { UpdateProfileInput } from '@mu/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ProfileService } from './profile.service.js';

@Controller('profile')
export class ProfileController {
	constructor(private readonly profile: ProfileService) {}

	/** The admin "show users info" master switch — readable by any authed user
	 *  so the client can decide whether to surface Members + profiles. */
	@RequireAction('view:own-data')
	@Get('config')
	getConfig() {
		return this.profile.getSystemConfig();
	}

	/** Admin: toggle the master switch. */
	@Roles('admin')
	@RequireAction('edit:app-settings')
	@Put('config')
	setConfig(@Body() body: { showUsersInfo: boolean }) {
		return this.profile.setSystemConfig(!!body?.showUsersInfo);
	}

	/** The current user's own (always-accessible, editable) profile. */
	@RequireAction('view:own-data')
	@Get('me')
	getMe(@CurrentUser('id') userId: string) {
		return this.profile.getOwnProfile(userId);
	}

	/** Update the current user's editable profile fields. */
	@RequireAction('edit:own-settings')
	@Patch('me')
	updateMe(@CurrentUser('id') userId: string, @Body() body: UpdateProfileInput) {
		return this.profile.updateOwnProfile(userId, body ?? {});
	}

	/** A public read view of any user — 404 unless visible to the requester
	 *  (admins + the owner see everything; others only opted-in profiles). */
	@RequireAction('view:own-data')
	@Get(':username')
	getByUsername(
		@Param('username') username: string,
		@CurrentUser('id') id: string,
		@CurrentUser('role') role: string,
	) {
		return this.profile.getProfileByUsername(username, { id, role });
	}
}

@Controller('members')
export class MembersController {
	constructor(private readonly profile: ProfileService) {}

	/** The Members directory — gated by the admin master switch for non-admins. */
	@RequireAction('view:own-data')
	@Get()
	async list(@CurrentUser('id') id: string, @CurrentUser('role') role: string) {
		return { members: await this.profile.listMembers({ id, role }) };
	}
}
