import { stat } from 'node:fs/promises';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@mu/shared';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, like } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { trackFiles, tracks } from '../../database/schema/index.js';
import { ImporterRegistry } from '../../library/importers/importer-registry.js';
import type { ImportFileResult, MediaImporter } from '../../library/importers/media-importer.js';
import { readTrackTags } from '../ingest/tags.js';
import { MusicJobsService } from '../jobs/music-jobs.service.js';
import { MusicEventsService } from '../music-events.service.js';
import { MusicCatalogService } from './catalog.service.js';

/**
 * MediaImporter for `audio` sources. The scanner/watcher hand it files; it
 * reads tags and writes the catalogue, then queues per-file follow-up work
 * (waveform, ingest-time transcode of unplayable formats).
 */
@Injectable()
export class AudioImporter implements MediaImporter, OnModuleInit {
	readonly kind = 'audio' as const;
	readonly extensions = SUPPORTED_AUDIO_EXTENSIONS.map((e) => `.${e}`);
	private readonly logger = new Logger('AudioImporter');

	constructor(
		private readonly registry: ImporterRegistry,
		private readonly database: DatabaseService,
		private readonly catalog: MusicCatalogService,
		private readonly jobs: MusicJobsService,
		private readonly musicEvents: MusicEventsService,
	) {}

	onModuleInit() {
		this.registry.register(this);
	}

	/** In-flight imports by path: the watcher and an upload finalize can race on one file. */
	private readonly inflight = new Map<string, Promise<ImportFileResult>>();

	importFile(sourceId: string, filePath: string): Promise<ImportFileResult> {
		const running = this.inflight.get(filePath);
		if (running) return running;
		const p = this.doImportFile(sourceId, filePath).finally(() =>
			this.inflight.delete(filePath),
		);
		this.inflight.set(filePath, p);
		return p;
	}

	private async doImportFile(sourceId: string, filePath: string): Promise<ImportFileResult> {
		try {
			const s = await stat(filePath);
			const file = { size: s.size, modifiedAt: s.mtime.toISOString() };
			const existing = this.database.db
				.select()
				.from(trackFiles)
				.where(eq(trackFiles.filePath, filePath))
				.get();
			if (existing) {
				if (
					existing.fileModifiedAt !== file.modifiedAt ||
					existing.fileSize !== file.size
				) {
					// Re-tagged or re-encoded: refresh stream facts, drop the stale waveform.
					this.catalog.refreshFile(existing.id, await readTrackTags(filePath), file);
					this.jobs.afterImport(existing.id);
					this.musicEvents.changed({ albumIds: [this.albumOf(existing.trackId)] });
				} else if (!existing.available) {
					this.database.db
						.update(trackFiles)
						.set({ available: true })
						.where(eq(trackFiles.id, existing.id))
						.run();
					this.musicEvents.changed({ albumIds: [this.albumOf(existing.trackId)] });
				}
				return { status: 'updated' };
			}

			const tags = await readTrackTags(filePath);
			const result = await this.catalog.ingest(sourceId, filePath, tags, file);
			if (result.status === 'skipped-duration') return { status: 'skipped-duration' };
			const tf = this.database.db
				.select({ id: trackFiles.id })
				.from(trackFiles)
				.where(eq(trackFiles.filePath, filePath))
				.get();
			if (tf) {
				this.jobs.afterImport(
					tf.id,
					result.status === 'added'
						? {
								trackId: result.trackId,
								albumId: result.albumId,
								newAlbum: result.newAlbum,
								title: tags.title,
							}
						: undefined,
				);
			}
			this.musicEvents.changed({ albumIds: [result.albumId] });
			return { status: 'added', entityId: result.trackId, title: tags.title };
		} catch (err) {
			const reason = (err as Error).message;
			this.logger.warn(`Import failed for ${filePath}: ${reason}`);
			return { status: 'error', reason };
		}
	}

	async markMissing(sourceId: string, foundPaths: ReadonlySet<string>): Promise<number> {
		const rows = this.database.db
			.select({ id: trackFiles.id, filePath: trackFiles.filePath })
			.from(trackFiles)
			.where(and(eq(trackFiles.sourceId, sourceId), eq(trackFiles.available, true)))
			.all();
		let n = 0;
		for (const r of rows) {
			if (!foundPaths.has(r.filePath)) {
				this.database.db
					.update(trackFiles)
					.set({ available: false })
					.where(eq(trackFiles.id, r.id))
					.run();
				n++;
			}
		}
		if (n) this.musicEvents.changed();
		return n;
	}

	private albumOf(trackId: string): string | null {
		return (
			this.database.db
				.select({ albumId: tracks.albumId })
				.from(tracks)
				.where(eq(tracks.id, trackId))
				.get()?.albumId ?? null
		);
	}

	async purgeOrphans(): Promise<number> {
		const missing = this.database.db
			.select({ id: trackFiles.id })
			.from(trackFiles)
			.where(eq(trackFiles.available, false))
			.all()
			.map((r) => r.id);
		const n = this.catalog.purgeOrphans(missing);
		if (n) this.musicEvents.changed();
		return n;
	}

	async handleFileRemoved(filePath: string): Promise<void> {
		const row = this.database.db
			.select({ id: trackFiles.id })
			.from(trackFiles)
			.where(eq(trackFiles.filePath, filePath))
			.get();
		if (row) {
			this.catalog.purgeOrphans([row.id]);
			this.musicEvents.changed();
		}
	}

	async handleDirectoryRemoved(dirPath: string): Promise<void> {
		const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
		const ids = this.database.db
			.select({ id: trackFiles.id })
			.from(trackFiles)
			.where(like(trackFiles.filePath, `${prefix}%`))
			.all()
			.map((r) => r.id);
		if (ids.length) {
			this.catalog.purgeOrphans(ids);
			this.musicEvents.changed();
		}
	}
}
