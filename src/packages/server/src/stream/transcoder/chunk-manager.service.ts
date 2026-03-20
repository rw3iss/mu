import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventsService } from '../../events/events.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { ChunkManifestService } from './chunk-manifest.service.js';
import {
	CHUNK_PRIORITY,
	type ChunkInfo,
	type ChunkMap,
	type ChunkMetadata,
	type ChunkTask,
} from './chunk-meta.js';
import { TranscoderService } from './transcoder.service.js';

const MAX_CHUNK_RETRIES = 3;
const CHUNK_META_FILE = 'chunk-meta.json';

@Injectable()
export class ChunkManagerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(ChunkManagerService.name);

	/** In-memory chunk maps keyed by `movieFileId:quality` */
	private readonly chunkMaps = new Map<string, ChunkMap>();

	/** Priority queue of pending chunk tasks */
	private readonly queue: ChunkTask[] = [];

	/** Currently encoding chunk count */
	private activeCount = 0;

	/** Track active chunk process keys for cancellation */
	private readonly activeChunkKeys = new Set<string>();
	/** Set when FFmpeg consistently fails to spawn (Windows handle exhaustion) */
	private ffmpegBroken = false;
	private consecutiveSpawnFailures = 0;

	constructor(
		private readonly transcoder: TranscoderService,
		private readonly manifestService: ChunkManifestService,
		private readonly settings: SettingsService,
		private readonly events: EventsService,
	) {}

	onModuleInit() {
		// Resume incomplete transcodes after services are ready
		setTimeout(() => this.resumeOnStartup(), 4000);
	}

	onModuleDestroy() {
		// Cancel all active chunks
		for (const key of this.activeChunkKeys) {
			this.transcoder.stopTranscode(key);
		}
		if (this.activeChunkKeys.size > 0) {
			this.logger.warn(`Shutdown: stopped ${this.activeChunkKeys.size} active chunk encodes`);
		}
	}

	// ============================================
	// Public API
	// ============================================

	/**
	 * Initialize a chunk map for a movie. Divides the movie into chunks,
	 * scans disk for existing segments, and persists metadata.
	 */
	async initializeChunkMap(
		movieFileId: string,
		quality: string,
		filePath: string,
		movieDuration: number,
	): Promise<ChunkMap> {
		const key = this.mapKey(movieFileId, quality);
		const existing = this.chunkMaps.get(key);
		if (existing) return existing;

		const chunkDuration = this.getChunkDuration();
		const totalChunks = Math.ceil(movieDuration / chunkDuration);
		const encodingSettingsHash = this.transcoder.getEncodingSettingsHash();

		const chunks: ChunkInfo[] = [];
		for (let i = 0; i < totalChunks; i++) {
			const startTime = i * chunkDuration;
			const isLast = i === totalChunks - 1;
			const dur = isLast ? movieDuration - startTime : chunkDuration;

			chunks.push({
				index: i,
				startTime,
				duration: Math.max(0.1, dur),
				status: 'pending',
				attempts: 0,
				segmentFile: `segment_${String(i).padStart(4, '0')}.ts`,
			});
		}

		const chunkMap: ChunkMap = {
			movieFileId,
			quality,
			filePath,
			totalChunks,
			chunkDuration,
			movieDuration,
			encodingSettingsHash,
			chunks,
		};

		// Scan disk for existing segments
		const cacheDir = this.transcoder.getPersistentDir(movieFileId, quality);
		await mkdir(cacheDir, { recursive: true });

		// Check for old-format cache (has segments but no chunk-meta.json)
		// Old monolithic transcodes use different segment durations, so they're incompatible
		const chunkMetaPath = path.join(cacheDir, 'chunk-meta.json');
		const hasOldManifest = existsSync(path.join(cacheDir, 'stream.m3u8'));
		const hasChunkMeta = existsSync(chunkMetaPath);
		if (hasOldManifest && !hasChunkMeta) {
			this.logger.warn(
				`Old-format cache detected for ${movieFileId}/${quality}, clearing for chunked transcode`,
			);
			await rm(cacheDir, { recursive: true, force: true });
			await mkdir(cacheDir, { recursive: true });
		}

		await this.scanExistingChunks(chunkMap, cacheDir);

		// Persist metadata
		await this.writeChunkMeta(chunkMap, cacheDir);

		this.chunkMaps.set(key, chunkMap);
		this.logger.log(
			`Chunk map initialized: ${movieFileId}/${quality} — ${totalChunks} chunks (${chunkDuration}s each), ${chunkMap.chunks.filter((c) => c.status === 'complete').length} already cached`,
		);

		return chunkMap;
	}

	/**
	 * Get an existing chunk map (or undefined if not initialized).
	 */
	getChunkMap(movieFileId: string, quality: string): ChunkMap | undefined {
		return this.chunkMaps.get(this.mapKey(movieFileId, quality));
	}

	/**
	 * Enqueue all pending chunks for background transcoding.
	 */
	enqueueAllPending(
		movieFileId: string,
		quality: string,
		basePriority: number = CHUNK_PRIORITY.SEQUENTIAL,
	): void {
		const map = this.chunkMaps.get(this.mapKey(movieFileId, quality));
		if (!map) return;

		for (const chunk of map.chunks) {
			if (chunk.status === 'pending') {
				this.enqueueChunk(movieFileId, quality, chunk.index, basePriority);
			}
		}

		this.drain();
	}

	/**
	 * Reprioritize chunks for a seek operation.
	 * The target chunk and lookahead chunks get high priority.
	 * Other pending chunks are deprioritized.
	 */
	reprioritizeForSeek(movieFileId: string, quality: string, seekTimeSeconds: number): void {
		const map = this.chunkMaps.get(this.mapKey(movieFileId, quality));
		if (!map) return;

		const targetIndex = Math.floor(seekTimeSeconds / map.chunkDuration);
		const lookahead = this.getChunkLookahead();

		// Deprioritize all existing queue items for this movie
		for (const task of this.queue) {
			if (task.movieFileId === movieFileId && task.quality === quality) {
				task.priority = CHUNK_PRIORITY.BACKGROUND;
			}
		}

		// Enqueue or reprioritize the target and lookahead chunks
		for (let i = targetIndex; i < Math.min(targetIndex + lookahead, map.totalChunks); i++) {
			const chunk = map.chunks[i];
			if (!chunk || chunk.status === 'complete' || chunk.status === 'encoding') continue;

			const priority = i === targetIndex ? CHUNK_PRIORITY.SEEK : CHUNK_PRIORITY.LOOKAHEAD;

			// Check if already in queue
			const existing = this.queue.find(
				(t) => t.movieFileId === movieFileId && t.quality === quality && t.chunkIndex === i,
			);
			if (existing) {
				existing.priority = Math.min(existing.priority, priority);
				existing.requestedAt = Date.now();
			} else if (chunk.status === 'pending' || chunk.status === 'failed') {
				chunk.status = 'pending';
				this.enqueueChunk(movieFileId, quality, i, priority);
			}
		}

		// Re-sort the queue
		this.sortQueue();
		this.drain();

		this.logger.log(
			`Reprioritized for seek: ${movieFileId}/${quality} target chunk ${targetIndex} (${seekTimeSeconds}s)`,
		);
	}

	/**
	 * Check if the chunk at the given time is ready to play.
	 */
	isChunkReady(movieFileId: string, quality: string, timeSeconds: number): boolean {
		const map = this.chunkMaps.get(this.mapKey(movieFileId, quality));
		if (!map) return false;
		const index = Math.floor(timeSeconds / map.chunkDuration);
		return map.chunks[index]?.status === 'complete';
	}

	/**
	 * Get overall progress for a movie's transcoding.
	 */
	getProgress(
		movieFileId: string,
		quality: string,
	): { completed: number; total: number; percent: number } {
		const map = this.chunkMaps.get(this.mapKey(movieFileId, quality));
		if (!map) return { completed: 0, total: 0, percent: 0 };
		const completed = map.chunks.filter((c) => c.status === 'complete').length;
		return {
			completed,
			total: map.totalChunks,
			percent: map.totalChunks > 0 ? (completed / map.totalChunks) * 100 : 0,
		};
	}

	/**
	 * Cancel all chunks for a movie+quality.
	 */
	cancelAllChunks(movieFileId: string, quality: string): void {
		const key = this.mapKey(movieFileId, quality);

		// Remove from queue
		for (let i = this.queue.length - 1; i >= 0; i--) {
			if (this.queue[i]!.movieFileId === movieFileId && this.queue[i]!.quality === quality) {
				this.queue.splice(i, 1);
			}
		}

		// Kill active FFmpeg processes for this movie's chunks
		for (const processKey of [...this.activeChunkKeys]) {
			if (processKey.startsWith(`chunk-${movieFileId}-${quality}-`)) {
				this.transcoder.stopTranscode(processKey);
				this.activeChunkKeys.delete(processKey);
			}
		}

		this.chunkMaps.delete(key);
	}

	/**
	 * Generate a virtual manifest for a movie's chunk state.
	 */
	getVirtualManifest(movieFileId: string, quality: string): string | null {
		const map = this.chunkMaps.get(this.mapKey(movieFileId, quality));
		if (!map) return null;
		return this.manifestService.generateVirtualManifest(map);
	}

	/**
	 * Check if chunked transcoding is enabled in settings.
	 */
	isEnabled(): boolean {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		return enc?.useChunkedTranscoding === true;
	}

	// ============================================
	// Internal scheduling
	// ============================================

	private enqueueChunk(
		movieFileId: string,
		quality: string,
		chunkIndex: number,
		priority: number,
	): void {
		// Don't double-enqueue
		const exists = this.queue.some(
			(t) =>
				t.movieFileId === movieFileId &&
				t.quality === quality &&
				t.chunkIndex === chunkIndex,
		);
		if (exists) return;

		this.queue.push({
			movieFileId,
			quality,
			chunkIndex,
			priority,
			requestedAt: Date.now(),
		});
		this.sortQueue();
	}

	private sortQueue(): void {
		this.queue.sort((a, b) => a.priority - b.priority || a.requestedAt - b.requestedAt);
	}

	private getMaxConcurrency(): number {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		return enc?.maxConcurrentJobs ?? 4;
	}

	private getChunkDuration(): number {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const val = enc?.chunkDuration ?? enc?.segmentDuration ?? 4;
		return Math.max(3, Math.min(12, val));
	}

	private getChunkLookahead(): number {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		return enc?.chunkLookahead ?? 10;
	}

	private drainScheduled = false;

	/** Schedule drain with delay to avoid tight spawn loops on failure */
	private scheduleDrain(): void {
		if (this.drainScheduled) return;
		this.drainScheduled = true;
		setTimeout(() => {
			this.drainScheduled = false;
			this.drain();
		}, 200);
	}

	private async drain(): Promise<void> {
		const max = this.getMaxConcurrency();
		// Check total FFmpeg load: chunk + monolithic/live processes
		const totalFfmpeg = this.activeCount + this.transcoder.getActiveTranscodeCount();
		if (totalFfmpeg >= max || this.queue.length === 0) return;

		const task = this.queue.shift();
		if (!task) return;

		const map = this.chunkMaps.get(this.mapKey(task.movieFileId, task.quality));
		if (!map) { this.scheduleDrain(); return; }

		const chunk = map.chunks[task.chunkIndex];
		if (!chunk || chunk.status === 'complete' || chunk.status === 'encoding') {
			this.scheduleDrain();
			return;
		}

		this.activeCount++;
		this.executeChunk(map, chunk).finally(() => {
			this.activeCount--;
			this.scheduleDrain();
		});
	}

	private async executeChunk(map: ChunkMap, chunk: ChunkInfo): Promise<void> {
		// Quick check: can FFmpeg actually spawn? If previous failures exhausted handles, bail early.
		if (this.ffmpegBroken) {
			chunk.status = 'failed';
			return;
		}
		const cacheDir = this.transcoder.getPersistentDir(map.movieFileId, map.quality);
		const outputPath = path.join(cacheDir, chunk.segmentFile);
		const processKey = `chunk-${map.movieFileId}-${map.quality}-${chunk.index}`;

		chunk.status = 'encoding';
		chunk.attempts++;
		this.activeChunkKeys.add(processKey);

		try {
			await this.transcoder.transcodeChunk(
				map.filePath,
				outputPath,
				chunk.startTime,
				chunk.duration,
				map.quality,
			);

			chunk.status = 'complete';
			this.activeChunkKeys.delete(processKey);

			// Emit progress
			const progress = this.getProgress(map.movieFileId, map.quality);
			this.events.emit(WsEvent.JOB_PROGRESS, {
				type: 'pre-transcode',
				payload: { movieId: map.movieFileId },
				progress: progress.percent,
				label: `Transcoding: ${progress.completed}/${progress.total} chunks`,
			});

			// Check if all chunks are complete
			if (progress.completed === progress.total) {
				await this.finalize(map, cacheDir);
			}
		} catch (err: any) {
			chunk.status = 'failed';
			this.activeChunkKeys.delete(processKey);
			this.logger.error(
				`Chunk ${chunk.index} failed for ${map.movieFileId}/${map.quality}: ${err.message}`,
			);

			// Track consecutive spawn failures globally
			const isDllError = err.message?.includes('3221225794') || err.message?.includes('C0000142');
			if (isDllError) {
				this.consecutiveSpawnFailures++;
				if (this.consecutiveSpawnFailures >= 3) {
					this.ffmpegBroken = true;
					this.logger.error('FFmpeg spawn broken (Windows handle exhaustion) — halting all chunk encoding');
					this.queue.length = 0;
					return;
				}
			} else {
				this.consecutiveSpawnFailures = 0;
			}

			// Detect systemic failure: if many recent chunks failed, abort the whole movie
			const recentChunks = map.chunks.slice(Math.max(0, chunk.index - 10), chunk.index + 1);
			const recentFailures = recentChunks.filter((c) => c.status === 'failed').length;
			if (recentFailures >= 5) {
				this.logger.error(
					`Systemic failure for ${map.movieFileId}/${map.quality}: ${recentFailures} consecutive failures, aborting`,
				);
				this.cancelAllChunks(map.movieFileId, map.quality);
				// Write .failed marker to prevent re-queuing on restart
				writeFile(path.join(cacheDir, '.failed'), `Systemic failure: ${err.message}`).catch(() => {});
				return;
			}

			// Retry if under max attempts
			if (chunk.attempts < MAX_CHUNK_RETRIES) {
				chunk.status = 'pending';
				this.enqueueChunk(
					map.movieFileId,
					map.quality,
					chunk.index,
					CHUNK_PRIORITY.SEQUENTIAL,
				);
			}
		}
	}

	private async finalize(map: ChunkMap, cacheDir: string): Promise<void> {
		this.logger.log(`All chunks complete for ${map.movieFileId}/${map.quality} — finalizing`);

		// Write final manifest
		await this.manifestService.writeFinalManifest(map, cacheDir);

		// Write .complete marker
		await writeFile(path.join(cacheDir, '.complete'), '');

		// Emit completion
		this.events.emit(WsEvent.JOB_COMPLETED, {
			type: 'pre-transcode',
			payload: { movieId: map.movieFileId },
			progress: 100,
		});

		// Clean up in-memory state
		this.chunkMaps.delete(this.mapKey(map.movieFileId, map.quality));
	}

	// ============================================
	// Disk scanning and persistence
	// ============================================

	private async scanExistingChunks(chunkMap: ChunkMap, cacheDir: string): Promise<void> {
		try {
			const files = await readdir(cacheDir);
			const segmentFiles = new Set(
				files.filter((f) => f.startsWith('segment_') && f.endsWith('.ts')),
			);

			for (const chunk of chunkMap.chunks) {
				if (segmentFiles.has(chunk.segmentFile)) {
					// Verify file is not empty/truncated
					try {
						const s = await stat(path.join(cacheDir, chunk.segmentFile));
						if (s.size > 0) {
							chunk.status = 'complete';
						}
					} catch {
						// File might be corrupt, leave as pending
					}
				}
			}
		} catch {
			// Directory might not exist yet
		}
	}

	private async writeChunkMeta(chunkMap: ChunkMap, cacheDir: string): Promise<void> {
		const meta: ChunkMetadata = {
			movieFileId: chunkMap.movieFileId,
			quality: chunkMap.quality,
			filePath: chunkMap.filePath,
			totalChunks: chunkMap.totalChunks,
			chunkDuration: chunkMap.chunkDuration,
			movieDuration: chunkMap.movieDuration,
			encodingSettingsHash: chunkMap.encodingSettingsHash,
			createdAt: nowISO(),
		};
		await writeFile(path.join(cacheDir, CHUNK_META_FILE), JSON.stringify(meta, null, 2));
	}

	/**
	 * On startup, scan for partially-transcoded movies and resume them.
	 */
	private async resumeOnStartup(): Promise<void> {
		if (!this.isEnabled()) return;

		const cacheBase = this.transcoder.getPersistentDir('', '').replace(/[/\\]{2}$/, '');
		const persistDir = path.dirname(cacheBase);

		if (!existsSync(persistDir)) return;

		let resumed = 0;

		try {
			const movieDirs = await readdir(persistDir);
			for (const movieFileId of movieDirs) {
				const moviePath = path.join(persistDir, movieFileId);
				try {
					const qualityDirs = await readdir(moviePath);
					for (const quality of qualityDirs) {
						const qualityPath = path.join(moviePath, quality);
						const completePath = path.join(qualityPath, '.complete');
						const metaPath = path.join(qualityPath, CHUNK_META_FILE);

						// Skip completed or permanently failed transcodes
						if (existsSync(completePath)) continue;
						if (existsSync(path.join(qualityPath, '.failed'))) continue;

						// Only resume if we have chunk metadata
						if (!existsSync(metaPath)) continue;

						try {
							const raw = await readFile(metaPath, 'utf-8');
							const meta: ChunkMetadata = JSON.parse(raw);

							// Check if encoding settings still match
							const currentHash = this.transcoder.getEncodingSettingsHash();
							if (meta.encodingSettingsHash !== currentHash) {
								this.logger.warn(
									`Skipping resume for ${movieFileId}/${quality}: encoding settings changed`,
								);
								continue;
							}

							// Check source file still exists
							if (!existsSync(meta.filePath)) {
								this.logger.warn(
									`Skipping resume for ${movieFileId}/${quality}: source file missing`,
								);
								continue;
							}

							// Initialize chunk map from metadata
							const chunkMap = await this.initializeChunkMap(
								meta.movieFileId,
								meta.quality,
								meta.filePath,
								meta.movieDuration,
							);

							const pending = chunkMap.chunks.filter(
								(c) => c.status === 'pending',
							).length;
							if (pending > 0) {
								this.enqueueAllPending(
									meta.movieFileId,
									meta.quality,
									CHUNK_PRIORITY.BACKGROUND,
								);
								resumed++;
								this.logger.log(
									`Resumed chunked transcode: ${movieFileId}/${quality} — ${pending} chunks remaining`,
								);
							}
						} catch (err: any) {
							this.logger.warn(
								`Failed to resume ${movieFileId}/${quality}: ${err.message}`,
							);
						}
					}
				} catch {
					// Not a directory or unreadable
				}
			}
		} catch {
			// Persistent dir doesn't exist
		}

		if (resumed > 0) {
			this.logger.log(`Resumed ${resumed} chunked transcode jobs on startup`);
		}
	}

	// ============================================
	// Helpers
	// ============================================

	private mapKey(movieFileId: string, quality: string): string {
		return `${movieFileId}:${quality}`;
	}
}
