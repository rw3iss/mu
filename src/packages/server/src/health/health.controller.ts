import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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
import { LibraryService } from '../library/library.service.js';
import { StreamService } from '../stream/stream.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';

const execFileAsync = promisify(execFile);

interface DiskStats {
	diskTotal: number;
	diskFree: number;
}

/** Per-drive disk info returned in /health/stats. One entry per distinct
 *  drive root across (a) the app data dir and (b) every configured media
 *  source path. */
export interface DiskInfo {
	/** Canonical drive root used as the cache key. Windows: `C:\`. Unix: `/`. */
	root: string;
	/** Short display label. Windows: `C:`. Unix: `/`. */
	label: string;
	total: number | null;
	free: number | null;
	/** True if the app's `dataDir` lives on this drive. */
	isAppDrive: boolean;
	/** Bytes used by the app data dir — only populated for the app drive. */
	appUsedBytes: number | null;
	/** True if the cache root (`cache.dir`) lives on this drive. */
	isCacheDrive: boolean;
	/** Bytes used by the cache root — only populated for the cache drive
	 *  (and only when it isn't inside the data dir, which would double-count). */
	cacheUsedBytes: number | null;
	/** Sum of media_sources.total_size_bytes for sources on this drive.
	 *  Free signal — scanner tracks it per source at scan time. */
	mediaUsedBytes: number;
	/** Media source paths grouped on this drive, for the hover tooltip. */
	mediaSourcePaths: string[];
}

/** TTLs: how long a cached value is considered "fresh". After expiry,
 *  callers still get the stale value immediately while a background
 *  refresh runs — never blocks the request. */
const DISK_CACHE_TTL_MS = 30_000;
const DATA_DIR_CACHE_TTL_MS = 5 * 60_000; // 5 min — the scan is expensive

/**
 * Extract the canonical drive root from an absolute path. Used to
 * group paths by physical drive so we can show one bar per disk.
 *
 * Windows variants we have to handle (Mu's prod is Windows + Git Bash):
 *   - "C:\Users\rw3is\Movies"  → "C:\"
 *   - "C:/Users/rw3is/Movies"  → "C:\"
 *   - "/c/Users/rw3is/Movies"  → "C:\"   (Git Bash-style)
 *   - "\\\\server\\share\\..."   → "\\\\server\\share\\"  (UNC)
 *
 * Anything we don't recognise (or Unix paths) falls back to "/".
 */
function getDriveRoot(p: string): string {
	if (os.platform() === 'win32') {
		const winLetter = p.match(/^([a-zA-Z]):[\\/]?/)?.[1];
		if (winLetter) return `${winLetter.toUpperCase()}:\\`;
		const gitBashLetter = p.match(/^\/([a-zA-Z])(?:\/|$)/)?.[1];
		if (gitBashLetter) return `${gitBashLetter.toUpperCase()}:\\`;
		const uncMatch = p.match(/^\\\\([^\\]+)\\([^\\]+)/);
		if (uncMatch?.[1] && uncMatch?.[2]) return `\\\\${uncMatch[1]}\\${uncMatch[2]}\\`;
	}
	return unixMountRoot(p);
}

/**
 * Resolve the MOUNT POINT containing `p` on Unix by walking up until the
 * parent directory lives on a different device (st_dev changes). This is
 * what lets each media drive (e.g. /run/media/<user>/Media-1) surface as
 * its own disk instead of collapsing into `/`.
 */
function unixMountRoot(p: string): string {
	try {
		let cur = path.resolve(p);
		// If the path itself is missing (unmounted drive), walk up to the
		// nearest existing ancestor first.
		while (!fsSync.existsSync(cur)) {
			const up = path.dirname(cur);
			if (up === cur) return '/';
			cur = up;
		}
		const dev = fsSync.statSync(cur).dev;
		for (;;) {
			const parent = path.dirname(cur);
			if (parent === cur) return cur; // reached '/'
			if (fsSync.statSync(parent).dev !== dev) return cur;
			cur = parent;
		}
	} catch {
		return '/';
	}
}

/** Short user-facing label for a drive root. "C:\" → "C:" / "/" → "/". */
function driveLabel(root: string): string {
	const winLetter = root.match(/^([a-zA-Z]):/)?.[1];
	if (winLetter) return `${winLetter.toUpperCase()}:`;
	if (root === '/') return '/';
	// Mount points read best as their leaf name ("Media-1").
	return path.basename(root) || root;
}

@Controller('health')
export class HealthController implements OnModuleInit {
	private readonly logger = new Logger('HealthStats');
	/** Per-drive disk cache keyed by canonical root (e.g. `C:\` / `D:\` / `/`). */
	private diskCache = new Map<string, { data: DiskStats; expiresAt: number }>();
	private dataDirCache: { size: number; expiresAt: number } | null = null;
	private cacheDirCache: { size: number; expiresAt: number } | null = null;
	private cacheDirRefreshInFlight = false;
	/** In-flight guard per drive root so we don't queue duplicate refreshes. */
	private diskRefreshInFlight = new Set<string>();
	private dataDirRefreshInFlight = false;

