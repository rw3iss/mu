import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Build an RFC 6266 Content-Disposition value with an ASCII fallback plus a
 * UTF-8 `filename*` so accented / non-Latin movie titles download intact.
 */
function contentDisposition(name: string): string {
	const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	const encoded = encodeURIComponent(name);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

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
		opts?: { downloadName?: string },
	): Promise<FastifyReply> {
		const fileStat = await stat(filePath);
		const fileSize = fileStat.size;
		const ext = path.extname(filePath).toLowerCase();
		// Force a download dialog (attachment) with a friendly filename when a
		// downloadName is given; otherwise stream inline for in-browser playback.
		const contentType = opts?.downloadName
			? 'application/octet-stream'
			: MIME_TYPES[ext] || 'application/octet-stream';
		if (opts?.downloadName) {
			reply.header('Content-Disposition', contentDisposition(opts.downloadName));
		}

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
