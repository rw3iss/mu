import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Controller, Get, Logger, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../common/decorators/public.decorator.js';
import { ConfigService } from '../config/config.service.js';

/** Log file aliases that the endpoint exposes. */
const LOG_SOURCES: Record<string, string> = {
	server: 'server.log',
	'nssm-stdout': 'nssm-stdout.log',
	'nssm-stderr': 'nssm-stderr.log',
};

const MAX_LINES = 5000;
const DEFAULT_LINES = 500;

interface TailQuery {
	source?: string;
	lines?: string;
}

interface TailResponse {
	source: string;
	path: string;
	totalBytes: number;
	returnedBytes: number;
	returnedLines: number;
	truncated: boolean;
	content: string;
}

/**
 * Minimal log-tail endpoint for unattended debugging agents (scheduled
 * remote routines). Bypasses the JWT guard via @Public and instead
 * authenticates an opaque bearer-style header against an API token
 * configured under `auth.apiToken` (or `MU_AUTH_API_TOKEN`).
 *
 * Returns the *tail* of the chosen log file — the agent reads only the
 * recent window, so we don't ship multi-GB logs over the wire.
 */
@Controller('admin/logs')
export class LogsController {
	private readonly logger = new Logger('LogsController');

	constructor(private readonly config: ConfigService) {}

	@Public()
	@Get('tail')
	async tail(@Req() req: FastifyRequest, @Query() query: TailQuery): Promise<TailResponse> {
		this.authenticate(req);

		const sourceKey = (query.source ?? 'server').trim();
		const fileName = LOG_SOURCES[sourceKey];
		if (!fileName) {
			throw new UnauthorizedException(
				`Unknown log source: ${sourceKey}. Allowed: ${Object.keys(LOG_SOURCES).join(', ')}`,
			);
		}

		const requestedLines = Math.min(
			MAX_LINES,
			Math.max(1, parseInt(query.lines ?? String(DEFAULT_LINES), 10) || DEFAULT_LINES),
		);

		const dataDir = this.config.get<string>('dataDir', './data');
		const logsDirOverride = this.config.get<string>('logs.dir', '') || null;
		const logsDir = logsDirOverride ?? path.resolve(dataDir, 'logs');
		const filePath = path.resolve(logsDir, fileName);

		try {
			const stat = await fs.stat(filePath);
			const totalBytes = stat.size;
			// Heuristic: assume each line ≤ 4KB. Pull (lines * 4KB) bytes from
			// the tail of the file; if the file is smaller, read it whole. We
			// don't slurp the entire log unless it really is small.
			const readBytes = Math.min(totalBytes, requestedLines * 4096);
			const handle = await fs.open(filePath, 'r');
			try {
				const buf = Buffer.alloc(readBytes);
				const startPos = Math.max(0, totalBytes - readBytes);
				await handle.read(buf, 0, readBytes, startPos);
				let chunk = buf.toString('utf8');
				// Drop the (likely partial) first line when we didn't start at 0.
				if (startPos > 0) {
					const nl = chunk.indexOf('\n');
					if (nl !== -1) chunk = chunk.slice(nl + 1);
				}
				const allLines = chunk.split('\n');
				const tail = allLines.slice(-requestedLines);
				const content = tail.join('\n');
				return {
					source: sourceKey,
					path: filePath,
					totalBytes,
					returnedBytes: Buffer.byteLength(content, 'utf8'),
					returnedLines: tail.length,
					truncated: totalBytes > readBytes,
					content,
				};
			} finally {
				await handle.close();
			}
		} catch (err: any) {
			if (err?.code === 'ENOENT') {
				return {
					source: sourceKey,
					path: filePath,
					totalBytes: 0,
					returnedBytes: 0,
					returnedLines: 0,
					truncated: false,
					content: '',
				};
			}
			this.logger.error(`Failed to read log ${filePath}: ${err.message}`);
			throw err;
		}
	}

	/**
	 * Lightweight inventory endpoint so the agent can discover what
	 * sources exist + their sizes without slurping any content.
	 */
	@Public()
	@Get('list')
	async list(@Req() req: FastifyRequest) {
		this.authenticate(req);
		const dataDir = this.config.get<string>('dataDir', './data');
		const logsDirOverride = this.config.get<string>('logs.dir', '') || null;
		const dir = logsDirOverride ?? path.resolve(dataDir, 'logs');
		const sources: Array<{ key: string; fileName: string; bytes: number; exists: boolean }> = [];
		for (const [key, fileName] of Object.entries(LOG_SOURCES)) {
			const p = path.resolve(dir, fileName);
			try {
				const stat = await fs.stat(p);
				sources.push({ key, fileName, bytes: stat.size, exists: true });
			} catch {
				sources.push({ key, fileName, bytes: 0, exists: false });
			}
		}
		return { sources };
	}

	private authenticate(req: FastifyRequest): void {
		const configured = this.config.get<string>('auth.apiToken', '') || null;
		if (!configured) {
			throw new UnauthorizedException(
				'Logs API not enabled — set auth.apiToken (or MU_AUTH_API_TOKEN) on the server.',
			);
		}
		const header = (req.headers['x-mu-api-token'] ?? req.headers['authorization']) as
			| string
			| undefined;
		if (!header) {
			throw new UnauthorizedException('Missing X-Mu-Api-Token header');
		}
		const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
		// Constant-time compare — avoid timing-leak side channels even
		// for a low-value internal token.
		if (!timingSafeEqual(supplied, configured)) {
			throw new UnauthorizedException('Invalid API token');
		}
	}
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}
