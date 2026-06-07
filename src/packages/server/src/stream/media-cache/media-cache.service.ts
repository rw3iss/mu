import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { nowISO, StreamMode, WsEvent } from '@mu/shared';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { mediaCache, movieFiles, streamSessions } from '../../database/schema/index.js';
import { EventsService } from '../../events/events.service.js';
import type { JobRecord } from '../../jobs/job.interface.js';
import { JobManagerService } from '../../jobs/job-manager.service.js';

const EVICT_JOB_TYPE = 'media-cache-evict';
const EVICT_SCHEDULE = 'media-cache-evict-scheduled';
const EVICT_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const HOUR_MS = 60 * 60 * 1000;

interface IndexEntry {
	cachePath: string;
	sizeBytes: number;
	movieId: string;
}

interface StageItem {
	fileId: string;
	movieId: string;
	sourcePath: string;
	sizeBytes: number;
}

/**
 * NVMe "hot" cache. On play-start it sequentially copies a movie's source file
 * off a slow media HDD onto a fast cache drive, then playback (and any
 * concurrent streams) read from the SSD instead of thrashing the spinning disk.
 * A scheduled job evicts entries by age + LRU under a size cap.
 *
 * Config (config.yml `cache.hot` / env): enabled, dir, maxGb, slowDrives,
 * watchedTtlHours, unwatchedTtlHours, idleTtlHours.
 */
@Injectable()
export class MediaCacheService implements OnModuleInit {
	private readonly logger = new Logger('MediaCacheService');

	private enabled = false;
	private hotDir = '';
	private maxBytes = 0;
	private slowDrives: string[] = [];
	private watchedTtlMs = 24 * HOUR_MS;
	private unwatchedTtlMs = 48 * HOUR_MS;
	private idleTtlMs = 168 * HOUR_MS;

	/** Completed, ready-to-serve entries (fast path; no DB hit on serve). */
	private readonly index = new Map<string, IndexEntry>();
	/** In-memory last-access timestamps; flushed to DB during eviction. */
	private readonly lastAccess = new Map<string, number>();
	/** fileIds currently staging or queued (dedupe). */
	private readonly pending = new Set<string>();
	private readonly queue: StageItem[] = [];
	private activeCopies = 0;
	private readonly maxConcurrentCopies = 1;

	constructor(
		private readonly config: ConfigService,
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly jobs: JobManagerService,
	) {}

	onModuleInit(): void {
		this.enabled = this.config.get<boolean>('cache.hot.enabled', false);
		this.hotDir = this.config.get<string>('cache.hot.dir', '');
		const maxGb = this.config.get<number>('cache.hot.maxGb', 300);
		this.maxBytes = Math.max(0, maxGb) * 1024 * 1024 * 1024;
		this.slowDrives = (this.config.get<string[]>('cache.hot.slowDrives', []) ?? []).map((d) =>
			d.toLowerCase(),
		);
		this.watchedTtlMs = this.config.get<number>('cache.hot.watchedTtlHours', 24) * HOUR_MS;
		this.unwatchedTtlMs = this.config.get<number>('cache.hot.unwatchedTtlHours', 48) * HOUR_MS;
		this.idleTtlMs = this.config.get<number>('cache.hot.idleTtlHours', 168) * HOUR_MS;

		if (!this.enabled) {
			this.logger.log('Hot media cache disabled (cache.hot.enabled=false)');
			return;
		}
		this.logger.log(
			`Hot media cache enabled: dir=${this.hotDir}, cap=${maxGb}GB, slowDrives=[${this.slowDrives.join(', ') || 'auto'}]`,
		);

		// Hydrate the in-memory index from DB and prune rows whose files vanished.
		this.hydrate();

		// Stage on play-start.
		this.events.on(WsEvent.STREAM_STARTED, (payload) => {
			this.onStreamStarted(payload as Record<string, unknown>);
		});

		// Periodic eviction.
		this.jobs.registerHandler(EVICT_JOB_TYPE, (job) => this.handleEvict(job));
		this.jobs.schedule({
			name: EVICT_SCHEDULE,
			intervalMs: EVICT_INTERVAL_MS,
			runImmediately: false,
			job: { type: EVICT_JOB_TYPE, label: 'Evict stale hot-cache entries', priority: 50 },
		});
	}

