import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
	BadRequestException,
	Controller,
	Logger,
	Post,
	Query,
	Req,
	Res,
	ServiceUnavailableException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { SAFE_INPUT_OPTIONS } from '../../common/ffmpeg-input.js';
import { TranscoderService } from '../transcoder/transcoder.service.js';

/** A 5-minute snippet at the recorder's ~4.3 Mbps is ~160 MB; leave headroom. */
const MAX_CLIP_BYTES = 256 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 5 * 60_000;

/**
 * Converts a recorded player snippet (WebM from MediaRecorder on browsers that
 * can't record MP4 — Linux Chromium, Firefox) to H.264/AAC MP4, optionally
 * trimming it in the same pass. Stateless: temp files are deleted after reply.
 */
@Controller('stream/snippet')
export class SnippetController {
	private readonly logger = new Logger(SnippetController.name);
	private running = 0;

	constructor(private readonly transcoder: TranscoderService) {}

	/** Multipart `clip` file. Query `start`/`end` (seconds) trim; omit for the whole clip. */
	@RequireAction('view:library')
	@Post('mp4')
	async toMp4(
		@Req() req: FastifyRequest,
		@Res() reply: FastifyReply,
		@Query('start') startQ?: string,
		@Query('end') endQ?: string,
	) {
		const start = startQ != null ? Number(startQ) : null;
		const end = endQ != null ? Number(endQ) : null;
		if (
			(start != null && (!Number.isFinite(start) || start < 0)) ||
			(end != null && (!Number.isFinite(end) || end <= (start ?? 0)))
		) {
			throw new BadRequestException('Invalid trim range');
		}
		if (this.running >= MAX_CONCURRENT) {
			throw new ServiceUnavailableException('Converter busy — try again in a moment');
		}
		this.running++;
		const id = randomUUID();
		const inPath = join(tmpdir(), `mu-snippet-${id}.in`);
		const outPath = join(tmpdir(), `mu-snippet-${id}.mp4`);
		const cleanup = () => {
			void rm(inPath, { force: true });
			void rm(outPath, { force: true });
		};
		try {
			const part = await (req as any).file({ limits: { fileSize: MAX_CLIP_BYTES } });
			if (!part || part.fieldname !== 'clip') throw new BadRequestException('Missing clip');
			await pipeline(part.file, createWriteStream(inPath));
			if (part.file.truncated) throw new BadRequestException('Clip too large');

			await this.convert(inPath, outPath, start, end);
			const { size } = await stat(outPath);
			const stream = createReadStream(outPath);
			stream.on('close', cleanup);
			this.running--;
			return reply
				.header('Content-Type', 'video/mp4')
				.header('Content-Length', size)
				.header('Cache-Control', 'no-store')
				.send(stream);
		} catch (err) {
			this.running--;
			cleanup();
			throw err;
		}
	}

	private convert(
		inPath: string,
		outPath: string,
		start: number | null,
		end: number | null,
	): Promise<void> {
		const args = [
			'-nostdin',
			'-y',
			'-v',
			'error',
			...SAFE_INPUT_OPTIONS,
			'-i',
			`file:${inPath}`,
		];
		if (start != null && start > 0) args.push('-ss', start.toFixed(3));
		if (end != null) args.push('-to', end.toFixed(3));
		args.push(
			'-map',
			'0:v:0',
			'-map',
			'0:a:0?',
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-crf',
			'20',
			'-pix_fmt',
			'yuv420p',
			'-vf',
			'scale=trunc(iw/2)*2:trunc(ih/2)*2',
			'-c:a',
			'aac',
			'-b:a',
			'192k',
			'-movflags',
			'+faststart',
			`file:${outPath}`,
		);
		return new Promise((resolve, reject) => {
			const proc = spawn(this.transcoder.ffmpegBinary, args, {
				stdio: ['ignore', 'ignore', 'pipe'],
			});
			let errText = '';
			proc.stderr.on('data', (d) => {
				if (errText.length < 4000) errText += String(d);
			});
			const timer = setTimeout(() => proc.kill('SIGKILL'), TIMEOUT_MS);
			proc.on('error', (e) => {
				clearTimeout(timer);
				reject(e);
			});
			proc.on('close', (code) => {
				clearTimeout(timer);
				if (code === 0) return resolve();
				this.logger.warn(`Snippet conversion failed (${code}): ${errText.trim()}`);
				reject(new BadRequestException('Could not convert the clip'));
			});
		});
	}
}
