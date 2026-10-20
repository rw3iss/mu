import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { nowISO, SUPPORTED_VIDEO_EXTENSIONS, WsEvent } from '@mu/shared';
import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, like, or, sql } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { SAFE_INPUT_OPTIONS } from '../../common/ffmpeg-input.js';
import { GuidResolverService } from '../../common/guid-resolver.service.js';
import { normalizeTitle } from '../../common/text-normalize.js';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, movies } from '../../database/schema/index.js';
import { EventsService } from '../../events/events.service.js';
import { MoviesService } from '../../movies/movies.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { SubtitleService } from '../../stream/subtitles/subtitle.service.js';
import { TranscoderService } from '../../stream/transcoder/transcoder.service.js';
import { ImporterRegistry } from './importer-registry.js';
import {
	type ImportFileResult,
	type MediaImporter,
	normalizeExtensions,
} from './media-importer.js';

interface ParsedFilename {
	title: string;
	year?: number;
	quality?: string;
}

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

/**
 * MediaImporter for kind `video` (movies). Owns everything movie-specific
 * about ingestion: size/runtime floors, ffprobe, filename parsing, the
 * movies + movie_files atomic insert, duplicate-title attach, orphan purge,
 * and watcher removal handling. Moved verbatim from ScannerService, which is
 * now the kind-agnostic scan orchestrator.
 */