	/**
	 * Fast lookup used by the direct-play route. Returns the staged copy path
	 * when a complete entry exists (and bumps its last-access time), else null.
	 */
	getHotPath(fileId: string): string | null {
		if (!this.enabled) return null;
		const entry = this.index.get(fileId);
		if (!entry) return null;
		if (!existsSync(entry.cachePath)) {
			// File disappeared out from under us — drop and fall back to original.
			this.index.delete(fileId);
			return null;
		}
		this.lastAccess.set(fileId, Date.now());
		return entry.cachePath;
	}

	/** Mark a staged movie as fully watched so it's eligible for earlier eviction. */
	markWatchedFully(fileId: string | null | undefined): void {
		if (!this.enabled || !fileId || !this.index.has(fileId)) return;
		const ts = nowISO();
		try {
			this.database.db
				.update(mediaCache)
				.set({ watchedFully: true, watchedAt: ts })
				.where(eq(mediaCache.movieFileId, fileId))
				.run();
		} catch (err) {
			this.logger.warn(`markWatchedFully failed for ${fileId}: ${(err as Error).message}`);
		}
	}

	private hydrate(): void {
		try {
			const rows = this.database.db.select().from(mediaCache).all();
			for (const row of rows) {
				if (row.complete && existsSync(row.cachePath)) {
					this.index.set(row.movieFileId, {
						cachePath: row.cachePath,
						sizeBytes: row.sizeBytes ?? 0,
						movieId: row.movieId,
					});
				} else {
					// Incomplete or missing on disk — clean up the stale row + any partial.
					void this.discard(row.movieFileId, row.cachePath);
				}
			}
			this.logger.log(`Hydrated hot cache: ${this.index.size} entr(ies) ready`);
		} catch (err) {
			this.logger.warn(`Hot cache hydrate failed: ${(err as Error).message}`);
		}
	}

	private onStreamStarted(payload: Record<string, unknown>): void {
		const fileId = typeof payload.fileId === 'string' ? payload.fileId : null;
		const movieId = typeof payload.movieId === 'string' ? payload.movieId : null;
		if (!fileId || !movieId) return;
		// Only stage for direct-play — that's the mode whose serving path reads
		// the staged copy. Transcoded streams read through ffmpeg (original).
		if (payload.mode !== StreamMode.DIRECT_PLAY) return;
		if (this.index.has(fileId)) {
			this.lastAccess.set(fileId, Date.now());
			return; // already staged
		}
		if (this.pending.has(fileId)) return;

		const fileRow = this.database.db
			.select({ filePath: movieFiles.filePath, fileSize: movieFiles.fileSize })
			.from(movieFiles)
			.where(eq(movieFiles.id, fileId))
			.get();
		if (!fileRow?.filePath) return;
		if (!this.shouldStage(fileRow.filePath)) return;

		this.pending.add(fileId);
		this.queue.push({
			fileId,
			movieId,
			sourcePath: fileRow.filePath,
			sizeBytes: fileRow.fileSize ?? 0,
		});
		this.pumpQueue();
	}

	/**
	 * Stage only files worth staging: source must not already sit on the cache
	 * drive. With `slowDrives` configured we match those prefixes exactly;
	 * otherwise we stage anything not already on the cache drive.
	 */
	private shouldStage(sourcePath: string): boolean {
		const src = sourcePath.toLowerCase();
		// Never copy a file that already lives under the cache dir...
		if (this.hotDir && src.startsWith(this.hotDir.toLowerCase())) return false;
		// ...or already sits on the same physical drive/filesystem as the cache.
		if (this.onCacheDrive(sourcePath)) return false;

		if (this.slowDrives.length > 0) {
			return this.slowDrives.some((d) => src.startsWith(d));
		}
		// No explicit slow-drive list: stage anything off the cache drive.
		return true;
	}