	constructor(
		private readonly streamService: StreamService,
		private readonly transcoderService: TranscoderService,
		private readonly jobManager: JobManagerService,
		private readonly config: ConfigService,
		private readonly library: LibraryService,
	) {}

	/**
	 * Pre-warm the expensive caches at boot so the first user-facing
	 * `/health/stats` request never blocks. Without this, the first
	 * page-open after a server restart waits for a multi-GB data-dir
	 * scan to complete before the spinner clears.
	 */
	onModuleInit(): void {
		void this.refreshDataDirSize();
		void this.refreshCacheDirSize();
		// Pre-warm disk stats for every drive we expect to surface
		// (app drive + each media source drive). Fires async — each
		// drive gets its own statfs in parallel.
		try {
			const roots = this.getRelevantDriveRoots();
			for (const r of roots) {
				void this.refreshDiskStats(r.root);
			}
		} catch (err) {
			this.logger.warn(`disk pre-warm failed: ${(err as Error).message}`);
		}
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
		const dataDirSize = this.getDataDirSizeCached();
		const disks = this.getDisksCached(dataDirSize);
		// Backward-compat singletons (the app drive's numbers). Older
		// consumers in the codebase still reference these — kept so a
		// missed call-site doesn't break.
		const appDisk = disks.find((d) => d.isAppDrive) ?? null;
		return {
			system: {
				cpuCount: cpus.length,
				loadAvg: os.loadavg(),
				memoryUsed: process.memoryUsage.rss(),
				memoryTotal: os.totalmem(),
				memoryFree: os.freemem(),
				appMemory,
				disks,
				diskTotal: appDisk?.total ?? null,
				diskFree: appDisk?.free ?? null,
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
	 * Build the per-drive disk list:
	 *   1. Enumerate distinct drive roots across the app data dir + every
	 *      configured media source path.
	 *   2. For each, read SWR-cached disk total/free (kicks a background
	 *      refresh if stale).
	 *   3. Attach app-used (only on the app drive) and media-used (sum of
	 *      media_sources.totalSizeBytes per drive) for the hover tooltip.
	 */
	private getDisksCached(dataDirSize: number | null): DiskInfo[] {
		const sources = this.safelyGetSources();
		const dataDir = this.config.get<string>('dataDir', './data');
		const appRoot = getDriveRoot(dataDir);
		// Group media sources by their drive root.
		const byRoot = new Map<string, { paths: string[]; mediaUsed: number }>();
		for (const s of sources) {
			if (!s.path) continue;
			const root = getDriveRoot(s.path);
			const bucket = byRoot.get(root) ?? { paths: [], mediaUsed: 0 };
			bucket.paths.push(s.path);
			bucket.mediaUsed += s.totalSizeBytes ?? 0;
			byRoot.set(root, bucket);
		}
		// Always include the app drive even if no media sources live on it.
		if (!byRoot.has(appRoot)) byRoot.set(appRoot, { paths: [], mediaUsed: 0 });
		// And the cache drive (e.g. an NVMe cache.dir on its own disk).
		const cacheDir = this.getCacheDir();
		const cacheRoot = cacheDir ? getDriveRoot(cacheDir) : null;
		if (cacheRoot && !byRoot.has(cacheRoot)) {
			byRoot.set(cacheRoot, { paths: [], mediaUsed: 0 });
		}
		const cacheUsed = this.cacheInsideDataDir() ? null : this.getCacheDirSizeCached();

		const disks: DiskInfo[] = [];
		for (const [root, bucket] of byRoot.entries()) {
			const cached = this.getDiskStatsForRoot(root);
			const isAppDrive = root === appRoot;
			const isCacheDrive = root === cacheRoot;
			disks.push({
				root,
				label: driveLabel(root),
				total: cached?.diskTotal ?? null,
				free: cached?.diskFree ?? null,
				isAppDrive,
				appUsedBytes: isAppDrive ? dataDirSize : null,
				isCacheDrive,
				cacheUsedBytes: isCacheDrive ? cacheUsed : null,
				mediaUsedBytes: bucket.mediaUsed,
				mediaSourcePaths: bucket.paths,
			});
		}
		// Stable order: app drive first, then by label ascending.
		disks.sort((a, b) => {
			if (a.isAppDrive !== b.isAppDrive) return a.isAppDrive ? -1 : 1;
			return a.label.localeCompare(b.label);
		});
		return disks;
	}

	private safelyGetSources(): Array<{ path: string; totalSizeBytes: number | null }> {
		try {
			return this.library.getSources().map((s) => ({
				path: s.path,
				totalSizeBytes: s.totalSizeBytes ?? 0,
			}));
		} catch (err) {
			this.logger.warn(`media source enumeration failed: ${(err as Error).message}`);
			return [];
		}
	}

	/** SWR per-drive cache. Returns last value immediately; refresh in bg. */
	private getDiskStatsForRoot(root: string): DiskStats | null {
		const cached = this.diskCache.get(root);
		if (!cached || Date.now() >= cached.expiresAt) {
			void this.refreshDiskStats(root);
		}
		return cached?.data ?? null;
	}

	private async refreshDiskStats(root: string): Promise<void> {
		if (this.diskRefreshInFlight.has(root)) return;
		this.diskRefreshInFlight.add(root);
		try {
			const data = await this.queryDiskForRoot(root);
			this.diskCache.set(root, { data, expiresAt: Date.now() + DISK_CACHE_TTL_MS });
		} catch (err) {
			this.logger.warn(`disk stats refresh failed for ${root}: ${(err as Error).message}`);
		} finally {
			this.diskRefreshInFlight.delete(root);
		}
	}

	/** Enumerate the drive roots /health/stats should surface:
	 *  app data dir + cache root + every configured media source. */
	private getRelevantDriveRoots(): Array<{ root: string }> {
		const dataDir = this.config.get<string>('dataDir', './data');
		const roots = new Set<string>([getDriveRoot(dataDir)]);
		const cacheDir = this.getCacheDir();
		if (cacheDir) roots.add(getDriveRoot(cacheDir));
		for (const s of this.safelyGetSources()) {
			if (s.path) roots.add(getDriveRoot(s.path));
		}
		return [...roots].map((root) => ({ root }));
	}

	private getCacheDir(): string | null {
		return this.config.get<string>('cache.dir', '') || null;
	}

	/** True when the cache root lives inside the data dir (default layout) —
	 *  its bytes are already counted by the data-dir scan. */
	private cacheInsideDataDir(): boolean {
		const cacheDir = this.getCacheDir();
		if (!cacheDir) return true;
		const dataDir = this.config.get<string>('dataDir', './data');
		return cacheDir.startsWith(dataDir);
	}

	private getCacheDirSizeCached(): number | null {
		const now = Date.now();
		const cached = this.cacheDirCache;
		if (!cached || now >= cached.expiresAt) {
			void this.refreshCacheDirSize();
		}
		return cached?.size ?? null;
	}

	private async refreshCacheDirSize(): Promise<void> {
		if (this.cacheDirRefreshInFlight) return;
		const cacheDir = this.getCacheDir();
		if (!cacheDir || this.cacheInsideDataDir()) return;
		this.cacheDirRefreshInFlight = true;
		try {
			const size = await this.dirSize(cacheDir);
			this.cacheDirCache = { size, expiresAt: Date.now() + DATA_DIR_CACHE_TTL_MS };
		} catch (err) {
			this.logger.warn(`cache-dir scan failed: ${(err as Error).message}`);
		} finally {
			this.cacheDirRefreshInFlight = false;
		}
	}

	private async queryDiskForRoot(root: string): Promise<DiskStats> {
		// Try Node's built-in statfs first (works on all platforms, Node 18.15+).
		// Pass the drive root so it reports stats for THAT filesystem, not
		// just `/` / `C:\`.
		try {
			const stats = await fs.statfs(root);
			return {
				diskTotal: stats.bsize * stats.blocks,
				diskFree: stats.bsize * stats.bavail,
			};
		} catch {
			// statfs unavailable for this path (Windows UNC, network drive,
			// missing volume) — fall back to platform-specific commands.
		}

		const platform = os.platform();
		if (platform === 'win32') {
			// Get-PSDrive uses the bare letter (no colon / slash).
			const letter = root.match(/^([a-zA-Z]):/)?.[1];
			if (!letter) return { diskTotal: 0, diskFree: 0 };
			try {
				const { stdout } = await execFileAsync('powershell', [
					'-NoProfile',
					'-Command',
					`Get-PSDrive ${letter} | Select-Object -ExpandProperty Free; Get-PSDrive ${letter} | Select-Object -ExpandProperty Used`,
				]);
				const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
				const free = parseInt(lines[0] ?? '0', 10) || 0;
				const used = parseInt(lines[1] ?? '0', 10) || 0;
				return { diskTotal: free + used, diskFree: free };
			} catch {
				return { diskTotal: 0, diskFree: 0 };
			}
		}

		// Unix/macOS: df for the specific path's filesystem.
		const { stdout } = await execFileAsync('df', ['-k', root]);
		const lines = stdout.trim().split('\n');
		if (lines.length < 2) return { diskTotal: 0, diskFree: 0 };
		const cols = (lines[1] ?? '').split(/\s+/);
		const totalKb = parseInt(cols[1] ?? '0', 10) || 0;
		const availKb = parseInt(cols[3] ?? '0', 10) || 0;
		return { diskTotal: totalKb * 1024, diskFree: availKb * 1024 };
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
