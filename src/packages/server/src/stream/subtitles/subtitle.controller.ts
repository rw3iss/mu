import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { SubtitleService } from './subtitle.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { streamSessions } from '../../database/schema/index.js';

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
		// Look up the session to find the associated file ID
		const sessions = await this.db.db
			.select()
			.from(streamSessions)
			.where(eq(streamSessions.id, sessionId));

		if (sessions.length === 0) {
			throw new NotFoundException(`Stream session ${sessionId} not found`);
		}

		const session = sessions[0]!;
		const trackIdx = parseInt(trackIndex, 10);

		if (Number.isNaN(trackIdx) || trackIdx < 0) {
			throw new NotFoundException(`Invalid track index: ${trackIndex}`);
		}

		const subtitlePath = this.subtitleService.getSubtitleFile(session.movieFileId!, trackIdx);

		// Verify the file exists
		try {
			await stat(subtitlePath);
		} catch {
			throw new NotFoundException(
				`Subtitle track ${trackIdx} not found for session ${sessionId}`,
			);
		}

		const content = await readFile(subtitlePath);

		return reply
			.header('Content-Type', 'text/vtt; charset=utf-8')
			.header('Cache-Control', 'public, max-age=86400')
			.send(content);
	}
}
