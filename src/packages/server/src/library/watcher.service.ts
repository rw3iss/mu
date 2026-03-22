import { basename, extname } from 'node:path';
import { nowISO, SUPPORTED_VIDEO_EXTENSIONS, WsEvent } from '@mu/shared';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import chokidar, { type FSWatcher } from 'chokidar';
import { and, eq, like, sql } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { mediaSources, movieFiles } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { MoviesService } from '../movies/movies.service.js';
import { SubtitleService } from '../stream/subtitles/subtitle.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';
import { ScannerService } from './scanner.service.js';

@Injectable()
export class WatcherService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger('WatcherService');
	private watchers = new Map<string, FSWatcher>();
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly extSet = new Set(SUPPORTED_VIDEO_EXTENSIONS.map((e) => e.toLowerCase()));

	constructor(
		private readonly database: DatabaseService,
		private readonly scanner: ScannerService,
		private readonly config: ConfigService,
		private readonly events: EventsService,
		@Inject(forwardRef(() => MoviesService))
		private readonly moviesService: MoviesService,
		private readonly transcoderService: TranscoderService,
		private readonly subtitleService: SubtitleService,
	) {}

	async onModuleInit() {
		const watchEnabled = this.config.get<boolean>('library.watchEnabled', true);
		if (!watchEnabled) {
			this.logger.log('File watching disabled by configuration');
			return;
		}

		await this.refreshWatchers();
		this.logger.log('File watcher service initialized');
	}

	onModuleDestroy() {
		for (const [sourceId, watcher] of this.watchers) {
			watcher.close();
			this.logger.log(`Watcher closed for source ${sourceId}`);
		}
		this.watchers.clear();

		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
	}

	async refreshWatchers() {
		// Close existing watchers
		for (const watcher of this.watchers.values()) {
			await watcher.close();
		}
		this.watchers.clear();

		const sources = this.database.db
			.select()
			.from(mediaSources)
			.where(eq(mediaSources.enabled, true))
			.all();

		for (const source of sources) {
			this.createWatcher(source.id, source.path);
		}

		this.logger.log(`Watching ${sources.length} media source(s)`);
	}

	private createWatcher(sourceId: string, sourcePath: string) {
		const watcher = chokidar.watch(sourcePath, {
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
			depth: 10,
		});

		watcher.on('add', (filePath: string) => {
			const ext = extname(filePath).toLowerCase();
			if (!this.extSet.has(ext)) return;

			// Debounce file additions
			const key = `add:${filePath}`;
			if (this.debounceTimers.has(key)) {
				clearTimeout(this.debounceTimers.get(key));
			}

			this.debounceTimers.set(
				key,
				setTimeout(() => {
					this.debounceTimers.delete(key);
					this.handleFileAdded(sourceId, filePath).catch((err) => {
						this.logger.error(`Error handling added file ${filePath}: ${err.message}`);
					});
				}, 2000),
			);
		});

		watcher.on('unlink', (filePath: string) => {
			const ext = extname(filePath).toLowerCase();
			if (!this.extSet.has(ext)) return;

			this.handleFileRemoved(filePath).catch((err) => {
				this.logger.error(`Error handling removed file ${filePath}: ${err.message}`);
			});
		});

		watcher.on('unlinkDir', (dirPath: string) => {
			this.handleDirectoryRemoved(dirPath).catch((err) => {
				this.logger.error(`Error handling removed directory ${dirPath}: ${(err as Error).message}`);
			});
		});

		watcher.on('error', (err: unknown) => {
			this.logger.error(`Watcher error for ${sourcePath}: ${(err as Error).message}`);
		});

		this.watchers.set(sourceId, watcher);
		this.logger.log(`Watching directory: ${sourcePath}`);
	}

	private async handleFileAdded(sourceId: string, filePath: string) {
		const fileName = basename(filePath);
		this.logger.log(`New file detected: ${fileName}`);

		const existing = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.filePath, filePath))
			.get();

		if (existing) {
			if (!existing.available) {
				this.database.db
					.update(movieFiles)
					.set({ available: true })
					.where(eq(movieFiles.id, existing.id))
					.run();
			}
			return;
		}

		// Trigger a scan for the source to properly add the file
		const { stat: statFn } = await import('node:fs/promises');
		const fileStat = await statFn(filePath);
		const parsed = this.scanner.parseFilename(fileName);
		const now = nowISO();

		const { movies: moviesTable } = await import('../database/schema/index.js');
		const movieId = crypto.randomUUID();

		this.database.db
			.insert(moviesTable)
			.values({
				id: movieId,
				title: parsed.title,
				year: parsed.year ?? null,
				addedAt: now,
				updatedAt: now,
			})
			.run();

		this.database.db
			.insert(movieFiles)
			.values({
				id: crypto.randomUUID(),
				movieId,
				sourceId,
				filePath,
				fileName,
				fileSize: fileStat.size,
				resolution: parsed.quality ?? null,
				available: true,
				addedAt: now,
				fileModifiedAt: fileStat.mtime.toISOString(),
			})
			.run();

		this.events.emit(WsEvent.LIBRARY_MOVIE_ADDED, { movieId, title: parsed.title });
		this.logger.log(`Added movie from watcher: ${parsed.title}`);
	}

	private async handleFileRemoved(filePath: string) {
		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.filePath, filePath), eq(movieFiles.available, true)))
			.get();

		if (!file) return;

		// Check if this is the last available file for the movie
		const otherAvailable = this.database.db
			.select({ c: sql<number>`COUNT(*)` })
			.from(movieFiles)
			.where(
				and(
					eq(movieFiles.movieId, file.movieId),
					eq(movieFiles.available, true),
					sql`${movieFiles.id} != ${file.id}`,
				),
			)
			.get();

		if (!otherAvailable || otherAvailable.c === 0) {
			// Last file — purge the entire movie
			await this.moviesService.purgeMovie(file.movieId);
			this.events.emit(WsEvent.LIBRARY_MOVIE_REMOVED, { movieId: file.movieId, filePath });
			this.logger.log(`Purged movie (last file removed): ${basename(filePath)}`);
		} else {
			// Other files remain — just mark unavailable and clean caches
			this.database.db
				.update(movieFiles)
				.set({ available: false })
				.where(eq(movieFiles.id, file.id))
				.run();
			await this.transcoderService.clearCache(file.id);
			await this.subtitleService.clearCache(file.id);
			this.events.emit(WsEvent.LIBRARY_MOVIE_REMOVED, { movieId: file.movieId, filePath });
			this.logger.log(`File marked unavailable: ${basename(filePath)}`);
		}
	}

	private async handleDirectoryRemoved(dirPath: string) {
		this.logger.log(`Directory removed: ${dirPath}`);

		// Find all available files whose path starts with the removed directory
		const affectedFiles = this.database.db
			.select({ id: movieFiles.id, movieId: movieFiles.movieId, filePath: movieFiles.filePath })
			.from(movieFiles)
			.where(and(like(movieFiles.filePath, `${dirPath}%`), eq(movieFiles.available, true)))
			.all();

		if (affectedFiles.length === 0) return;

		// Mark all affected files as unavailable
		for (const file of affectedFiles) {
			this.database.db
				.update(movieFiles)
				.set({ available: false })
				.where(eq(movieFiles.id, file.id))
				.run();
		}

		// Collect unique movie IDs
		const uniqueMovieIds = [...new Set(affectedFiles.map((f) => f.movieId))];

		// For each movie, check if any available files remain
		for (const movieId of uniqueMovieIds) {
			const remaining = this.database.db
				.select({ c: sql<number>`COUNT(*)` })
				.from(movieFiles)
				.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)))
				.get();

			if (!remaining || remaining.c === 0) {
				await this.moviesService.purgeMovie(movieId);
				this.events.emit(WsEvent.LIBRARY_MOVIE_REMOVED, { movieId, filePath: dirPath });
			}
		}

		this.logger.log(`Directory removal affected ${affectedFiles.length} file(s), ${uniqueMovieIds.length} movie(s)`);
	}
}
