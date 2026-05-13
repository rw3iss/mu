import { execSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { count, sql } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies } from '../database/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';

@Injectable()
export class ServerService {
	constructor(
		readonly _config: ConfigService,
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
		private readonly transcoder: TranscoderService,
	) {}

	/**
	 * Whether this server is being supervised by NSSM.
	 * Used by the in-app Restart endpoint so it can call `nssm restart`
	 * instead of spawning a parallel `nohup node` instance that NSSM
	 * doesn't track.
	 */
	isNssmManaged(): boolean {
		if (process.platform !== 'win32') return false;
		try {
			execSync('nssm status mu-server', { stdio: 'ignore', timeout: 2000 });
			return true;
		} catch {
			return false;
		}
	}

	async getServerInfo() {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const hwAccelBroken = this.settings.get<boolean>('hwAccelBroken', false);
		const hwAccelBrokenSince = this.settings.get<string | null>('hwAccelBrokenSince', null);
		const hwAccelBrokenReason = this.settings.get<string | null>('hwAccelBrokenReason', null);

		return {
			uptime: process.uptime(),
			nodeVersion: process.version,
			platform: process.platform,
			arch: process.arch,
			hostname: os.hostname(),
			cpuModel: os.cpus()[0]?.model || 'Unknown',
			cpuCores: os.cpus().length,
			totalMemory: os.totalmem(),
			freeMemory: os.freemem(),
			processMemory: process.memoryUsage(),
			pid: process.pid,
			serverVersion: '0.1.0',
			hwAccel: enc?.hwAccel || 'none',
			hwAccelBroken,
			hwAccelBrokenSince,
			hwAccelBrokenReason,
			encoding: {
				preset: enc?.preset || 'veryfast',
				quality: enc?.quality || '1080p',
				rateControl: enc?.rateControl || 'cbr',
				maxConcurrentJobs: enc?.maxConcurrentJobs ?? 4,
				useChunkedTranscoding: enc?.useChunkedTranscoding === true,
				debugTranscoding: enc?.debugTranscoding === true,
			},
			gpu: this.getGpuInfo(),
			activeTranscodes: this.transcoder.getActiveTranscodeCount(),
		};
	}

	async getStats() {
		const mem = process.memoryUsage();

		// Library stats
		const movieCount = this.database.db.select({ count: count() }).from(movies).get();
		const fileCount = this.database.db.select({ count: count() }).from(movieFiles).get();
		const totalFileSize = this.database.db
			.select({ total: sql<number>`COALESCE(SUM(${movieFiles.fileSize}), 0)` })
			.from(movieFiles)
			.get();

		return {
			cpu: {
				cores: os.cpus().length,
				model: os.cpus()[0]?.model || 'Unknown',
				loadAvg: os.loadavg(),
			},
			memory: {
				app: {
					rss: mem.rss,
					heapUsed: mem.heapUsed,
					heapTotal: mem.heapTotal,
				},
				system: {
					total: os.totalmem(),
					free: os.freemem(),
					used: os.totalmem() - os.freemem(),
					usedPercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
				},
			},
			library: {
				movieCount: movieCount?.count ?? 0,
				fileCount: fileCount?.count ?? 0,
				totalFileSize: totalFileSize?.total ?? 0,
			},
			streaming: {
				activeTranscodes: this.transcoder.getActiveTranscodeCount(),
			},
		};
	}

	resetHwAccelBroken(): void {
		this.transcoder.resetHwAccelBroken();
	}

	recycleHwAccel() {
		return this.transcoder.recycleHwAccel();
	}

	getServerLogs(
		lines = 200,
		file = 'server',
	): { content: string; path: string; sizeBytes: number } {
		// Anchor to PROJECT_ROOT (matches database.service.ts) so cwd
		// drift doesn't send us looking for the wrong file.
		const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
		const logDir = path.resolve(projectRoot, 'data', 'logs');
		const fileName = file === 'transcode-debug' ? 'transcode-debug.log' : 'server.log';
		const logPath = path.join(logDir, fileName);

		if (!existsSync(logPath)) {
			return { content: '', path: logPath, sizeBytes: 0 };
		}

		const stat = statSync(logPath);
		const content = tailFile(logPath, lines, stat.size);
		return {
			content,
			path: logPath,
			sizeBytes: stat.size,
		};
	}

	private getGpuInfo(): Record<string, string> | null {
		try {
			const cmd =
				process.platform === 'win32'
					? 'nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits'
					: 'nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null';

			const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
			if (!output) return null;

			const parts = output.split(',').map((s) => s.trim());
			if (parts.length < 5) return null;

			return {
				name: parts[0]!,
				driver: parts[1]!,
				memoryTotal: `${parts[2]} MiB`,
				memoryUsed: `${parts[3]} MiB`,
				utilization: `${parts[4]}%`,
			};
		} catch {
			return null;
		}
	}
}

/**
 * Stream-tail the last N lines of a file without reading the whole
 * thing. Reads 64 KB chunks from the tail until we have enough
 * newlines or hit the start of the file. Keeps memory bounded so a
 * multi-gigabyte log doesn't OOM the server.
 */
function tailFile(filePath: string, lines: number, fileSize: number): string {
	if (fileSize === 0) return '';
	const CHUNK = 64 * 1024;
	const fd = openSync(filePath, 'r');
	try {
		const buf = Buffer.alloc(CHUNK);
		let position = fileSize;
		let collected = '';
		let newlines = 0;
		while (position > 0 && newlines <= lines) {
			const readBytes = Math.min(CHUNK, position);
			position -= readBytes;
			readSync(fd, buf, 0, readBytes, position);
			const chunk = buf.subarray(0, readBytes).toString('utf-8');
			collected = chunk + collected;
			for (let i = 0; i < chunk.length; i++) {
				if (chunk.charCodeAt(i) === 10) newlines++;
			}
		}
		const allLines = collected.split('\n');
		return allLines.slice(-lines).join('\n');
	} finally {
		closeSync(fd);
	}
}
