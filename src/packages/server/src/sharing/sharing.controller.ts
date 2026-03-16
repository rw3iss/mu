import {
	Controller,
	Get,
	NotFoundException,
	Param,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MovieListQuery } from '@mu/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles } from '../database/schema/index.js';
import { MoviesService } from '../movies/movies.service.js';
import { DirectPlayService } from '../stream/direct-play/direct-play.service.js';
import { HlsGeneratorService } from '../stream/transcoder/hls-generator.service.js';
import { StreamService } from '../stream/stream.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';
import { SharingAuthGuard } from './sharing-auth.guard.js';
import { SharingService } from './sharing.service.js';

@Controller('shared')
@Public()
export class SharingController {
	constructor(
		private readonly sharingService: SharingService,
		private readonly moviesService: MoviesService,
		private readonly streamService: StreamService,
		private readonly hlsGenerator: HlsGeneratorService,
		private readonly transcoderService: TranscoderService,
		private readonly directPlayService: DirectPlayService,
		private readonly db: DatabaseService,
	) {}

	/**
	 * GET /shared/info — Public info endpoint for connectivity testing.
	 */
	@Get('info')
	getInfo() {
		const config = this.sharingService.getConfig();
		if (!config.enabled) {
			throw new NotFoundException('Library sharing is not enabled');
		}
		return {
			serverName: config.serverName,
			movieCount: this.sharingService.getMovieCount(),
			passwordRequired: !!config.password,
		};
	}

	/**
	 * GET /shared/movies — List movies in the shared library.
	 */
	@Get('movies')
	@UseGuards(SharingAuthGuard)
	getMovies(@Query() query: MovieListQuery) {
		const result = this.moviesService.findAll(query);
		return {
			movies: result.movies.map((m: any) => ({
				...m,
				rating: undefined,
				watchPosition: undefined,
				watchCompleted: undefined,
				inWatchlist: undefined,
			})),
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
			totalPages: result.totalPages,
		};
	}

	/**
	 * GET /shared/movies/:id — Get movie detail.
	 */
	@Get('movies/:id')
	@UseGuards(SharingAuthGuard)
	getMovie(@Param('id') id: string) {
		return this.moviesService.findById(id);
	}

	/**
	 * GET /shared/stream/:movieId/start — Start a streaming session.
	 */
	@Get('stream/:movieId/start')
	@UseGuards(SharingAuthGuard)
	async startStream(@Param('movieId') movieId: string, @Query('quality') quality?: string) {
		return this.streamService.startStream(movieId, '__shared__', { quality });
	}

	/**
	 * GET /shared/stream/:sessionId/manifest.m3u8 — Serve HLS manifest.
	 */
	@Get('stream/:sessionId/manifest.m3u8')
	@UseGuards(SharingAuthGuard)
	async getManifest(@Param('sessionId') sessionId: string, @Res() reply: FastifyReply) {
		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const manifest = await this.hlsGenerator.getManifest(sessionId, dir);
		if (!manifest) {
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Manifest not yet available' });
		}

		return reply
			.header('Content-Type', 'application/vnd.apple.mpegurl')
			.header('Cache-Control', 'no-cache')
			.send(manifest);
	}

	/**
	 * GET /shared/stream/:sessionId/:segmentFile — Serve HLS segment.
	 */
	@Get('stream/:sessionId/:segmentFile')
	@UseGuards(SharingAuthGuard)
	async getSegment(
		@Param('sessionId') sessionId: string,
		@Param('segmentFile') segmentFile: string,
		@Res() reply: FastifyReply,
	) {
		const match = segmentFile.match(/^segment_(\d+)\.ts$/);
		if (!match) {
			return reply.status(404).send({ message: 'Invalid segment path' });
		}

		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const segment = await this.hlsGenerator.getSegment(sessionId, parseInt(match[1]!, 10), dir);
		if (!segment) {
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Segment not ready' });
		}

		return reply
			.header('Content-Type', 'video/mp2t')
			.header('Cache-Control', 'public, max-age=86400')
			.send(segment);
	}

	/**
	 * GET /shared/stream/direct/:fileId — Direct play with range support.
	 */
	@Get('stream/direct/:fileId')
	@UseGuards(SharingAuthGuard)
	async directPlay(
		@Param('fileId') fileId: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const fileRows = this.db.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.id, fileId))
			.all();
		if (fileRows.length === 0) {
			throw new NotFoundException(`File ${fileId} not found`);
		}
		return this.directPlayService.serveFile(fileRows[0]!.filePath, request, reply);
	}

	/**
	 * GET /shared/genres — List available genres.
	 */
	@Get('genres')
	@UseGuards(SharingAuthGuard)
	getGenres() {
		return this.moviesService.getGenres();
	}
}
