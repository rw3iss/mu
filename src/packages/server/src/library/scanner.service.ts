import { opendir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { type MediaKind, nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { type MediaSource, mediaSources, scanLog } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { FeatureFlagsService, KIND_FEATURE } from '../features/feature-flags.service.js';
import { ImporterRegistry } from './importers/importer-registry.js';
import type { ImportFileResult, MediaImporter } from './importers/media-importer.js';
import { VideoImporter } from './importers/video-importer.js';

export type { ImportFileResult } from './importers/media-importer.js';

export interface ScanSourceResult {
	logId: string;
	filesFound: number;
	filesAdded: number;
	filesUpdated: number;
	filesRemoved: number;
	/** Set when the source was not scanned (no importer for its kind / feature off). */
	skipped?: string;
}

/**
 * Scan orchestrator (plan §3.2 "ScanOrchestrator"). Kind-agnostic: walks a
 * media source with the MediaImporter registered for the source's `kind` and
 * dispatches every matching file to it. Sources whose kind has no importer,
 * or whose feature is disabled (video→movies, audio→music), are skipped.
 *
 * The class keeps its historical name and public methods (`scanSource`,
 * `importFile`, `purgeOrphanedMovies`, `reprobeFileRow`, `listUnprobedFiles`,
 * `rescanMovie`) so existing callers don't change; the movie-specific ones
 * delegate to VideoImporter.
 */
@Injectable()
export class ScannerService {
	private readonly logger = new Logger('ScannerService');

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly importers: ImporterRegistry,
		private readonly features: FeatureFlagsService,
		private readonly video: VideoImporter,
	) {}

	private getSourceRow(sourceId: string): MediaSource | undefined {
		return this.database.db
			.select()
			.from(mediaSources)
			.where(eq(mediaSources.id, sourceId))
			.get();
	}

	/**
	 * The importer that should handle files of this source, or a reason why
	 * none applies. Shared with the watcher so both gate identically.
	 */
	resolveImporter(
		kind: string | null | undefined,
	): { importer: MediaImporter } | { importer: null; reason: string } {
		const k = (kind || 'video') as MediaKind;
		const feature = KIND_FEATURE[k];
		if (!feature) return { importer: null, reason: `unknown source kind "${k}"` };
		if (!this.features.isEnabled(feature)) {
			return { importer: null, reason: `feature "${feature}" is disabled` };
		}
		const importer = this.importers.get(k);
		if (!importer) return { importer: null, reason: `no importer for kind "${k}"` };
		return { importer };
	}

	async scanSource(sourceId: string): Promise<ScanSourceResult> {
		const source = this.getSourceRow(sourceId);
		if (!source) {
			throw new Error(`Source ${sourceId} not found`);
		}

		const resolved = this.resolveImporter(source.kind);
		if (!resolved.importer) {
			this.logger.log(`Scan skipped for ${source.path}: ${resolved.reason}`);
			return {
				logId: '',
				filesFound: 0,
				filesAdded: 0,
				filesUpdated: 0,
				filesRemoved: 0,
				skipped: resolved.reason,
			};
		}
		const importer = resolved.importer;

		const logId = crypto.randomUUID();
		const now = nowISO();

		this.database.db
			.insert(scanLog)
			.values({
				id: logId,
				sourceId,
				startedAt: now,
				status: 'running',
			})
			.run();

		this.events.emit(WsEvent.SCAN_STARTED, { sourceId, logId });
		this.logger.log(`Scan started for ${importer.kind} source: ${source.path}`);

		const scanStartTime = performance.now();

		let filesFound = 0;
		let filesAdded = 0;
		let filesUpdated = 0;
		let filesRemoved = 0;
		const errors: string[] = [];
		const foundPaths = new Set<string>();

		try {
			for await (const filePath of this.walkDir(source.path, importer.extensions)) {
				filesFound++;
				foundPaths.add(filePath);

				try {
					const result = await importer.importFile(sourceId, filePath);
					if (result.status === 'updated') {
						filesUpdated++;
					} else if (result.status === 'added') {
						filesAdded++;
					} else if (result.status === 'error') {
						errors.push(`Error processing ${filePath}: ${result.reason}`);
					}
				} catch (err: any) {
					errors.push(`Error processing ${filePath}: ${err.message}`);
					this.logger.warn(`Error processing file ${filePath}: ${err.message}`);
				}

				if (filesFound % 50 === 0) {
					this.events.emit(WsEvent.SCAN_PROGRESS, { sourceId, logId, filesFound });
				}
			}

			// Mark files no longer present as unavailable
			filesRemoved = await importer.markMissing(sourceId, foundPaths);

			// Clean up catalogue rows with no remaining available files
			await importer.purgeOrphans();

			// Update source stats
			this.database.db
				.update(mediaSources)
				.set({
					lastScannedAt: nowISO(),
					fileCount: foundPaths.size,
					updatedAt: nowISO(),
				})
				.where(eq(mediaSources.id, sourceId))
				.run();

			// Finalize scan log
			this.database.db
				.update(scanLog)
				.set({
					completedAt: nowISO(),
					status: 'completed',
					filesFound,
					filesAdded,
					filesUpdated,
					filesRemoved,
					errors: JSON.stringify(errors),
				})
				.where(eq(scanLog.id, logId))
				.run();

			this.events.emit(WsEvent.SCAN_COMPLETED, {
				sourceId,
				logId,
				filesFound,
				filesAdded,
				filesUpdated,
				filesRemoved,
			});

			const scanElapsed = ((performance.now() - scanStartTime) / 1000).toFixed(2);
			this.logger.log(
				`Scan completed for ${source.path} in ${scanElapsed}s: found=${filesFound} added=${filesAdded} updated=${filesUpdated} removed=${filesRemoved}`,
			);

			// Follow-up work (metadata, thumbnails, …) is enqueued by listeners
			// of the importer's "added" events (e.g. LIBRARY_MOVIE_ADDED).
		} catch (err: any) {
			this.database.db
				.update(scanLog)
				.set({
					completedAt: nowISO(),
					status: 'failed',
					filesFound,
					filesAdded,
					filesUpdated,
					filesRemoved,
					errors: JSON.stringify([...errors, err.message]),
				})
				.where(eq(scanLog.id, logId))
				.run();

			this.events.emit(WsEvent.SCAN_ERROR, { sourceId, logId, error: err.message });
			const scanElapsed = ((performance.now() - scanStartTime) / 1000).toFixed(2);
			this.logger.error(
				`Scan failed for ${source.path} after ${scanElapsed}s: ${err.message}`,
			);
			throw err;
		}

		return { logId, filesFound, filesAdded, filesUpdated, filesRemoved };
	}

	/**
	 * Import one file, routed to the importer for its source's kind. Used by
	 * the watcher; `scanSource` calls the importer directly.
	 */
	async importFile(sourceId: string, filePath: string): Promise<ImportFileResult> {
		const source = this.getSourceRow(sourceId);
		const resolved = this.resolveImporter(source?.kind);
		if (!resolved.importer) return { status: 'error', reason: resolved.reason };
		return resolved.importer.importFile(sourceId, filePath);
	}

	// ── Movie-specific delegates (kept for existing callers) ───────────────

	purgeOrphanedMovies(): Promise<number> {
		return this.video.purgeOrphanedMovies();
	}

	rescanMovie(movieId: string) {
		return this.video.rescanMovie(movieId);
	}

	reprobeFileRow(file: { id: string; filePath: string; resolution?: string | null }) {
		return this.video.reprobeFileRow(file);
	}

	listUnprobedFiles() {
		return this.video.listUnprobedFiles();
	}

	parseFilename(filename: string) {
		return this.video.parseFilename(filename);
	}

	probeFile(filePath: string) {
		return this.video.probeFile(filePath);
	}

	/** Recursively yield files whose extension (dot-prefixed, any case) is in `extensions`. */
	async *walkDir(dirPath: string, extensions: readonly string[]): AsyncGenerator<string> {
		const extSet = new Set(
			extensions.map((e) => {
				const lower = e.toLowerCase();
				return lower.startsWith('.') ? lower : `.${lower}`;
			}),
		);
		yield* this.walk(dirPath, extSet);
	}

	private async *walk(dirPath: string, extSet: ReadonlySet<string>): AsyncGenerator<string> {
		let dir;
		try {
			dir = await opendir(dirPath);
		} catch {
			return;
		}

		for await (const entry of dir) {
			const fullPath = join(dirPath, entry.name);
			if (entry.isDirectory()) {
				yield* this.walk(fullPath, extSet);
			} else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (extSet.has(ext)) {
					yield fullPath;
				}
			}
		}
	}
}
