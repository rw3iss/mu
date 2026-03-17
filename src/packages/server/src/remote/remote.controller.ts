import {
	Body,
	Controller,
	Delete,
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
import { Roles } from '../common/decorators/roles.decorator.js';
import { RemoteService } from './remote.service.js';

@Controller('remote')
export class RemoteController {
	constructor(private readonly remoteService: RemoteService) {}

	/**
	 * GET /remote/servers — List configured remote servers.
	 */
	@Get('servers')
	getServers() {
		return this.remoteService.getServers();
	}

	/**
	 * POST /remote/servers — Add a remote server.
	 */
	@Post('servers')
	@Roles('admin')
	addServer(@Body() body: { url: string; password?: string; name?: string; enabled?: boolean }) {
		return this.remoteService.addServer({
			url: body.url,
			password: body.password ?? '',
			name: body.name ?? body.url,
			enabled: body.enabled ?? true,
		});
	}

	/**
	 * PUT /remote/servers/:id — Update a remote server.
	 */
	@Put('servers/:id')
	@Roles('admin')
	updateServer(
		@Param('id') id: string,
		@Body() body: Partial<{ url: string; password: string; name: string; enabled: boolean }>,
	) {
		const result = this.remoteService.updateServer(id, body);
		if (!result) throw new NotFoundException(`Server ${id} not found`);
		return result;
	}

	/**
	 * DELETE /remote/servers/:id — Remove a remote server.
	 */
	@Delete('servers/:id')
	@Roles('admin')
	removeServer(@Param('id') id: string) {
		const removed = this.remoteService.removeServer(id);
		if (!removed) throw new NotFoundException(`Server ${id} not found`);
		return { success: true };
	}

	/**
	 * POST /remote/servers/test — Test connection to a remote server.
	 */
	@Post('servers/test')
	@Roles('admin')
	async testConnection(@Body() body: { url: string; password?: string }) {
		try {
			const info = await this.remoteService.testConnection(body.url, body.password);
			return { success: true, ...info };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	}

	/**
	 * GET /remote/movies — Fetch movies from all enabled remote servers.
	 */
	@Get('movies')
	async getRemoteMovies(@Query() query: Record<string, string>) {
		return this.remoteService.fetchAllRemoteMovies(query);
	}

	/**
	 * GET /remote/movies/:serverId/:movieId — Get a specific remote movie detail.
	 */
	@Get('movies/:serverId/:movieId')
	async getRemoteMovie(@Param('serverId') serverId: string, @Param('movieId') movieId: string) {
		return this.remoteService.fetchMovieDetail(serverId, movieId);
	}

	/**
	 * GET /remote/stream/:serverId/:movieId/start — Start stream on remote server.
	 */
	@Get('stream/:serverId/:movieId/start')
	async startRemoteStream(
		@Param('serverId') serverId: string,
		@Param('movieId') movieId: string,
		@Query('quality') quality?: string,
	) {
		return this.remoteService.proxyStreamStart(serverId, movieId, quality);
	}

	/**
	 * GET /remote/stream/:serverId/:sessionId/manifest.m3u8 — Proxy HLS manifest.
	 */
	@Get('stream/:serverId/:sessionId/manifest.m3u8')
	async proxyManifest(
		@Param('serverId') serverId: string,
		@Param('sessionId') sessionId: string,
		@Res() reply: FastifyReply,
	) {
		const auth = this.remoteService.getServerAuth(serverId);
		if (!auth) throw new NotFoundException('Server not found');

		const response = await fetch(
			`${auth.baseUrl}/api/v1/shared/stream/${sessionId}/manifest.m3u8`,
			{ headers: auth.headers },
		);

		reply.status(response.status);
		for (const [key, value] of response.headers.entries()) {
			if (['content-type', 'cache-control'].includes(key.toLowerCase())) {
				reply.header(key, value);
			}
		}

		const body = Buffer.from(await response.arrayBuffer());
		return reply.send(body);
	}

	/**
	 * GET /remote/stream/:serverId/direct/:fileId — Proxy direct play with range support.
	 * Must be defined before the segment catch-all to avoid route conflict.
	 */
	@Get('stream/:serverId/direct/:fileId')
	async proxyDirectPlay(
		@Param('serverId') serverId: string,
		@Param('fileId') fileId: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const auth = this.remoteService.getServerAuth(serverId);
		if (!auth) throw new NotFoundException('Server not found');

		const headers: Record<string, string> = { ...auth.headers };
		const range = request.headers.range;
		if (range) headers.Range = range;

		const response = await fetch(`${auth.baseUrl}/api/v1/shared/stream/direct/${fileId}`, {
			headers,
		});

		reply.status(response.status);
		for (const [key, value] of response.headers.entries()) {
			const lower = key.toLowerCase();
			if (
				[
					'content-type',
					'content-length',
					'content-range',
					'accept-ranges',
					'cache-control',
				].includes(lower)
			) {
				reply.header(key, value);
			}
		}

		// Stream the response body instead of buffering the entire file
		if (response.body) {
			const { Readable } = await import('node:stream');
			const nodeStream = Readable.fromWeb(response.body as any);
			return reply.send(nodeStream);
		}
		return reply.send(Buffer.alloc(0));
	}

	/**
	 * GET /remote/stream/:serverId/:sessionId/subtitles/:trackFile — Proxy subtitle VTT.
	 * Must be defined before the segment catch-all to avoid route conflict.
	 * Tries the shared subtitle serve endpoint first (works for shared streams),
	 * then falls back to the standard stream subtitle endpoint.
	 */
	@Get('stream/:serverId/:sessionId/subtitles/:trackFile')
	async proxySubtitleVtt(
		@Param('serverId') serverId: string,
		@Param('sessionId') sessionId: string,
		@Param('trackFile') trackFile: string,
		@Res() reply: FastifyReply,
	) {
		const auth = this.remoteService.getServerAuth(serverId);
		if (!auth) throw new NotFoundException('Server not found');

		// Extract track index from filename (e.g. "0.vtt" -> "0")
		const trackMatch = trackFile.match(/^(\d+)\.vtt$/);
		if (!trackMatch) {
			return reply.status(404).send({ message: 'Invalid subtitle track path' });
		}
		const trackIndex = trackMatch[1];

		// Try multiple endpoints — the session may be a session ID or a file ID.
		// The shared subtitle endpoint uses file ID and sharing auth.
		// The stream subtitle endpoint uses session ID and JWT auth.
		const urls = [
			// Shared subtitle serve (works with sharing auth, uses file ID)
			`${auth.baseUrl}/api/v1/shared/subtitles/${sessionId}/${trackFile}`,
			// Standard stream subtitle endpoint (fallback, works if session exists in DB)
			`${auth.baseUrl}/api/v1/stream/${sessionId}/subtitles/${trackFile}`,
		];

		for (const url of urls) {
			const response = await fetch(url, { headers: auth.headers });
			if (response.ok) {
				reply.status(200);
				reply.header('Content-Type', 'text/vtt; charset=utf-8');
				reply.header('Cache-Control', 'public, max-age=3600');
				const body = Buffer.from(await response.arrayBuffer());
				return reply.send(body);
			}
		}

		return reply.status(404).send({ message: 'Subtitle not found on remote server' });
	}

	/**
	 * GET /remote/stream/:serverId/:sessionId/:segmentFile — Proxy HLS segment.
	 */
	@Get('stream/:serverId/:sessionId/:segmentFile')
	async proxySegment(
		@Param('serverId') serverId: string,
		@Param('sessionId') sessionId: string,
		@Param('segmentFile') segmentFile: string,
		@Res() reply: FastifyReply,
	) {
		const auth = this.remoteService.getServerAuth(serverId);
		if (!auth) throw new NotFoundException('Server not found');

		const response = await fetch(
			`${auth.baseUrl}/api/v1/shared/stream/${sessionId}/${segmentFile}`,
			{ headers: auth.headers },
		);

		reply.status(response.status);
		for (const [key, value] of response.headers.entries()) {
			if (['content-type', 'cache-control'].includes(key.toLowerCase())) {
				reply.header(key, value);
			}
		}

		const body = Buffer.from(await response.arrayBuffer());
		return reply.send(body);
	}
}
