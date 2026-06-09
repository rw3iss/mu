import { execFile } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import os from 'node:os';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service.js';

const execFileP = promisify(execFile);

interface ResidentEntry {
	size: number;
	lastAccess: number;
}

/**
 * Page-cache residency manager. Movie files are NEVER buffered into the Node
 * heap (that would OOM the process — files are multi-GB). Instead this service
 * works WITH the OS page cache: it proactively warms a file's pages into RAM
 * (via `vmtouch -t`, which is `posix_fadvise(WILLNEED)` under the hood, or a
 * portable sequential-read fallback) on play / sprite / convert, and — bounded
 * by an admin "max cache memory" budget — evicts the least-recently-used files
 * (`vmtouch -e` = `fadvise(DONTNEED)`) so recently-used movies stay resident for
 * days while old ones are released. All cached bytes live in the kernel's
 * reclaimable page cache, so this can never crash the server.
 *
 * Disabled (no-op) until the admin sets `encoding.memoryCacheMaxGb` > 0.
 */
@Injectable()
export class MemoryCacheService implements OnModuleInit {
	private readonly logger = new Logger('MemoryCacheService');
	/** Resident set, keyed by absolute file path. Insertion + lastAccess drive LRU. */
	private readonly index = new Map<string, ResidentEntry>();
	private usedBytes = 0;
	private hasVmtouch = false;
	/** Warm operations run one-at-a-time to avoid thrashing the disk. */
	private warmChain: Promise<void> = Promise.resolve();
	private readonly inFlight = new Set<string>();

	constructor(private readonly settings: SettingsService) {}

	async onModuleInit() {
		this.hasVmtouch = await this.detectVmtouch();
		this.logger.log(
			this.hasVmtouch
				? 'Page-cache control via vmtouch (warm + evict) enabled'
				: 'vmtouch not found — warm-only fallback (OS handles eviction)',
		);
	}

	/** Current budget in bytes (0 = disabled). Read live so admin edits apply. */
	private maxBytes(): number {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as Record<
			string,
			unknown
		>;
		const gb = Number(enc?.memoryCacheMaxGb) || 0;
		return Math.max(0, gb) * 1024 ** 3;
	}

	get enabled(): boolean {
		return this.maxBytes() > 0;
	}

	/**
	 * Mark a file as recently used and ensure it's resident in RAM, evicting the
	 * oldest tracked files first if needed to stay under budget. Idempotent and
	 * cheap; safe to call on every play / job start.
	 */
	touch(filePath: string | null | undefined): void {
		const max = this.maxBytes();
		if (!filePath || max <= 0) return;

		const existing = this.index.get(filePath);
		if (existing) {
			existing.lastAccess = Date.now();
			return; // already resident — just bump recency
		}

		let size: number;
		try {
			const st = statSync(filePath);
			if (!st.isFile()) return;
			size = st.size;
		} catch {
			return;
		}
		if (size > max) {
			this.logger.debug(
				`Skip warm — ${basename(filePath)} (${this.fmt(size)}) exceeds budget ${this.fmt(max)}`,
			);
			return;
		}

		this.evictToFit(size, max);
		this.index.set(filePath, { size, lastAccess: Date.now() });
		this.usedBytes += size;
		this.queueWarm(filePath);
	}

	/**
	 * Drop a file from the resident set and release its pages. Call this when a
	 * file is converted/replaced or deleted so the stale copy doesn't linger.
	 */
	forget(filePath: string | null | undefined): void {
		if (!filePath) return;
		const entry = this.index.get(filePath);
		if (!entry) return;
		this.index.delete(filePath);
		this.usedBytes -= entry.size;
		this.evict(filePath);
		this.logger.log(`Released from memory cache: ${basename(filePath)} (${this.fmt(entry.size)})`);
	}

	getStatus() {
		const files = [...this.index.entries()]
			.map(([p, e]) => ({
				name: basename(p),
				sizeBytes: e.size,
				lastAccess: new Date(e.lastAccess).toISOString(),
			}))
			.sort((a, b) => b.lastAccess.localeCompare(a.lastAccess));
		return {
			enabled: this.enabled,
			vmtouch: this.hasVmtouch,
			maxBytes: this.maxBytes(),
			usedBytes: this.usedBytes,
			fileCount: this.index.size,
			systemTotalBytes: os.totalmem(),
			systemFreeBytes: os.freemem(),
			files,
		};
	}

	// ── internals ──────────────────────────────────────────────────────────

	private evictToFit(incoming: number, max: number): void {
		while (this.usedBytes + incoming > max && this.index.size > 0) {
			let oldest: string | null = null;
			let oldestAt = Number.POSITIVE_INFINITY;
			for (const [p, e] of this.index) {
				if (e.lastAccess < oldestAt) {
					oldestAt = e.lastAccess;
					oldest = p;
				}
			}
			if (!oldest) break;
			const entry = this.index.get(oldest)!;
			this.index.delete(oldest);
			this.usedBytes -= entry.size;
			this.evict(oldest);
			this.logger.log(`Evicted (LRU): ${basename(oldest)} (${this.fmt(entry.size)})`);
		}
	}

	private queueWarm(filePath: string): void {
		if (this.inFlight.has(filePath)) return;
		this.inFlight.add(filePath);
		this.warmChain = this.warmChain
			.then(() => this.warm(filePath))
			.finally(() => this.inFlight.delete(filePath));
	}

	private async warm(filePath: string): Promise<void> {
		// May have been evicted/forgotten while queued — skip if no longer tracked.
		if (!this.index.has(filePath)) return;
		const started = Date.now();
		try {
			if (this.hasVmtouch) {
				await execFileP('vmtouch', ['-t', filePath]);
			} else {
				await this.nodeWarm(filePath);
			}
			this.logger.log(
				`Warmed into RAM: ${basename(filePath)} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
			);
		} catch (err) {
			this.logger.warn(`Warm failed for ${basename(filePath)}: ${(err as Error).message}`);
		}
	}

	/** Portable fallback: a sequential read populates the OS page cache. */
	private nodeWarm(filePath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const rs = createReadStream(filePath, { highWaterMark: 8 * 1024 * 1024 });
			rs.on('data', () => {}); // discard — the read itself fills the page cache
			rs.on('end', () => resolve());
			rs.on('error', reject);
		});
	}

	private evict(filePath: string): void {
		if (!this.hasVmtouch) return; // no per-file eviction without vmtouch; OS LRU handles it
		execFileP('vmtouch', ['-e', filePath]).catch(() => {
			/* best-effort */
		});
	}

	private detectVmtouch(): Promise<boolean> {
		return new Promise((resolve) => {
			// vmtouch with no args prints usage + exits non-zero; ENOENT = not installed.
			execFile('vmtouch', [], (err) => {
				resolve(!(err && (err as NodeJS.ErrnoException).code === 'ENOENT'));
			});
		});
	}

	private fmt(bytes: number): string {
		return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
	}
}
