import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { count, sql } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies } from '../database/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';

@Injectable()
export class ServerService {
	private readonly logger = new Logger('ServerService');

	constructor(
		private readonly config: ConfigService,
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
		private readonly transcoder: TranscoderService,
	) {}

	async getServerInfo() {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const hwAccelBroken = this.settings.get<boolean>('hwAccelBroken', false);

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

	getServerLogs(lines = 200, file = 'server'): { content: string; path: string; sizeBytes: number } {
		const logDir = path.resolve('./data/logs');
		const fileName = file === 'transcode-debug' ? 'transcode-debug.log' : 'server.log';
		const logPath = path.join(logDir, fileName);

		if (!existsSync(logPath)) {
			return { content: '', path: logPath, sizeBytes: 0 };
		}

		const stat = statSync(logPath);
		const content = readFileSync(logPath, 'utf-8');
		const allLines = content.split('\n');
		const lastLines = allLines.slice(-lines).join('\n');

		return {
			content: lastLines,
			path: logPath,
			sizeBytes: stat.size,
		};
	}

	private getGpuInfo(): Record<string, string> | null {
		try {
			const cmd = process.platform === 'win32'
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
