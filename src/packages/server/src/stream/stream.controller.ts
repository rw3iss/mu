import {
	Body,
	Controller,
	Delete,
	Get,
	Logger,
	NotFoundException,
	Param,
	Post,
	Query,
	Req,
	Res,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles } from '../database/schema/index.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { StreamService } from './stream.service.js';
import { ChunkManagerService } from './transcoder/chunk-manager.service.js';
import { HlsGeneratorService } from './transcoder/hls-generator.service.js';
import { TranscodeDebuggerService } from './transcoder/transcode-debugger.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';

@Controller('stream')
export class StreamController {
	private readonly logger = new Logger(StreamController.name);

	constructor(
		private readonly streamService: StreamService,
		private readonly hlsGenerator: HlsGeneratorService,
		private readonly transcoderService: TranscoderService,
		private readonly chunkManager: ChunkManagerService,
		private readonly directPlayService: DirectPlayService,
		private readonly db: DatabaseService,
		private readonly transcodeDebugger: TranscodeDebuggerService,
		private readonly guidResolver: GuidResolverService,
	) {}

	/**
	 * Get stream mode info for a movie (whether it needs transcoding, has cache, etc.).
	 * Used by the client to show indicators on movie cards.
	 */
	@Get('info/:movieId')
	async getStreamInfo(@Param('movieId') movieId: string) {
		const info = await this.streamService.getMovieStreamInfo(movieId);
		if (!info) {
			throw new NotFoundException(`No available file for movie ${movieId}`);
		}
		return info;
	}

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

		// Check chunk-based transcoding first
		const sessionInfo = this.streamService.getSessionInfo(sessionId);
		if (sessionInfo?.movieFileId) {
			const chunkMap = this.chunkManager.getChunkMap(
				sessionInfo.movieFileId,
				sessionInfo.quality || '1080p',
			);
			if (chunkMap) {
				// Chunked mode: ready when the first chunk is complete
				const firstChunkReady = chunkMap.chunks[0]?.status === 'complete';
				const progress = this.chunkManager.getProgress(
					sessionInfo.movieFileId,
					sessionInfo.quality || '1080p',
				);
				return reply.send({
					state: firstChunkReady ? 'running' : 'preparing',
					ready: firstChunkReady,
					progress: progress.percent,
				});
			}
		}

		// Fallback: check if the manifest and first segment exist on disk
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
		const requestStart = Date.now();

		const failed = this.failedSessionReply(sessionId, reply);
		if (failed) return failed;

