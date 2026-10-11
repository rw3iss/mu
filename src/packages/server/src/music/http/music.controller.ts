import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { MusicSettings } from '@mu/shared';
import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
	Req,
	Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { RequireFeature } from '../../features/require-feature.decorator.js';
import { DirectPlayService } from '../../stream/direct-play/direct-play.service.js';
import { MusicAdminService } from '../admin/music-admin.service.js';
import { ArtworkService } from '../catalog/artwork.service.js';
import { type ListQuery, MusicQueryService } from '../library/music-query.service.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { MusicStreamService } from '../playback/music-stream.service.js';

type RawQuery = Record<string, string | undefined>;

function listQuery(q: RawQuery): ListQuery {
	const num = (v: string | undefined) => {
		const n = v != null ? Number(v) : Number.NaN;
		return Number.isFinite(n) ? n : undefined;
	};
	return {
		q: q.q?.slice(0, 200) || undefined,
		genre: q.genre || undefined,
		yearFrom: num(q.yearFrom),
		yearTo: num(q.yearTo),
		minRating: num(q.minRating),
		artistId: q.artistId || undefined,
		sort: q.sort || undefined,
		order: q.order === 'asc' ? 'asc' : q.order === 'desc' ? 'desc' : undefined,
		page: num(q.page),
		pageSize: num(q.pageSize),
	};
}

/** Music browse, playback and settings. Every route 404s while Music is off. */
@RequireFeature('music')
@Controller('music')
export class MusicController {
	constructor(
		private readonly query: MusicQueryService,
		private readonly stream: MusicStreamService,
		private readonly artwork: ArtworkService,
		private readonly musicSettings: MusicSettingsService,
		private readonly directPlay: DirectPlayService,
		private readonly admin: MusicAdminService,
	) {}

	@RequireAction('view:library')
	@Get('albums')
	albums(@Query() q: RawQuery) {
		return this.query.listAlbums(listQuery(q));
	}

	@RequireAction('view:library')
	@Get('albums/:id')
	album(@Param('id') id: string, @CurrentUser('id') userId: string) {
		return this.query.getAlbum(id, userId);
	}

	@RequireAction('view:library')
	@Get('albums/:id/track-ids')
	albumTrackIds(@Param('id') id: string) {
		return this.query.albumTrackIds(id);
	}

	@RequireAction('view:library')
	@Get('artists')
	artists(@Query() q: RawQuery) {
		return this.query.listArtists(listQuery(q));
	}

	@RequireAction('view:library')
	@Get('artists/:id')
	artist(@Param('id') id: string, @CurrentUser('id') userId: string) {
		return this.query.getArtist(id, userId);
	}

	@RequireAction('view:library')
	@Get('tracks')
	tracks(@Query() q: RawQuery, @CurrentUser('id') userId: string) {
		return this.query.listTracks(listQuery(q), userId);
	}

	@RequireAction('view:library')
	@Get('tracks/:id')
	track(@Param('id') id: string, @CurrentUser('id') userId: string) {
		return this.query.getTrack(id, userId);
	}

	@RequireAction('view:library')
	@Get('tracks/:id/lyrics')
	lyrics(@Param('id') id: string) {
		return this.query.getLyrics(id);
	}

	@RequireAction('edit:lyrics')
	@Put('tracks/:id/lyrics')
	saveLyrics(
		@Param('id') id: string,
		@Body() body: { plain?: string | null; syncedLrc?: string | null },
		@CurrentUser('id') userId: string,
	) {
		this.query.saveLyrics(
			id,
			{
				plain: typeof body?.plain === 'string' ? body.plain : null,
				syncedLrc: typeof body?.syncedLrc === 'string' ? body.syncedLrc : null,
			},
			userId,
		);
		return { ok: true };
	}

	@RequireAction('view:library')
	@Get('genres')
	genres() {
		return this.query.listGenres();
	}

	@RequireAction('view:library')
	@Get('search')
	search(@Query('q') q: string | undefined) {
		return this.query.search((q ?? '').slice(0, 200));
	}

	@RequireAction('view:library')
	@Get('home')
	home(@CurrentUser('id') userId: string) {
		return {
			recentlyAdded: this.query.recentlyAdded(20),
			continueListening: userId ? this.query.continueListening(userId, 20) : [],
			mostPlayed: this.query.mostPlayed(20, userId),
			favorites: userId ? this.query.favoriteAlbums(userId, 20) : [],
		};
	}

	/** Resized album/artist art. Content-addressed, so cache it for a year. */
	@RequireAction('view:library')
	@Get('art/:artId')
	async art(
		@Param('artId') artId: string,
		@Query('size') size: string | undefined,
		@Res() reply: FastifyReply,
	) {
		const path = await this.artwork.variant(artId, Number(size) || 600);
		if (!path) throw new NotFoundException('Artwork not found');
		return reply
			.header('Cache-Control', 'public, max-age=31536000, immutable')
			.type('image/jpeg')
			.send(createReadStream(path));
	}

	@RequireAction('view:library')
	@Get('stream/:trackId/start')
	start(
		@Param('trackId') trackId: string,
		@Query('profile') profile: string | undefined,
		@Query('caps') caps: string | undefined,
	) {
		return this.stream.start(trackId, { profile, caps });
	}

	@RequireAction('view:library')
	@Post('stream/:sessionId/progress')
	progress(
		@Param('sessionId') sessionId: string,
		@Body() body: { positionSeconds?: number; completed?: boolean },
		@CurrentUser('id') userId: string,
	) {
		this.stream.progress(
			userId,
			sessionId,
			Number(body?.positionSeconds) || 0,
			body?.completed === true,
		);
		return { ok: true };
	}

	/** Bytes for a track: the original, or a cached transcode (built on first request). */
	@RequireAction('view:library')
	@Get('files/:trackFileId')
	async file(
		@Param('trackFileId') trackFileId: string,
		@Query('p') profile: string | undefined,
		@Query('c') caps: string | undefined,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const path = await this.stream.resolveFile(trackFileId, profile, caps);
		await stat(path).catch(() => {
			throw new NotFoundException('File not found');
		});
		return this.directPlay.serveFile(path, request, reply);
	}

	@RequireAction('view:library')
	@Get('waveform/:trackFileId')
	waveform(@Param('trackFileId') trackFileId: string) {
		return this.stream.waveform(trackFileId);
	}

	@RequireAction('view:library')
	@Get('settings')
	settings() {
		return this.musicSettings.get();
	}

	@RequireAction('admin:server')
	@Put('settings')
	saveSettings(@Body() patch: Partial<MusicSettings>) {
		const next = this.musicSettings.set(patch ?? {});
		// Prune / rebuild cached copies of unplayable files for the new policy.
		void this.admin.applyTranscodePolicy().catch(() => {});
		return next;
	}
}
