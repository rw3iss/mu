import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { nowISO } from '@mu/shared';
import { Controller, Get, type OnModuleInit, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ConfigService } from '../config/config.service.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { StreamService } from '../stream/stream.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';

const execFileAsync = promisify(execFile);

interface DiskStats {
	diskTotal: number;
	diskFree: number;
}

/** TTLs: how long a cached value is considered "fresh". After expiry,
 *  callers still get the stale value immediately while a background
 *  refresh runs — never blocks the request. */
const DISK_CACHE_TTL_MS = 30_000;
const DATA_DIR_CACHE_TTL_MS = 5 * 60_000; // 5 min — the scan is expensive

@Controller('health')
export class HealthController implements OnModuleInit {
	private readonly logger = new Logger('HealthStats');
	private diskCache: { data: DiskStats; expiresAt: number } | null = null;
	private dataDirCache: { size: number; expiresAt: number } | null = null;
	private diskRefreshInFlight = false;
	private dataDirRefreshInFlight = false;

	constructor(
		private readonly streamService: StreamService,
		private readonly transcoderService: TranscoderService,
		private readonly jobManager: JobManagerService,
		private readonly config: ConfigService,
	) {}

	/**
	 * Pre-warm the expensive caches at boot so the first user-facing
	 * `/health/stats` request never blocks. Without this, the first
	 * page-open after a server restart waits for a multi-GB data-dir
	 * scan to complete before the spinner clears.
	 */
	onModuleInit(): void {
		void this.refreshDataDirSize();
		void this.refreshDiskStats();
	}

	@Get()
	@Public()
	check() {
		return {
			status: 'ok',
			uptime: process.uptime(),
			version: '0.1.0',
			timestamp: nowISO(),
		};
	}

	@Get('stats')
	@Roles('admin')
	@RequireAction('admin:server')
	async getStats() {
		const cpus = os.cpus();
		// All synchronous reads — neither getDiskStats nor getDataDirSize
		// blocks: each returns its cached value and kicks off a background
		// refresh if expired. getActiveSessions + getAppMemory are fast.
		const [sessions, appMemory] = await Promise.all([
			this.streamService.getActiveSessions(),
			this.getAppMemory(),
		]);
		const disk = this.getDiskStatsCached();
		const dataDirSize = this.getDataDirSizeCached();
		return {
			system: {
				cpuCount: cpus.length,
				loadAvg: os.loadavg(),
				memoryUsed: process.memoryUsage.rss(),
				memoryTotal: os.totalmem(),
				memoryFree: os.freemem(),
				appMemory,
				diskTotal: disk?.diskTotal ?? null,
				diskFree: disk?.diskFree ?? null,
				dataDirSize, // null while the very first scan is still running
				uptime: process.uptime(),
				platform: os.platform(),
			},
			services: {
				activeStreams: sessions.length,
				activeTranscodes: this.transcoderService.getActiveTranscodeCount(),
				runningJobs: this.jobManager.listJobs({ status: 'running' }).length,
				pendingJobs: this.jobManager.listJobs({ status: 'pending' }).length,
			},
		};
	}

	/**
	 * Stale-while-revalidate: returns the last cached value synchronously
	 * and schedules a background refresh if expired. `null` only on the
	 * very first call before the pre-warm in {@link onModuleInit} completes.
	 */
	private getDiskStatsCached(): DiskStats | null {
		const now = Date.now();
		const cached = this.diskCache;
		if (!cached || now >= cached.expiresAt) {
			void this.refreshDiskStats();
		}
		return cached?.data ?? null;
	}

	private async refreshDiskStats(): Promise<void> {
		if (this.diskRefreshInFlight) return;
		this.diskRefreshInFlight = true;
		try {
			const data = await this.queryDisk();
			this.diskCache = { data, expiresAt: Date.now() + DISK_CACHE_TTL_MS };
		} catch (err) {
			this.logger.warn(`disk stats refresh failed: ${(err as Error).message}`);
		} finally {
			this.diskRefreshInFlight = false;
		}
	}