	/**
	 * True when `sourcePath` lives on the same drive/filesystem as the hot-cache
	 * dir (so staging would only copy within one disk). On Windows we compare
	 * drive letters; on POSIX every absolute path shares "/", so a string prefix
	 * is useless — we compare the underlying filesystem device id from stat(),
	 * which correctly distinguishes a slow media-HDD mount from the cache mount.
	 */
	private onCacheDrive(sourcePath: string): boolean {
		if (!this.hotDir) return false;
		if (process.platform === 'win32') {
			const a = this.driveOf(sourcePath);
			const b = this.driveOf(this.hotDir);
			return Boolean(a && b && a === b);
		}
		try {
			return statSync(sourcePath).dev === statSync(this.hotDir).dev;
		} catch {
			// Can't stat the source (missing / unmounted) → don't try to stage it.
			return true;
		}
	}

	/** Lowercased Windows drive prefix, e.g. "d:"; empty on POSIX. */
	private driveOf(p: string): string {
		const m = /^([a-zA-Z]):/.exec(p);
		if (m) return `${m[1]!.toLowerCase()}:`;
		return p.startsWith('/') ? '/' : '';
	}

	private pumpQueue(): void {
		while (this.activeCopies < this.maxConcurrentCopies && this.queue.length > 0) {
			const item = this.queue.shift()!;
			this.activeCopies++;
			void this.stage(item).finally(() => {
				this.activeCopies--;
				this.pending.delete(item.fileId);
				this.pumpQueue();
			});
		}
	}

	private async stage(item: StageItem): Promise<void> {
		const { fileId, movieId, sourcePath, sizeBytes } = item;
		try {
			const srcStat = await stat(sourcePath).catch(() => null);
			if (!srcStat) return;
			const realSize = srcStat.size;

			// Make room before copying (don't evict files with active sessions).
			if (this.maxBytes > 0 && !(await this.ensureRoom(realSize))) {
				this.logger.warn(
					`Hot cache: no room to stage ${fileId} (${(realSize / 1e9).toFixed(1)}GB) — skipping`,
				);
				return;
			}

			const ext = path.extname(sourcePath) || '.bin';
			const destDir = path.join(this.hotDir, fileId);
			const dest = path.join(destDir, `source${ext}`);
			const part = `${dest}.part`;
			await mkdir(destDir, { recursive: true });

			const ts = nowISO();
			this.database.db
				.insert(mediaCache)
				.values({
					movieFileId: fileId,
					movieId,
					sourcePath,
					cachePath: dest,
					sizeBytes: realSize || sizeBytes,
					stagedAt: null,
					lastAccessAt: ts,
					complete: false,
					watchedFully: false,
				})
				.onConflictDoUpdate({
					target: mediaCache.movieFileId,
					set: { sourcePath, cachePath: dest, complete: false, lastAccessAt: ts },
				})
				.run();

			const start = Date.now();
			await pipeline(createReadStream(sourcePath), createWriteStream(part));

			// Verify the copy is whole before promoting it.
			const partStat = await stat(part).catch(() => null);
			if (!partStat || (realSize > 0 && partStat.size !== realSize)) {
				await rm(part, { force: true });
				this.database.db.delete(mediaCache).where(eq(mediaCache.movieFileId, fileId)).run();
				this.logger.warn(`Hot cache: copy size mismatch for ${fileId} — discarded`);
				return;
			}
			await rm(dest, { force: true });
			await rename(part, dest);

			const doneTs = nowISO();
			this.database.db
				.update(mediaCache)
				.set({
					complete: true,
					stagedAt: doneTs,
					lastAccessAt: doneTs,
					sizeBytes: partStat.size,
				})
				.where(eq(mediaCache.movieFileId, fileId))
				.run();
			this.index.set(fileId, { cachePath: dest, sizeBytes: partStat.size, movieId });
			this.lastAccess.set(fileId, Date.now());
			const secs = ((Date.now() - start) / 1000).toFixed(0);
			this.logger.log(
				`Hot cache: staged ${fileId} (${(partStat.size / 1e9).toFixed(1)}GB) in ${secs}s`,
			);
		} catch (err) {
			this.logger.warn(`Hot cache: stage failed for ${fileId}: ${(err as Error).message}`);
			await this.discard(fileId, path.join(this.hotDir, fileId)).catch(() => {});
		}
	}

	private totalBytes(): number {
		let sum = 0;
		for (const e of this.index.values()) sum += e.sizeBytes;
		return sum;
	}

