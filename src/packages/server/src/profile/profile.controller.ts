import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Req,
} from '@nestjs/common';
import type { UpdateProfileInput } from '@mu/shared';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ProfileService } from './profile.service.js';

/** Max avatar upload size (the global multipart cap is higher). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

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

	/** Upload a new avatar image (multipart). Stored under /uploads/avatars. */
	@RequireAction('edit:own-settings')
	@Post('me/avatar')
	async uploadAvatar(@CurrentUser('id') userId: string, @Req() req: FastifyRequest) {
		const parts = (req as unknown as { parts: () => AsyncIterable<any> }).parts();
		let file: { buffer: Buffer; mimetype: string } | null = null;
		let tooLarge = false;

		for await (const part of parts) {
			if (part.type !== 'file') continue;
			const isImage = String(part.mimetype || '').startsWith('image/');
			if (file || !isImage) {
				// Drain unused file parts so the stream completes cleanly.
				for await (const _ of part.file as AsyncIterable<Buffer>) {
					void _;
				}
				continue;
			}
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of part.file as AsyncIterable<Buffer>) {
				size += chunk.length;
				if (size > MAX_AVATAR_BYTES) {
					tooLarge = true;
					break;
				}
				chunks.push(chunk);
			}
			if (part.file.truncated) tooLarge = true;
			if (!tooLarge) file = { buffer: Buffer.concat(chunks), mimetype: String(part.mimetype) };
		}

		if (tooLarge) throw new BadRequestException('Avatar image is too large (max 5MB)');
		if (!file) throw new BadRequestException('No image file provided');
		return this.profile.setUploadedAvatar(userId, file.buffer, file.mimetype);
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
