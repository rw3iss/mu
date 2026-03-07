import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { basename, extname } from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { nowISO, SUPPORTED_VIDEO_EXTENSIONS, WsEvent } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { ScannerService } from './scanner.service.js';
import { ConfigService } from '../config/config.service.js';
import { EventsService } from '../events/events.service.js';
import { mediaSources, movieFiles } from '../database/schema/index.js';

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

      this.debounceTimers.set(key, setTimeout(() => {
        this.debounceTimers.delete(key);
        this.handleFileAdded(sourceId, filePath).catch((err) => {
          this.logger.error(`Error handling added file ${filePath}: ${err.message}`);
        });
      }, 2000));
    });

    watcher.on('unlink', (filePath: string) => {
      const ext = extname(filePath).toLowerCase();
      if (!this.extSet.has(ext)) return;

      this.handleFileRemoved(filePath).catch((err) => {
        this.logger.error(`Error handling removed file ${filePath}: ${err.message}`);
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
    const { stat: statFn } = await import('fs/promises');
    const fileStat = await statFn(filePath);
    const parsed = this.scanner.parseFilename(fileName);
    const now = nowISO();

    const { movies: moviesTable } = await import('../database/schema/index.js');
    const movieId = crypto.randomUUID();

    this.database.db.insert(moviesTable).values({
      id: movieId,
      title: parsed.title,
      year: parsed.year ?? null,
      addedAt: now,
      updatedAt: now,
    }).run();

    this.database.db.insert(movieFiles).values({
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
    }).run();

    this.events.emit(WsEvent.LIBRARY_MOVIE_ADDED, { movieId, title: parsed.title });
    this.logger.log(`Added movie from watcher: ${parsed.title}`);
  }

  private async handleFileRemoved(filePath: string) {
    const file = this.database.db
      .select()
      .from(movieFiles)
      .where(and(eq(movieFiles.filePath, filePath), eq(movieFiles.available, true)))
      .get();

    if (file) {
      this.database.db
        .update(movieFiles)
        .set({ available: false })
        .where(eq(movieFiles.id, file.id))
        .run();

      this.events.emit(WsEvent.LIBRARY_MOVIE_REMOVED, { movieId: file.movieId, filePath });
      this.logger.log(`File marked unavailable: ${basename(filePath)}`);
    }
  }
}
