import { opendir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { nowISO, SUPPORTED_VIDEO_EXTENSIONS, WsEvent } from '@mu/shared';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { CacheService } from '../cache/cache.service.js';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { mediaSources, movieFiles, movies, scanLog } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { MoviesService } from '../movies/movies.service.js';
import { SettingsService } from '../settings/settings.service.js';

interface ParsedFilename {
	title: string;
	year?: number;
	quality?: string;
}

export type ImportFileResult =
	| { status: 'skipped-size' }
	| { status: 'updated' }
	| { status: 'added'; movieId: string; title: string }
	| { status: 'race-skipped' }
	| { status: 'error'; reason: string };

interface ProbeResult {
	codecVideo?: string;
	codecAudio?: string;
	resolution?: string;
	durationSeconds?: number;
	bitrate?: number;
	videoWidth?: number;
	videoHeight?: number;
	videoBitDepth?: number;
	videoFrameRate?: string;
	videoProfile?: string;
	videoColorSpace?: string;
	hdr?: boolean;
	containerFormat?: string;
	audioTracks?: {
		index: number;
		codec: string;
		language: string;
		title: string;
		channels: number;
		channelLayout: string;
		sampleRate?: number;
		bitDepth?: number;
	}[];
	subtitleTracks?: {
		index: number;
		codec: string;
		language: string;
		title: string;
		forced: boolean;
		external: boolean;
	}[];
}

@Injectable()
export class ScannerService {
	private readonly logger = new Logger('ScannerService');

	constructor(
		private readonly database: DatabaseService,
		readonly _config: ConfigService,
		private readonly events: EventsService,
		readonly _cache: CacheService,
		private readonly guidResolver: GuidResolverService,
		@Inject(forwardRef(() => MoviesService))
		private readonly moviesService: MoviesService,
		private readonly settings: SettingsService,
	) {}

	async scanSource(sourceId: string) {
		const source = this.database.db
			.select()
			.from(mediaSources)
			.where(eq(mediaSources.id, sourceId))
			.get();

		if (!source) {
			throw new Error(`Source ${sourceId} not found`);
		}

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
		this.logger.log(`Scan started for source: ${source.path}`);

		const scanStartTime = performance.now();

		let filesFound = 0;
		let filesAdded = 0;
		let filesUpdated = 0;
		let filesRemoved = 0;
		const errors: string[] = [];
		const foundPaths = new Set<string>();
		const newMovieIds: string[] = [];

		try {
			for await (const filePath of this.walkDir(source.path, SUPPORTED_VIDEO_EXTENSIONS)) {
				filesFound++;
				foundPaths.add(filePath);

				try {
					const result = await this.importFile(sourceId, filePath);
					if (result.status === 'updated') {
						filesUpdated++;
					} else if (result.status === 'added') {
						filesAdded++;
						newMovieIds.push(result.movieId);
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
			const dbFiles = this.database.db
				.select({ id: movieFiles.id, filePath: movieFiles.filePath })
				.from(movieFiles)
				.where(and(eq(movieFiles.sourceId, sourceId), eq(movieFiles.available, true)))
				.all();

			for (const dbFile of dbFiles) {
				if (!foundPaths.has(dbFile.filePath)) {
					this.database.db
						.update(movieFiles)
						.set({ available: false })
						.where(eq(movieFiles.id, dbFile.id))
						.run();
					filesRemoved++;
				}
			}

			// Clean up movies with no remaining available files
			await this.purgeOrphanedMovies();

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

			// Metadata + thumbnail jobs are now enqueued automatically by
			// LibraryJobsService when it receives LIBRARY_MOVIE_ADDED events.
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
	 * Import a single file into the library. Single source of truth for
	 * scanner.scanSource and watcher.handleFileAdded — both must use this so
	 * the min-file-size filter, probe step, and movies+movieFiles atomic
	 * insert behave identically.
	 *
	 * Returns:
	 *   - 'skipped-size'  — file is below the user's minFileSizeMB threshold
	 *   - 'updated'       — existing movieFile row touched (size/mtime/available)
	 *   - 'added'         — new movie + movieFile created
	 *   - 'race-skipped'  — another process won the unique-filePath insert
	 *   - 'error'         — unexpected failure, see reason
	 *
	 * On 'race-skipped' or any rollback, no movies-row orphan is left behind:
	 * both inserts run inside a SQLite transaction, so a UNIQUE-constraint
	 * failure on movie_files.file_path rolls back the movies-row insert too.
	 */
	async importFile(sourceId: string, filePath: string): Promise<ImportFileResult> {
		const fileStat = await stat(filePath);
		const fileName = basename(filePath);
		const fileModifiedAt = fileStat.mtime.toISOString();
		const fileSize = fileStat.size;

		// 1. Skip junk/promo files under the configured minimum size.
		const lib = this.settings.get<Record<string, unknown>>('library', {}) as any;
		const minSizeMB = lib?.minFileSizeMB ?? 50;
		if (minSizeMB > 0 && fileSize < minSizeMB * 1024 * 1024) {
			return { status: 'skipped-size' };
		}

		// 2. If we already have a row for this exact path, just touch it.
		const existing = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.filePath, filePath))
			.get();

		if (existing) {
			if (existing.fileModifiedAt !== fileModifiedAt || existing.fileSize !== fileSize) {
				this.database.db
					.update(movieFiles)
					.set({ fileSize, fileModifiedAt, available: true })
					.where(eq(movieFiles.id, existing.id))
					.run();
			} else if (!existing.available) {
				this.database.db
					.update(movieFiles)
					.set({ available: true })
					.where(eq(movieFiles.id, existing.id))
					.run();
			}
			return { status: 'updated' };
		}

		// 3. New file. Probe before opening the transaction so the FFprobe
		//    work doesn't hold a write lock.
		const parsed = this.parseFilename(fileName);
		const probeInfo = await this.probeFile(filePath);
		const movieId = crypto.randomUUID();
		const movieNow = nowISO();

		// 4. Insert movies + movieFiles atomically. If another process raced
		//    us and won the UNIQUE(file_path) insert, the transaction throws
		//    and BOTH inserts roll back — no orphan movies row.
		try {
			this.database.db.transaction((tx) => {
				tx.insert(movies)
					.values({
						id: movieId,
						title: parsed.title,
						year: parsed.year ?? null,
						runtimeMinutes:
							probeInfo.durationSeconds && probeInfo.durationSeconds > 0
								? Math.round(probeInfo.durationSeconds / 60)
								: null,
						addedAt: movieNow,
						updatedAt: movieNow,
					})
					.run();

				tx.insert(movieFiles)
					.values({
						id: crypto.randomUUID(),
						movieId,
						sourceId,
						filePath,
						fileName,
						fileSize,
						resolution: parsed.quality ?? probeInfo.resolution ?? null,
						codecVideo: probeInfo.codecVideo ?? null,
						codecAudio: probeInfo.codecAudio ?? null,
						durationSeconds: probeInfo.durationSeconds ?? null,
						bitrate: probeInfo.bitrate ?? null,
						videoWidth: probeInfo.videoWidth ?? null,
						videoHeight: probeInfo.videoHeight ?? null,
						videoBitDepth: probeInfo.videoBitDepth ?? null,
						videoFrameRate: probeInfo.videoFrameRate ?? null,
						videoProfile: probeInfo.videoProfile ?? null,
						videoColorSpace: probeInfo.videoColorSpace ?? null,
						hdr: probeInfo.hdr ?? false,
						containerFormat: probeInfo.containerFormat ?? null,
						audioTracks: probeInfo.audioTracks
							? JSON.stringify(probeInfo.audioTracks)
							: '[]',
						subtitleTracks: probeInfo.subtitleTracks
							? JSON.stringify(probeInfo.subtitleTracks)
							: '[]',
						available: true,
						addedAt: movieNow,
						fileModifiedAt,
					})
					.run();
			});
		} catch (err: any) {
			// UNIQUE constraint failure means another worker (this process or
			// a duplicate server instance — see CLAUDE.md "multi-process") got
			// to it first. Treat as a benign race; the winner's row is canonical.
			const msg = String(err?.message ?? err);
			if (msg.includes('UNIQUE constraint failed')) {
				return { status: 'race-skipped' };
			}
			return { status: 'error', reason: msg };
		}

		this.events.emit(WsEvent.LIBRARY_MOVIE_ADDED, {
			movieId,
			title: parsed.title,
		});
		return { status: 'added', movieId, title: parsed.title };
	}

	/**
	 * Delete every *library* row that no longer has at least one available
	 * file attached. Runs at the end of every scan AND on server startup
	 * (see LibraryJobsService) to mop up orphans created by past races.
	 *
	 * Scoped to `source` library/NULL on purpose. `external` and `bookmark`
	 * rows are file-less by definition — they're TMDB titles the user hasn't
	 * got — so an unscoped purge deleted every one of them on each scan,
	 * silently destroying saved bookmarks and any Discover harvest. "Orphan"
	 * here means "a scanned movie whose file vanished", not "has no file".
	 */
	async purgeOrphanedMovies(): Promise<number> {
		const orphanedMovies = this.database.db
			.select({ id: movies.id, title: movies.title })
			.from(movies)
			.leftJoin(
				movieFiles,
				and(eq(movieFiles.movieId, movies.id), eq(movieFiles.available, true)),
			)
			.where(
				and(isNull(movieFiles.id), or(isNull(movies.source), eq(movies.source, 'library'))),
			)
			.all();

		for (const orphan of orphanedMovies) {
			await this.moviesService.purgeMovie(orphan.id);
		}

		if (orphanedMovies.length > 0) {
			this.logger.log(
				`Purged ${orphanedMovies.length} orphaned movie(s) with no available files`,
			);
		}
		return orphanedMovies.length;
	}

	parseFilename(filename: string): ParsedFilename {
		const ext = extname(filename);
		const name = filename.replace(ext, '');

		// Try "Movie Name (2020)" pattern
		const parenYear = name.match(/^(.+?)\s*\((\d{4})\)/);
		if (parenYear?.[1] && parenYear[2]) {
			return {
				title: parenYear[1].trim(),
				year: parseInt(parenYear[2], 10),
				quality: this.extractQuality(name),
			};
		}

		// Try "Movie.Name.2020.1080p" or "Movie Name 2020 1080p" pattern
		const dotYear = name.match(/^(.+?)[.\s](\d{4})[.\s]/);
		if (dotYear?.[1] && dotYear[2]) {
			const title = dotYear[1].replace(/\./g, ' ').trim();
			return {
				title,
				year: parseInt(dotYear[2], 10),
				quality: this.extractQuality(name),
			};
		}

		// Try year at end: "Movie Name 2020"
		const endYear = name.match(/^(.+?)\s+(\d{4})$/);
		if (endYear?.[1] && endYear[2]) {
			return {
				title: endYear[1].replace(/\./g, ' ').trim(),
				year: parseInt(endYear[2], 10),
			};
		}

		// No year found - clean up the title
		return {
			title: name.replace(/\./g, ' ').replace(/\s+/g, ' ').trim(),
			quality: this.extractQuality(name),
		};
	}

	private extractQuality(name: string): string | undefined {
		const match = name.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
		return match?.[1]?.toLowerCase();
	}

	/**
	 * Re-probe all files for a given movie and update their codec/duration info.
	 */
	async rescanMovie(movieId: string) {
		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.all();

		if (files.length === 0) {
			throw new Error(`No files found for movie ${movieId}`);
		}

		const results: { fileId: string; fileName: string | null; updated: boolean }[] = [];

		for (const file of files) {
			const updated = await this.reprobeFileRow(file);
			results.push({ fileId: file.id, fileName: file.fileName, updated });
		}

		this.logger.log(
			`Rescanned ${results.length} file(s) for movie ${this.guidResolver.resolve(movieId)}`,
		);
		return { files: results };
	}

	/**
	 * Re-probe a single movie_files row in place and persist the codec/stream
	 * fields. Returns true when the probe yields usable info and the row is
	 * updated. Shared by rescanMovie, the unprobed-file backfill, and the
	 * probe-on-demand path that runs before a transcode/convert job decides.
	 */
	async reprobeFileRow(file: {
		id: string;
		filePath: string;
		resolution?: string | null;
	}): Promise<boolean> {
		const probeInfo = await this.probeFile(file.filePath);
		if (!(probeInfo.codecVideo || probeInfo.codecAudio || probeInfo.resolution)) {
			return false;
		}
		this.database.db
			.update(movieFiles)
			.set({
				codecVideo: probeInfo.codecVideo ?? null,
				codecAudio: probeInfo.codecAudio ?? null,
				resolution: probeInfo.resolution ?? file.resolution ?? null,
				durationSeconds: probeInfo.durationSeconds ?? null,
				bitrate: probeInfo.bitrate ?? null,
				videoWidth: probeInfo.videoWidth ?? null,
				videoHeight: probeInfo.videoHeight ?? null,
				videoBitDepth: probeInfo.videoBitDepth ?? null,
				videoFrameRate: probeInfo.videoFrameRate ?? null,
				videoProfile: probeInfo.videoProfile ?? null,
				videoColorSpace: probeInfo.videoColorSpace ?? null,
				hdr: probeInfo.hdr ?? false,
				containerFormat: probeInfo.containerFormat ?? null,
				audioTracks: probeInfo.audioTracks ? JSON.stringify(probeInfo.audioTracks) : '[]',
				subtitleTracks: probeInfo.subtitleTracks
					? JSON.stringify(probeInfo.subtitleTracks)
					: '[]',
			})
			.where(eq(movieFiles.id, file.id))
			.run();
		return true;
	}

	/** Available files that were never successfully probed (null codec_video). */
	listUnprobedFiles() {
		return this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.available, true), isNull(movieFiles.codecVideo)))
			.all();
	}

	/**
	 * Use FFprobe to extract codec, resolution, duration, bitrate, and detailed
	 * stream info from a file. Returns partial info on failure so scanning can continue.
	 */
	async probeFile(filePath: string): Promise<ProbeResult> {
		return new Promise((resolve) => {
			ffmpeg.ffprobe(filePath, (err, metadata) => {
				if (err) {
					this.logger.warn(`FFprobe failed for ${basename(filePath)}: ${err.message}`);
					resolve({});
					return;
				}

				const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
				const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

				const width = videoStream?.width;
				const height = videoStream?.height;
				let resolution: string | undefined;
				if (height) {
					if (height >= 2160) resolution = '2160p';
					else if (height >= 1080) resolution = '1080p';
					else if (height >= 720) resolution = '720p';
					else if (height >= 480) resolution = '480p';
					else resolution = `${height}p`;
				}

				// HDR detection from color transfer/space
				const colorTransfer = (videoStream as any)?.color_transfer ?? '';
				const colorSpace = (videoStream as any)?.color_space ?? '';
				const hdr =
					colorTransfer === 'smpte2084' ||
					colorTransfer === 'arib-std-b67' ||
					colorSpace === 'bt2020nc' ||
					colorSpace === 'bt2020c';

				// Audio tracks
				const audioStreams = (metadata.streams ?? []).filter(
					(s) => s.codec_type === 'audio',
				);
				const audioTracks = audioStreams.map((s, i) => ({
					index: i,
					codec: s.codec_name ?? 'unknown',
					language: (s as any).tags?.language ?? 'und',
					title: (s as any).tags?.title ?? `Track ${i + 1}`,
					channels: (s as any).channels ?? 0,
					channelLayout: (s as any).channel_layout ?? '',
					sampleRate: (s as any).sample_rate ? Number((s as any).sample_rate) : undefined,
					bitDepth: (s as any).bits_per_raw_sample
						? parseInt((s as any).bits_per_raw_sample, 10)
						: undefined,
				}));

				// Subtitle tracks
				const subtitleStreams = (metadata.streams ?? []).filter(
					(s) => s.codec_type === 'subtitle',
				);
				const subtitleTracks = subtitleStreams.map((s, i) => ({
					index: i,
					codec: s.codec_name ?? 'unknown',
					language: (s as any).tags?.language ?? 'und',
					title: (s as any).tags?.title ?? `Track ${i + 1}`,
					forced: (s as any).disposition?.forced === 1,
					external: false,
				}));

				resolve({
					codecVideo: videoStream?.codec_name ?? undefined,
					codecAudio: audioStream?.codec_name ?? undefined,
					resolution,
					durationSeconds: metadata.format?.duration
						? Math.round(metadata.format.duration)
						: undefined,
					bitrate: metadata.format?.bit_rate
						? Math.round(Number(metadata.format.bit_rate))
						: undefined,
					videoWidth: width,
					videoHeight: height,
					videoBitDepth: (videoStream as any)?.bits_per_raw_sample
						? parseInt((videoStream as any).bits_per_raw_sample, 10)
						: undefined,
					videoFrameRate: this.parseFrameRate((videoStream as any)?.r_frame_rate),
					videoProfile:
						videoStream?.profile != null ? String(videoStream.profile) : undefined,
					videoColorSpace: colorSpace || undefined,
					hdr,
					containerFormat: metadata.format?.format_name ?? undefined,
					audioTracks,
					subtitleTracks,
				});
			});
		});
	}

	private parseFrameRate(rFrameRate?: string): string | undefined {
		if (!rFrameRate) return undefined;
		const parts = rFrameRate.split('/');
		if (parts.length !== 2) return rFrameRate;
		const num = Number(parts[0]);
		const den = Number(parts[1]);
		if (!den) return rFrameRate;
		return (num / den).toFixed(3);
	}

	async *walkDir(dirPath: string, extensions: readonly string[]): AsyncGenerator<string> {
		const extSet = new Set(extensions.map((e) => e.toLowerCase()));
		let dir;
		try {
			dir = await opendir(dirPath);
		} catch {
			return;
		}

		for await (const entry of dir) {
			const fullPath = join(dirPath, entry.name);
			if (entry.isDirectory()) {
				yield* this.walkDir(fullPath, extensions);
			} else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (extSet.has(ext)) {
					yield fullPath;
				}
			}
		}
	}
}