@Injectable()
export class VideoImporter implements MediaImporter, OnModuleInit {
	private readonly logger = new Logger('VideoImporter');
	readonly kind = 'video' as const;
	readonly extensions: readonly string[] = normalizeExtensions(SUPPORTED_VIDEO_EXTENSIONS);

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
		private readonly guidResolver: GuidResolverService,
		@Inject(forwardRef(() => MoviesService))
		private readonly moviesService: MoviesService,
		private readonly settings: SettingsService,
		private readonly transcoderService: TranscoderService,
		private readonly subtitleService: SubtitleService,
		private readonly registry: ImporterRegistry,
	) {}

	onModuleInit() {
		this.registry.register(this);
	}

	/**
	 * Import a single file into the library. Single source of truth for
	 * the scan orchestrator and watcher.handleFileAdded — both must use this so
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
				// The bytes changed, so the stream layout may have too — MP4
				// conversion rewrites the file in place and can change the
				// audio/subtitle track set. Only touching size/mtime left the
				// old track JSON behind, so the player kept offering audio
				// tracks the file no longer contained (picking one did nothing).
				let probed: Partial<ProbeResult> = {};
				try {
					probed = await this.probeFile(filePath);
				} catch (err) {
					this.logger.warn(`Re-probe failed for ${filePath}: ${(err as Error).message}`);
				}
				this.database.db
					.update(movieFiles)
					.set({
						fileSize,
						fileModifiedAt,
						available: true,
						...(probed.audioTracks
							? { audioTracks: JSON.stringify(probed.audioTracks) }
							: {}),
						...(probed.subtitleTracks
							? { subtitleTracks: JSON.stringify(probed.subtitleTracks) }
							: {}),
						...(probed.codecVideo ? { codecVideo: probed.codecVideo } : {}),
						...(probed.codecAudio ? { codecAudio: probed.codecAudio } : {}),
						...(probed.containerFormat
							? { containerFormat: probed.containerFormat }
							: {}),
						...(probed.durationSeconds
							? { durationSeconds: probed.durationSeconds }
							: {}),
					})
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
		const movieNow = nowISO();

		// 3a. Skip clips below the configured minimum runtime. Size alone
		// doesn't catch these — a 1080p 4-minute "NC OP" or a BluRay extra can
		// clear the 50MB floor comfortably — so trailers, samples, music videos
		// and disc extras were being indexed as movies. Runtime is the honest
		// signal. 0 disables the check.
		const minDurationSeconds = (lib?.minDurationSeconds as number | undefined) ?? 300;
		if (
			minDurationSeconds > 0 &&
			probeInfo.durationSeconds != null &&
			probeInfo.durationSeconds > 0 &&
			probeInfo.durationSeconds < minDurationSeconds
		) {
			this.logger.debug(
				`Skipping short clip (${Math.round(probeInfo.durationSeconds)}s): ${fileName}`,
			);
			return { status: 'skipped-duration' };
		}

		// 3b. Does this title already exist? movie_files is one-to-many on
		// purpose — the same film can live on two drives, or in two qualities —
		// but ingestion always minted a fresh movies row per file path, so a
		// season copied to a second drive produced a duplicate entry for every
		// episode. Attach to the existing movie instead of duplicating it.
		const existingMovie = this.findMovieByTitleYear(
			parsed.title,
			parsed.year ?? null,
			probeInfo.durationSeconds ?? null,
		);
		if (existingMovie) {
			try {
				this.database.db
					.insert(movieFiles)
					.values(
						this.buildMovieFileRow({
							movieId: existingMovie.id,
							sourceId,
							filePath,
							fileName,
							fileSize,
							parsed,
							probeInfo,
							movieNow,
							fileModifiedAt,
						}),
					)
					.run();
			} catch (err: any) {
				// Lost a UNIQUE(file_path) race — another worker attached it.
				if (!String(err?.message ?? '').includes('UNIQUE')) throw err;
				return { status: 'updated' };
			}
			this.logger.debug(
				`Attached additional file to existing movie "${parsed.title}": ${fileName}`,
			);
			return {
				status: 'added',
				entityId: existingMovie.id,
				movieId: existingMovie.id,
				title: parsed.title,
			};
		}

		const movieId = crypto.randomUUID();

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
		return { status: 'added', entityId: movieId, movieId, title: parsed.title };
	}

	/** MediaImporter: orphan sweep (movies with no available file). */
	purgeOrphans(): Promise<number> {
		return this.purgeOrphanedMovies();
	}

	/** MediaImporter: flag this source's movie files that the walk didn't see. */
	async markMissing(sourceId: string, foundPaths: ReadonlySet<string>): Promise<number> {
		const dbFiles = this.database.db
			.select({ id: movieFiles.id, filePath: movieFiles.filePath })
			.from(movieFiles)
			.where(and(eq(movieFiles.sourceId, sourceId), eq(movieFiles.available, true)))
			.all();

		let removed = 0;
		for (const dbFile of dbFiles) {
			if (!foundPaths.has(dbFile.filePath)) {
				this.database.db
					.update(movieFiles)
					.set({ available: false })
					.where(eq(movieFiles.id, dbFile.id))
					.run();
				removed++;
			}
		}
		return removed;
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
			ffmpeg.ffprobe(filePath, [...SAFE_INPUT_OPTIONS], (err, metadata) => {
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

	/**
	 * Find an existing movie this file belongs to, matched on normalized title
	 * plus year.
	 *
	 * Deliberately strict: the year must agree (both set and equal, or both
	 * unset). Matching on title alone would fold remakes — "The Thing" 1982 and
	 * 2011 — into one entry. Episode filenames carry SxxExx in the title, so
	 * they're specific enough to match safely with a null year.
	 */
	private findMovieByTitleYear(
		title: string,
		year: number | null,
		durationSeconds: number | null,
	): { id: string } | null {
		const wanted = normalizeTitle(title);
		if (!wanted) return null;
		// Titles are parsed from the FILENAME, and scene releases routinely use
		// junk names — `Sample.mp4`, `ETRG.mp4` — so two unrelated films can
		// present the same title. Matching on title alone would merge them.
		if (!durationSeconds || durationSeconds <= 0) return null;

		const candidates = this.database.db
			.select({ id: movies.id, title: movies.title, year: movies.year })
			.from(movies)
			.where(
				and(
					year == null ? isNull(movies.year) : eq(movies.year, year),
					// Cheap prefilter; the authoritative compare is normalized.
					sql`lower(${movies.title}) = lower(${title})`,
				),
			)
			.all();

		for (const c of candidates) {
			if (normalizeTitle(c.title) !== wanted) continue;
			// Confirm it's the same CONTENT, not just the same name: every
			// existing file must run to within 2% (min 5s) of this one. That
			// separates a 53s sample from the feature, and Dune's theatrical
			// cut (8178s) from the extended one (10635s).
			const files = this.database.db
				.select({ durationSeconds: movieFiles.durationSeconds })
				.from(movieFiles)
				.where(eq(movieFiles.movieId, c.id))
				.all();
			const known = files.map((f) => f.durationSeconds ?? 0).filter((d) => d > 0);
			if (known.length === 0) continue;
			const tolerance = Math.max(5, durationSeconds * 0.02);
			if (known.every((d) => Math.abs(d - durationSeconds) <= tolerance)) {
				return { id: c.id };
			}
		}
		return null;
	}

	/** The movie_files row shape, shared by the new-movie and attach paths. */
	private buildMovieFileRow(args: {
		movieId: string;
		sourceId: string;
		filePath: string;
		fileName: string;
		fileSize: number;
		parsed: { quality?: string | null };
		probeInfo: any;
		movieNow: string;
		fileModifiedAt: string;
	}) {
		const { movieId, sourceId, filePath, fileName, fileSize, parsed, probeInfo } = args;
		return {
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
			audioTracks: probeInfo.audioTracks ? JSON.stringify(probeInfo.audioTracks) : '[]',
			subtitleTracks: probeInfo.subtitleTracks
				? JSON.stringify(probeInfo.subtitleTracks)
				: '[]',
			available: true,
			addedAt: args.movieNow,
			fileModifiedAt: args.fileModifiedAt,
		};
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

	/**
	 * Watcher: a movie file was deleted (offline-source guard already applied
	 * by the watcher). Last file → purge the movie; otherwise mark the file
	 * unavailable and drop its caches.
	 */
	async handleFileRemoved(filePath: string): Promise<void> {
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

	/** Watcher: a directory was deleted — unavailable-flag its files, purge emptied movies. */
	async handleDirectoryRemoved(dirPath: string): Promise<void> {
		this.logger.log(`Directory removed: ${dirPath}`);

		// Find all available files whose path starts with the removed directory
		const affectedFiles = this.database.db
			.select({
				id: movieFiles.id,
				movieId: movieFiles.movieId,
				filePath: movieFiles.filePath,
			})
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

		this.logger.log(
			`Directory removal affected ${affectedFiles.length} file(s), ${uniqueMovieIds.length} movie(s)`,
		);
	}
}
