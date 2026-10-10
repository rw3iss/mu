import { stat } from 'node:fs/promises';
import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
	Req,
	Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { RequireFeature } from '../../features/require-feature.decorator.js';
import { DirectPlayService } from '../../stream/direct-play/direct-play.service.js';
import { MusicOfflineService } from './music-offline.service.js';

/** Offline downloads: policy, signed URL issuance, and the token-auth file route. */
@RequireFeature('music')
@Controller('music/offline')
export class MusicOfflineController {
	constructor(
		private readonly offline: MusicOfflineService,
		private readonly directPlay: DirectPlayService,
	) {}

	@RequireAction('view:library')
	@Get('policy')
	policy(@CurrentUser('role') role: string | undefined) {
		return this.offline.policy(role);
	}

	@RequireAction('view:library')
	@Post('token')
	token(
		@CurrentUser() user: { id?: string; sub?: string; role?: string },
		@Body() body: { trackIds?: string[]; caps?: string },
	) {
		return this.offline.issue(
			{ id: String(user?.sub ?? user?.id ?? ''), role: user?.role },
			Array.isArray(body?.trackIds) ? body.trackIds : [],
			body?.caps,
		);
	}

	/**
	 * File bytes for a signed download URL. Public at the JWT layer — the
	 * `t` token is the credential (bound to this file + profile + caps).
	 */
	@Public()
	@Get('files/:trackFileId')
	async file(
		@Param('trackFileId') trackFileId: string,
		@Query('t') token: string | undefined,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const payload = this.offline.verify(trackFileId, token);
		const path = await this.offline.resolveFile(payload);
		await stat(path).catch(() => {
			throw new NotFoundException('File not found');
		});
		reply.header('Cache-Control', 'private, no-store');
		return this.directPlay.serveFile(path, request, reply);
	}
}
