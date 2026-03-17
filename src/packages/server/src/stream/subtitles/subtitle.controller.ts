import { readFile, stat } from 'node:fs/promises';
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { FastifyReply } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, streamSessions } from '../../database/schema/index.js';
import { SubtitleService } from './subtitle.service.js';

@Controller('stream')
export class SubtitleController {
	constructor(
		private readonly subtitleService: SubtitleService,
		private readonly db: DatabaseService,
	) {}

	/**
	 * Serve a WebVTT subtitle file for a given stream session and track index.
	 */
	@Get(':sessionId/subtitles/:trackIndex.vtt')
	async getSubtitle(
		@Param('sessionId') sessionId: string,
		@Param('trackIndex') trackIndex: string,
		@Res() reply: FastifyReply,
	) {
		const trackIdx = parseInt(trackIndex, 10);
		if (Number.isNaN(trackIdx) || trackIdx < 0) {
			throw new NotFoundException(`Invalid track index: ${trackIndex}`);
		}

		// Try session lookup first (standard streams)
		const session = this.db.db
			.select()
			.from(streamSessions)
			.where(eq(streamSessions.id, sessionId))
			.get();

		let fileId: string | undefined;

		if (session?.movieFileId) {
			fileId = session.movieFileId;
		} else {
			// Session not in DB (shared/anonymous streams skip DB insert).
			// Fall back: check if the sessionId matches a movie file ID directly,
			// or look up the most recent file for the movie.
			const file = this.db.db
				.select()
				.from(movieFiles)
				.where(eq(movieFiles.id, sessionId))
				.get();
			if (file) {
				fileId = file.id;
			}
		}

		if (!fileId) {
			throw new NotFoundException(`Stream session ${sessionId} not found`);
		}

		return this.serveVtt(reply, fileId, trackIdx);
	}

	private async serveVtt(reply: FastifyReply, fileId: string, trackIdx: number) {
		const subtitlePath = this.subtitleService.getSubtitleFile(fileId, trackIdx);

		try {
			await stat(subtitlePath);
		} catch {
			throw new NotFoundException(`Subtitle track ${trackIdx} not found`);
		}

		const content = await readFile(subtitlePath);

		return reply
			.header('Content-Type', 'text/vtt; charset=utf-8')
			.header('Cache-Control', 'public, max-age=86400')
			.send(content);
	}
}
