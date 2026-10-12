import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { MusicShareKind } from '@mu/shared';
import {
	Body,
	Controller,
	Delete,
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
import { ArtworkService } from '../catalog/artwork.service.js';
import { MusicQueryService } from '../library/music-query.service.js';
import { MusicStreamService } from '../playback/music-stream.service.js';
import { MusicShareService } from './music-share.service.js';

type AuthUser = { sub?: string; id?: string; role: string };
const who = (u: AuthUser) => ({ id: (u.sub ?? u.id)!, role: u.role });

/**
 * Music share links. Owner routes need a login; `public/:token/*` routes are
 * open (the token is the credential) and every one is scoped by the share's
 * track set in MusicShareService.
 */
@RequireFeature('music')
@Controller('music')
export class MusicShareController {
	constructor(
		private readonly shares: MusicShareService,
		private readonly stream: MusicStreamService,
		private readonly query: MusicQueryService,
		private readonly artwork: ArtworkService,
		private readonly directPlay: DirectPlayService,
	) {}

	/** Create a public link for a track, album, (own/public) playlist, or a queue snapshot. */
	@RequireAction('view:library')
	@Post('share')
	create(
		@Body() body: { kind: MusicShareKind; id?: string; trackIds?: string[] },
		@CurrentUser() user: AuthUser,
	) {
		return this.shares.create(who(user), body ?? ({} as never));
	}

	@RequireAction('view:library')
	@Get('share')
	mine(@CurrentUser() user: AuthUser) {
		return this.shares.listMine(who(user).id);
	}

	@RequireAction('view:library')
	@Delete('share/:token')
	revoke(@Param('token') token: string, @CurrentUser() user: AuthUser) {
		this.shares.revoke(who(user), token);
		return { ok: true };
	}

	// ── Public (no login) ──────────────────────────────────────────────

	@Public()
	@Get('public/:token')
	payload(@Param('token') token: string) {
		return this.shares.payload(token);
	}

	@Public()
	@Get('public/:token/tracks/:trackId')
	track(@Param('token') token: string, @Param('trackId') trackId: string) {
		return this.shares.track(token, trackId);
	}

	@Public()
	@Get('public/:token/stream/:trackId/start')
	start(
		@Param('token') token: string,
		@Param('trackId') trackId: string,
		@Query('profile') profile: string | undefined,
		@Query('caps') caps: string | undefined,
	) {
		return this.shares.startStream(token, trackId, { profile, caps });
	}

	@Public()
	@Get('public/:token/files/:trackFileId')
	async file(
		@Param('token') token: string,
		@Param('trackFileId') trackFileId: string,
		@Query('p') profile: string | undefined,
		@Query('c') caps: string | undefined,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		this.shares.assertFile(token, trackFileId);
		const path = await this.stream.resolveFile(trackFileId, profile, caps);
		await stat(path).catch(() => {
			throw new NotFoundException('File not found');
		});
		return this.directPlay.serveFile(path, request, reply);
	}

	@Public()
	@Get('public/:token/waveform/:trackFileId')
	waveform(@Param('token') token: string, @Param('trackFileId') trackFileId: string) {
		this.shares.assertFile(token, trackFileId);
		return this.stream.waveform(trackFileId);
	}

	@Public()
	@Get('public/:token/lyrics/:trackId')
	lyrics(@Param('token') token: string, @Param('trackId') trackId: string) {
		this.shares.assertLyrics(token, trackId);
		return this.query.getLyrics(trackId);
	}

	@Public()
	@Get('public/:token/art/:artId')
	async art(
		@Param('token') token: string,
		@Param('artId') artId: string,
		@Query('size') size: string | undefined,
		@Res() reply: FastifyReply,
	) {
		this.shares.assertArt(token, artId);
		const path = await this.artwork.variant(artId, Number(size) || 600);
		if (!path) throw new NotFoundException('Artwork not found');
		return reply
			.header('Cache-Control', 'public, max-age=86400')
			.type('image/jpeg')
			.send(createReadStream(path));
	}
}