	private async queryDisk(): Promise<DiskStats> {
		// Try Node's built-in statfs first (works on all platforms, Node 18.15+)
		try {
			const stats = await fs.statfs(os.platform() === 'win32' ? 'C:\\' : '/');
			return {
				diskTotal: stats.bsize * stats.blocks,
				diskFree: stats.bsize * stats.bavail,
			};
		} catch {
			// statfs not available, fall back to platform commands
		}

		const platform = os.platform();

		if (platform === 'win32') {
			// PowerShell: get root drive free/total in bytes
			try {
				const { stdout } = await execFileAsync('powershell', [
					'-NoProfile',
					'-Command',
					'Get-PSDrive C | Select-Object -ExpandProperty Free; Get-PSDrive C | Select-Object -ExpandProperty Used',
				]);
				const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
				const free = parseInt(lines[0] ?? '0', 10) || 0;
				const used = parseInt(lines[1] ?? '0', 10) || 0;
				return { diskTotal: free + used, diskFree: free };
			} catch {
				// PowerShell unavailable, return zeros
				return { diskTotal: 0, diskFree: 0 };
			}
		}

		// Unix/macOS: df for the root filesystem, output in 1K blocks
		const { stdout } = await execFileAsync('df', ['-k', '/']);
		const lines = stdout.trim().split('\n');
		if (lines.length < 2) return { diskTotal: 0, diskFree: 0 };
		const dataLine = lines[1] ?? '';
		const cols = dataLine.split(/\s+/);
		// df -k columns: Filesystem 1K-blocks Used Available Use% Mounted
		const totalKb = parseInt(cols[1] ?? '0', 10) || 0;
		const availKb = parseInt(cols[3] ?? '0', 10) || 0;
		return {
			diskTotal: totalKb * 1024,
			diskFree: availKb * 1024,
		};
	}

	/**
	 * Same stale-while-revalidate pattern as {@link getDiskStatsCached},
	 * but for the (much more expensive) data-dir size. On a populated
	 * install the recursive scan walks the entire data dir — including
	 * the SQLite DB, logs, and `transcode_cache` (10s of GB after a few
	 * watched movies). Pre-warmed at boot; subsequent calls return the
	 * cached value in microseconds.
	 */
	private getDataDirSizeCached(): number | null {
		const now = Date.now();
		const cached = this.dataDirCache;
		if (!cached || now >= cached.expiresAt) {
			void this.refreshDataDirSize();
		}
		return cached?.size ?? null;
	}

	private async refreshDataDirSize(): Promise<void> {
		if (this.dataDirRefreshInFlight) return;
		this.dataDirRefreshInFlight = true;
		const startedMs = Date.now();
		try {
			const dataDir = this.config.get<string>('dataDir', './data');
			const size = await this.dirSize(dataDir);
			this.dataDirCache = { size, expiresAt: Date.now() + DATA_DIR_CACHE_TTL_MS };
			this.logger.debug(
				`data-dir scan: ${(size / 1e9).toFixed(2)} GB in ${Date.now() - startedMs}ms`,
			);
		} catch (err) {
			this.logger.warn(`data-dir scan failed: ${(err as Error).message}`);
		} finally {
			this.dataDirRefreshInFlight = false;
		}
	}

	/**
	 * Get memory usage for this process and its tracked child processes.
	 * On Linux reads /proc/<pid>/statm; falls back to main RSS only.
	 */
	private async getAppMemory(): Promise<{ main: number; children: number; total: number }> {
		const mainRss = process.memoryUsage.rss();
		const childPids = this.transcoderService.getChildPids();
		let childrenRss = 0;

		if (os.platform() === 'linux') {
			const PAGE_SIZE = 4096;
			const results = await Promise.all(
				childPids.map(async (pid) => {
					try {
						const statm = await fs.readFile(`/proc/${pid}/statm`, 'utf8');
						// statm fields: size resident shared text lib data dt (in pages)
						const resident = parseInt(statm.split(' ')[1] ?? '0', 10) || 0;
						return resident * PAGE_SIZE;
					} catch {
						return 0; // process may have exited
					}
				}),
			);
			childrenRss = results.reduce((sum, v) => sum + v, 0);
		}

		return { main: mainRss, children: childrenRss, total: mainRss + childrenRss };
	}

	/** Recursively sum file sizes in a directory. */
	private async dirSize(dir: string): Promise<number> {
		let total = 0;
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return 0;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				total += await this.dirSize(full);
			} else if (entry.isFile()) {
				try {
					const stat = await fs.stat(full);
					total += stat.size;
				} catch {
					// skip inaccessible files
				}
			}
		}
		return total;
	}
}