	/** Evict LRU (skipping in-use) until `incoming` bytes fit under the cap. */
	private async ensureRoom(incoming: number): Promise<boolean> {
		if (this.maxBytes <= 0) return true;
		if (incoming > this.maxBytes) return false;
		if (this.totalBytes() + incoming <= this.maxBytes) return true;

		const active = this.activeFileIds();
		const candidates = [...this.index.entries()]
			.filter(([id]) => !active.has(id))
			.sort((a, b) => (this.lastAccess.get(a[0]) ?? 0) - (this.lastAccess.get(b[0]) ?? 0));

		for (const [id, entry] of candidates) {
			if (this.totalBytes() + incoming <= this.maxBytes) break;
			await this.discard(id, entry.cachePath);
		}
		return this.totalBytes() + incoming <= this.maxBytes;
	}

	private activeFileIds(): Set<string> {
		const out = new Set<string>();
		try {
			const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
			const rows = this.database.db
				.select({ fileId: streamSessions.movieFileId, active: streamSessions.lastActiveAt })
				.from(streamSessions)
				.all();
			for (const r of rows) {
				if (r.fileId && (r.active ?? '') >= cutoff) out.add(r.fileId);
			}
		} catch {
			// best-effort
		}
		return out;
	}

	private async handleEvict(_job: JobRecord): Promise<unknown> {
		if (!this.enabled) return { skipped: 'disabled' };
		this.flushAccess();
		const now = Date.now();
		const active = this.activeFileIds();
		const rows = this.database.db.select().from(mediaCache).all();
		let evicted = 0;

		for (const row of rows) {
			const id = row.movieFileId;
			if (active.has(id)) continue; // never evict a file being watched
			const access = this.lastAccess.get(id) ?? (Date.parse(row.lastAccessAt) || now);
			const staged = row.stagedAt ? Date.parse(row.stagedAt) : access;
			const idle = now - access;

			let expired = idle > this.idleTtlMs;
			if (!expired && row.watchedFully) expired = idle > this.watchedTtlMs;
			if (!expired && !row.watchedFully) expired = now - staged > this.unwatchedTtlMs;

			if (expired) {
				await this.discard(id, row.cachePath);
				evicted++;
			}
		}

		// Enforce the size cap (LRU) after age-based pruning.
		if (this.maxBytes > 0 && this.totalBytes() > this.maxBytes) {
			const candidates = [...this.index.entries()]
				.filter(([id]) => !active.has(id))
				.sort(
					(a, b) => (this.lastAccess.get(a[0]) ?? 0) - (this.lastAccess.get(b[0]) ?? 0),
				);
			for (const [id, entry] of candidates) {
				if (this.totalBytes() <= this.maxBytes) break;
				await this.discard(id, entry.cachePath);
				evicted++;
			}
		}

		if (evicted > 0) {
			this.logger.log(
				`Hot cache eviction: removed ${evicted} entr(ies); ${(this.totalBytes() / 1e9).toFixed(1)}GB now resident`,
			);
		}
		return { evicted, residentBytes: this.totalBytes() };
	}

	/** Write the in-memory last-access timestamps back to the DB. */
	private flushAccess(): void {
		for (const [id, ts] of this.lastAccess) {
			if (!this.index.has(id)) continue;
			try {
				this.database.db
					.update(mediaCache)
					.set({ lastAccessAt: new Date(ts).toISOString() })
					.where(eq(mediaCache.movieFileId, id))
					.run();
			} catch {
				// best-effort
			}
		}
	}

	/** Remove a staged copy from disk, DB, and the in-memory index. */
	private async discard(fileId: string, cachePath: string): Promise<void> {
		this.index.delete(fileId);
		this.lastAccess.delete(fileId);
		try {
			this.database.db.delete(mediaCache).where(eq(mediaCache.movieFileId, fileId)).run();
		} catch {
			// best-effort
		}
		try {
			// Remove the per-file dir (source.ext + any .part), not just the file.
			const dir = path.dirname(cachePath);
			if (dir && dir !== this.hotDir && existsSync(dir)) {
				await rm(dir, { recursive: true, force: true });
			} else if (existsSync(cachePath)) {
				await rm(cachePath, { force: true });
			}
		} catch {
			// best-effort
		}
	}
}
