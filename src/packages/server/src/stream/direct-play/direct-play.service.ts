import { Injectable, Logger } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { FastifyRequest, FastifyReply } from 'fastify';

const MIME_TYPES: Record<string, string> = {
	'.mp4': 'video/mp4',
	'.mkv': 'video/x-matroska',
	'.webm': 'video/webm',
	'.avi': 'video/x-msvideo',
	'.mov': 'video/quicktime',
	'.m4v': 'video/mp4',
	'.ts': 'video/mp2t',
};

@Injectable()
export class DirectPlayService {
	private readonly logger = new Logger(DirectPlayService.name);

	/**
	 * Serve a video file with full HTTP range request support.
	 * Handles both full-file (200) and partial-content (206) responses.
	 */
	async serveFile(
		filePath: string,
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<FastifyReply> {
		const fileStat = await stat(filePath);
		const fileSize = fileStat.size;
		const ext = path.extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		const rangeHeader = request.headers.range;

		if (rangeHeader) {
			// Parse the Range header (e.g., "bytes=0-1023")
			const parts = rangeHeader.replace(/bytes=/, '').split('-');
			const start = parseInt(parts[0] ?? '0', 10);
			const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

			// Validate range bounds
			if (start >= fileSize || end >= fileSize || start > end) {
				return reply.status(416).header('Content-Range', `bytes */${fileSize}`).send();
			}

			const chunkSize = end - start + 1;
			const stream = createReadStream(filePath, { start, end });

			this.logger.debug(
				`Serving range ${start}-${end}/${fileSize} for ${path.basename(filePath)}`,
			);

			return reply
				.status(206)
				.header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
				.header('Accept-Ranges', 'bytes')
				.header('Content-Length', chunkSize)
				.header('Content-Type', contentType)
				.send(stream);
		}

		// No range header: serve the entire file
		this.logger.debug(`Serving full file ${path.basename(filePath)} (${fileSize} bytes)`);

		const stream = createReadStream(filePath);

		return reply
			.status(200)
			.header('Accept-Ranges', 'bytes')
			.header('Content-Length', fileSize)
			.header('Content-Type', contentType)
			.send(stream);
	}
}