		// Check for chunk-based virtual manifest first
		const sessionInfo = this.streamService.getSessionInfo(sessionId);
		if (sessionInfo?.movieFileId) {
			const virtualManifest = this.chunkManager.getVirtualManifest(
				sessionInfo.movieFileId,
				sessionInfo.quality || '1080p',
			);
			if (virtualManifest) {
				return reply
					.header('Content-Type', 'application/vnd.apple.mpegurl')
					.header('Cache-Control', 'no-cache')
					.send(Buffer.from(virtualManifest));
			}
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const manifest = await this.hlsGenerator.getManifest(sessionId, dir);

		if (!manifest) {
			this.recordReply(sessionId, 'manifest', undefined, 503, requestStart);
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Manifest not yet available, transcoding in progress' });
		}

		this.recordReply(sessionId, 'manifest', undefined, 200, requestStart);
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
		const requestStart = Date.now();

		// segmentFile is e.g. "segment_0000.ts"
		const match = segmentFile.match(/^segment_(\d+)\.ts$/);
		if (!match) {
			return reply.status(404).send({ message: 'Invalid segment path' });
		}

		const failed = this.failedSessionReply(sessionId, reply);
		if (failed) return failed;

		const segmentNumber = parseInt(match[1]!, 10);
		const dir = this.streamService.getSessionCacheDir(sessionId);
		const segment = await this.hlsGenerator.getSegment(sessionId, segmentNumber, dir);

		if (!segment) {
			const sessionInfo = this.streamService.getSessionInfo(sessionId);

			// Check if this is a "complete" cache with missing segments (corruption)
			if (dir && sessionInfo?.movieFileId) {
				const hasCached = await this.transcoderService.hasCachedTranscode(
					sessionInfo.movieFileId,
					sessionInfo.quality || '1080p',
				);
				if (hasCached) {
					// Cache marked complete but segment is missing — corrupt cache
					this.logger.warn(
						`Corrupt cache: segment ${segmentNumber} missing from complete cache for ${this.guidResolver.resolve(sessionInfo.movieFileId)}. Clearing and restarting.`,
					);
					await this.transcoderService.clearCache(sessionInfo.movieFileId);
					this.recordReply(sessionId, 'segment', segmentNumber, 410, requestStart);
					return reply
						.status(410)
						.send({ message: 'Cache corrupted, please restart stream' });
				}
			}

			// Segment not cached — trigger on-demand chunk encoding if chunk system is active
			if (sessionInfo?.movieFileId) {
				const chunkMap = this.chunkManager.getChunkMap(
					sessionInfo.movieFileId,
					sessionInfo.quality || '1080p',
				);
				if (chunkMap) {
					// Reprioritize this segment and lookahead for immediate encoding
					const seekTime = segmentNumber * chunkMap.chunkDuration;
					this.chunkManager.reprioritizeForSeek(
						sessionInfo.movieFileId,
						sessionInfo.quality || '1080p',
						seekTime,
					);
				}
			}

			this.recordReply(sessionId, 'segment', segmentNumber, 503, requestStart);
			return reply
				.status(503)
				.header('Retry-After', '2')
				.send({ message: 'Segment not yet available, encoding triggered' });
		}

		this.recordReply(sessionId, 'segment', segmentNumber, 200, requestStart);
		this.transcodeDebugger.recordSegmentReady(sessionId, segmentNumber, segment.length);
		if (segmentNumber === 0) {
			this.transcodeDebugger.recordMilestone(sessionId, 'firstSegmentServed');
		}
		// Update session heartbeat — keeps session alive even if progress POSTs fail
		this.streamService.touchSession(sessionId);
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
	 * Restart transcoding from a new position (seek).
	 * Stops the current FFmpeg process and starts a new one from the given time.
	 */
	@Post(':sessionId/seek')
	async seekStream(
		@Param('sessionId') sessionId: string,
		@Body() body: { positionSeconds: number },
	) {
		await this.streamService.seekStream(sessionId, body.positionSeconds);
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
	 * Heartbeat endpoint — keeps session alive during pause.
	 */
	@Post(':sessionId/heartbeat')
	heartbeat(@Param('sessionId') sessionId: string) {
		this.streamService.touchSession(sessionId);
		return { ok: true };
	}

	/**
	 * List all active streaming sessions (admin endpoint).
	 */
	@Get('sessions')
	async getActiveSessions() {
		return this.streamService.getActiveSessions();
	}

	/**
	 * Delete a cached transcode for a specific movie file + quality.
	 */
	@Delete('cache/:movieId/:quality')
	@Roles('admin')
	async deleteCachedVersion(
		@Param('movieId') movieId: string,
		@Param('quality') quality: string,
	) {
		// Find the movie file for this movie
		const file = this.db.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();

		if (!file) throw new NotFoundException('Movie file not found');

		await this.transcoderService.clearCacheQuality(file.id, quality);
		this.logger.log(
			`Deleted cached version ${quality} for ${this.guidResolver.resolve(movieId)}`,
		);
		return { success: true };
	}

	// ── Private helpers ──────────────────────────────────────────────

	/**
	 * Shared early-return for manifest/segment handlers: if the transcoder
	 * has marked this session as failed, send a 500 with the recorded
	 * error and stop. Returns the reply when failed, null when the caller
	 * should continue normal processing.
	 */
	private failedSessionReply(sessionId: string, reply: FastifyReply): FastifyReply | null {
		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			this.logger.error(
				`Stream session ${this.guidResolver.resolve(sessionId)} failed: ${state.error}`,
			);
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}
		return null;
	}

	/**
	 * Shorthand for the 5-arg `transcodeDebugger.recordClientRequest`
	 * call repeated 6× in this controller — handles the `Date.now() - startMs`
	 * elapsed-time math so callers just pass the start timestamp.
	 */
	private recordReply(
		sessionId: string,
		kind: 'manifest' | 'segment',
		segNum: number | undefined,
		status: number,
		startMs: number,
	): void {
		this.transcodeDebugger.recordClientRequest(
			sessionId,
			kind,
			segNum,
			status,
			Date.now() - startMs,
		);
	}
}
