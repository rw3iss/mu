import {
	Controller,
	Get,
	Post,
	Delete,
	Param,
	Query,
	Body,
	Req,
	Res,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { StreamService } from './stream.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { eq } from 'drizzle-orm';
import { movieFiles } from '../database/schema/index.js';

@Controller('stream')
export class StreamController {
	private readonly logger = new Logger(StreamController.name);

	constructor(
		private readonly streamService: StreamService,
		private readonly hlsGenerator: HlsGeneratorService,
		private readonly transcoderService: TranscoderService,
		private readonly directPlayService: DirectPlayService,
		private readonly db: DatabaseService,
	) {}

	/**
	 * Start a new streaming session for a movie.
	 */
	@Get(':movieId/start')
	async startStream(
		@Param('movieId') movieId: string,
		@Query('quality') quality: string | undefined,
		@Query('audioTrack') audioTrack: string | undefined,
		@Query('subtitleTrack') subtitleTrack: string | undefined,
		@CurrentUser() user: any,
	) {
		return this.streamService.startStream(movieId, user.sub ?? user.id, {
			quality,
			audioTrack: audioTrack ? parseInt(audioTrack, 10) : undefined,
			subtitleTrack: subtitleTrack ? parseInt(subtitleTrack, 10) : undefined,
		});
	}

	/**
	 * Check readiness of a streaming session (is transcoding done / first segment available?).
	 */
	@Get(':sessionId/status')
	async getStatus(@Param('sessionId') sessionId: string, @Res() reply: FastifyReply) {
		const state = this.transcoderService.getTranscodeState(sessionId);

		if (state?.state === 'failed') {
			return reply.send({ state: 'failed', ready: false, error: state.error });
		}

		// Check if the manifest and first segment exist
		const dir = this.streamService.getSessionCacheDir(sessionId);
		const manifest = await this.hlsGenerator.getManifest(sessionId, dir);
		const firstSeg = await this.hlsGenerator.getSegment(sessionId, 0, dir);
		const ready = manifest !== null && firstSeg !== null;

		return reply.send({
			state: state?.state || (ready ? 'completed' : 'preparing'),
			ready,
		});
	}

	/**
	 * Get the HLS manifest for an active transcoding session.
	 */
	@Get(':sessionId/manifest.m3u8')
	async getManifest(@Param('sessionId') sessionId: string, @Res() reply: FastifyReply) {
		// Check if FFmpeg has crashed for this session
		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			this.logger.error(`Manifest requested for failed session ${sessionId}: ${state.error}`);
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const manifest = await this.hlsGenerator.getManifest(sessionId, dir);

		if (!manifest) {
			// Manifest not ready yet — transcoder is still generating.
			// Return 503 with Retry-After so HLS.js will retry.
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Manifest not yet available, transcoding in progress' });
		}

		return reply
			.header('Content-Type', 'application/vnd.apple.mpegurl')
			.header('Cache-Control', 'no-cache')
			.send(manifest);
	}

	/**
	 * Get a specific HLS segment for an active transcoding session.
	 */
	@Get(':sessionId/:segmentFile')
	async getSegment(
		@Param('sessionId') sessionId: string,
		@Param('segmentFile') segmentFile: string,
		@Res() reply: FastifyReply,
	) {
		// segmentFile is e.g. "segment_0000.ts"
		const match = segmentFile.match(/^segment_(\d+)\.ts$/);
		if (!match) {
			return reply.status(404).send({ message: 'Invalid segment path' });
		}

		// Check if FFmpeg has crashed for this session
		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const segment = await this.hlsGenerator.getSegment(sessionId, parseInt(match[1]!, 10), dir);

		if (!segment) {
			// Segment not yet transcoded — tell the client to retry
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Segment not yet available' });
		}

		return reply
			.header('Content-Type', 'video/mp2t')
			.header('Cache-Control', 'public, max-age=86400')
			.send(segment);
	}

	/**
	 * Update playback progress for an active session.
	 */
	@Post(':sessionId/progress')
	async updateProgress(
		@Param('sessionId') sessionId: string,
		@Body() body: { positionSeconds: number },
	) {
		await this.streamService.updateProgress(sessionId, body.positionSeconds);
		return { success: true };
	}

	/**
	 * End a streaming session, stopping any active transcode and cleaning up resources.
	 */
	@Delete(':sessionId')
	async endStream(@Param('sessionId') sessionId: string) {
		await this.streamService.endStream(sessionId);
		return { success: true };
	}

	/**
	 * Direct play / direct stream a file with HTTP range request support.
	 */
	@Get('direct/:fileId')
	async directPlay(
		@Param('fileId') fileId: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const fileRows = await this.db.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.id, fileId));

		if (fileRows.length === 0) {
			throw new NotFoundException(`File ${fileId} not found`);
		}

		const file = fileRows[0]!;
		return this.directPlayService.serveFile(file.filePath, request, reply);
	}

	/**
	 * List all active streaming sessions (admin endpoint).
	 */
	@Get('sessions')
	async getActiveSessions() {
		return this.streamService.getActiveSessions();
	}
}
