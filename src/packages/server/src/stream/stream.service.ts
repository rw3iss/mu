import crypto from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { nowISO, StreamMode, WsEvent } from '@mu/shared';
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { GuidResolverService } from '../common/guid-resolver.service.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
	movieFiles,
	movies,
	streamSessions,
	transcodeCache,
	users,
	userWatchHistory,
} from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DirectPlayService } from './direct-play/direct-play.service.js';
import { SubtitleService } from './subtitles/subtitle.service.js';
import { ChunkManagerService } from './transcoder/chunk-manager.service.js';
import { TranscodeDebuggerService } from './transcoder/transcode-debugger.service.js';
import { TranscoderService } from './transcoder/transcoder.service.js';

interface StartStreamOptions {
	quality?: string;
	audioTrack?: number;
	subtitleTrack?: number;
}

/** Stale session timeout in minutes — sessions with no heartbeat for this long are reaped. */
const SESSION_TIMEOUT_MINUTES = 30;
/** How often to check for stale sessions (ms). */
const SESSION_REAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class StreamService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(StreamService.name);

	/** Maps sessionId → the directory where HLS segments live (persistent or ephemeral) */
	private readonly sessionDirs = new Map<string, string>();
	/** Track movieFileId and quality per session for chunk manager lookups */
	private readonly sessionInfo = new Map<string, { movieFileId: string; quality: string }>();

	/** Interval timer for reaping stale sessions */
	private reapInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly database: DatabaseService,
		readonly _config: ConfigService,
		private readonly events: EventsService,
		private readonly transcoderService: TranscoderService,
		readonly _directPlayService: DirectPlayService,
		private readonly subtitleService: SubtitleService,
		private readonly settings: SettingsService,
		private readonly chunkManager: ChunkManagerService,
		private readonly transcodeDebugger: TranscodeDebuggerService,
		private readonly guidResolver: GuidResolverService,
	) {}

	onModuleInit(): void {
		// Start the stale session reaper
		this.reapInterval = setInterval(() => {
			this.reapStaleSessions().catch((err) => {
				this.logger.error(`Session reaper error: ${err.message}`);
			});
		}, SESSION_REAP_INTERVAL_MS);
		this.logger.log(
			`Session reaper started (timeout: ${SESSION_TIMEOUT_MINUTES}min, interval: ${SESSION_REAP_INTERVAL_MS / 1000}s)`,
		);
	}

	onModuleDestroy(): void {
		if (this.reapInterval) {
			clearInterval(this.reapInterval);
			this.reapInterval = null;
		}
	}

	/**
	 * Reap stale sessions — sessions with no heartbeat/progress update
	 * for longer than SESSION_TIMEOUT_MINUTES.
	 */
	async reapStaleSessions(): Promise<number> {
		const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MINUTES * 60 * 1000).toISOString();

		const staleSessions = this.database.db
			.select()
			.from(streamSessions)
			.where(lt(streamSessions.lastActiveAt, cutoff))
			.all();

		if (staleSessions.length === 0) return 0;

		this.logger.log(
			`Reaping ${staleSessions.length} stale session(s) (last active before ${cutoff})`,
		);

		let reaped = 0;
		for (const session of staleSessions) {
			try {
				await this.endStream(session.id);
				reaped++;
				this.logger.log(`Reaped stale session ${this.guidResolver.resolve(session.id)} (movie: ${this.guidResolver.resolve(session.movieId)})`);
			} catch (err: any) {
				this.logger.warn(`Failed to reap session ${this.guidResolver.resolve(session.id)}: ${err.message}`);
			}
		}

		return reaped;
	}

	/**
	 * Get the stream mode for a movie without starting a session.
	 * Used to show "needs transcode" indicators on movie cards.
	 */
	async getMovieStreamInfo(movieId: string): Promise<{
		streamMode: string;
		needsTranscode: boolean;
		hasCache: boolean;
		codecVideo: string | null;
		codecAudio: string | null;
		videoHeight: number | null;
	} | null> {
		const fileList = await this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)));

		if (fileList.length === 0) return null;

		const file = this.selectBestFile(fileList);
		const mode = this.determineStreamMode(file);
		const quality = this.resolveDefaultQuality(file.id, file.videoHeight);

		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const persistEnabled = (lib as any)?.persistTranscodes !== false;
		const hasCache =
			persistEnabled && (await this.transcoderService.hasCachedTranscode(file.id, quality));

		return {
			streamMode: mode,
			needsTranscode: mode === StreamMode.TRANSCODE || mode === StreamMode.DIRECT_STREAM,
			hasCache,
			codecVideo: file.codecVideo,
			codecAudio: file.codecAudio,
			videoHeight: file.videoHeight,
		};
	}

	async startStream(movieId: string, userId: string, options: StartStreamOptions = {}) {
		const movieFileList = await this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)));

		if (movieFileList.length === 0) {
			// Check if there are unavailable files (file removed from disk / mount missing)
			const allFiles = await this.database.db
				.select({ id: movieFiles.id, filePath: movieFiles.filePath })
				.from(movieFiles)
				.where(eq(movieFiles.movieId, movieId));

			if (allFiles.length > 0) {
				this.logger.warn(
					`Movie ${this.guidResolver.resolve(movieId)} has ${allFiles.length} file(s) but none are available. ` +
						`Paths: ${allFiles.map((f) => f.filePath).join(', ')}`,
				);
				throw new NotFoundException(
					'The source file for this movie is not currently accessible. ' +
						'It may have been moved or the storage is disconnected. Try running a library scan.',
				);
			}

			throw new NotFoundException(`No file found for movie ${this.guidResolver.resolve(movieId)}`);
		}

		// Pick the best available file (prefer highest resolution)
		const file = this.selectBestFile(movieFileList);

		// Warm up GUID resolver with movie and file names
		const movieRow = this.database.db
			.select({ title: movies.title })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		const movieTitle = movieRow?.title ?? file.fileName ?? 'Unknown';
		this.guidResolver.warmup(movieId, movieTitle);
		this.guidResolver.warmup(file.id, movieTitle);

		// Verify the file has actual content (not empty/corrupt)
		try {
			const stat = statSync(file.filePath);
			if (stat.size < 1024) {
				this.logger.warn(`File is empty or corrupt (${stat.size} bytes): ${file.filePath}`);
				throw new BadRequestException(
					'The video file appears to be empty or corrupt (0 bytes). ' +
						'It may not have finished downloading or was saved incorrectly.',
				);
			}
		} catch (err: any) {
			if (err instanceof BadRequestException) throw err;
			this.logger.warn(`Cannot stat file ${file.filePath}: ${err.message}`);
			throw new NotFoundException(
				'The source file for this movie is not currently accessible. ' +
					'It may have been moved or the storage is disconnected.',
			);
		}

		// Determine stream mode based on container, video codec, and audio codec
		const mode = this.determineStreamMode(file);

		const sessionId = crypto.randomUUID();
		this.guidResolver.warmup(sessionId, movieTitle);
		const quality = options.quality || this.resolveDefaultQuality(file.id, file.videoHeight);

		// Skip session tracking for shared/anonymous streams (__shared__ has no DB user record)
		if (userId !== '__shared__') {
			await this.database.db.insert(streamSessions).values({
				id: sessionId,
				movieId,
				userId,
				movieFileId: file.id,
				quality,
				transcoding: mode !== StreamMode.DIRECT_PLAY,
				startedAt: nowISO(),
				lastActiveAt: nowISO(),
				positionSeconds: 0,
			});
		}

		// Start debug session
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		this.transcodeDebugger.startSession(sessionId, file.id, {
			filePath: file.filePath,
			codecVideo: file.codecVideo ?? undefined,
			codecAudio: file.codecAudio ?? undefined,
			resolution: `${file.videoWidth ?? '?'}x${file.videoHeight ?? '?'}`,
			durationSeconds: file.durationSeconds ?? undefined,
			fileSizeBytes: file.fileSize ?? undefined,
		}, {
			quality,
			preset: enc?.preset,
			hwAccel: enc?.hwAccel,
			videoCodec: enc?.videoCodec,
			rateControl: enc?.rateControl,
			crf: enc?.crf,
			mode,
		});
		this.transcodeDebugger.recordMilestone(sessionId, 'requestReceived');

		// Extract subtitles — use stored track info from DB to skip FFprobe
		let subtitleTracks: { index: number; language: string; title: string }[] = [];
		try {
			let storedTracks:
				| { index: number; language?: string; title?: string; codec?: string }[]
				| undefined;
			if (file.subtitleTracks) {
				try {
					storedTracks = JSON.parse(file.subtitleTracks as string);
				} catch {}
			}
			subtitleTracks = await this.subtitleService.extractSubtitles(
				file.filePath,
				file.id,
				storedTracks,
			);
		} catch (err) {
			this.logger.warn(`Failed to extract subtitles for file ${this.guidResolver.resolve(file.id)}: ${err}`);
		}

		// Start transcode or remux pipeline as needed
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const persistEnabled = (lib as any)?.persistTranscodes !== false;
		let hasCached = false;

		if (mode === StreamMode.TRANSCODE || mode === StreamMode.DIRECT_STREAM) {
			const persistDir = this.transcoderService.getPersistentDir(file.id, quality);

			// Validate existing cache before using it
			let cacheState: 'complete' | 'partial' | 'invalid' | 'empty' = 'empty';
			if (persistEnabled) {
				cacheState = await this.transcoderService.validateCache(file.id, quality);
			}

			this.transcodeDebugger.recordEvent(sessionId, 'cache_state', `Cache state: ${cacheState}`);

			if (cacheState === 'invalid') {
				// Old or broken cache — clear it so we can start fresh
				this.logger.warn(
					`Invalid cache detected for ${this.guidResolver.resolve(file.id)}/${quality}, clearing and re-transcoding`,
				);
				await this.transcoderService.clearCache(file.id);
				cacheState = 'empty';
			}

			if (cacheState === 'complete') {
				hasCached = true;
				this.sessionDirs.set(sessionId, persistDir);
				this.logger.log(`Using cached transcode for session=${this.guidResolver.resolve(sessionId)}, file=${this.guidResolver.resolve(file.id)}`);
			} else if (cacheState === 'partial') {
				// Partial cache exists — check if chunk manager or monolithic is handling it
				const hasChunkMeta = this.chunkManager.getChunkMap(file.id, quality);
				if (hasChunkMeta || this.chunkManager.isEnabled()) {
					// Chunk system will handle it
				} else {
					// Legacy partial — playable if enough segments
					const playable = await this.transcoderService.hasPlayablePartialCache(
						file.id,
						quality,
					);
					if (playable) {
						this.sessionDirs.set(sessionId, persistDir);
						hasCached = true;
						this.logger.log(
							`Using in-progress partial cache for session=${this.guidResolver.resolve(sessionId)}, file=${this.guidResolver.resolve(file.id)}`,
						);
					}
				}
			}

			if (!hasCached) {
				// Pause background encoding — live stream gets all FFmpeg capacity
				this.chunkManager.pauseBackground();

				// Use monolithic FFmpeg for live playback (fastest startup: 1-2s)
				// Uses 'ultrafast' preset for real-time encoding speed
				const outputDir = persistEnabled ? persistDir : undefined;
				if (outputDir) {
					this.sessionDirs.set(sessionId, persistDir);
				}

				if (mode === StreamMode.TRANSCODE) {
					try {
						await this.transcoderService.startTranscode(
							sessionId,
							file.filePath,
							{
								quality,
								audioTrack: options.audioTrack,
								subtitleTrack: options.subtitleTrack,
								livePlayback: true,
							},
							outputDir,
						);
					} catch (transcodeErr: any) {
						this.logger.error(`Transcode failed: ${transcodeErr.message}`);
						this.chunkManager.resumeBackground();
						throw new BadRequestException('Unable to play this file.');
					}
				} else {
					try {
						await this.transcoderService.startRemux(sessionId, file.filePath, outputDir);
					} catch (remuxErr: any) {
						this.logger.warn(`Remux failed, falling back: ${remuxErr.message}`);
						if (outputDir) {
							await this.transcoderService.cleanup(sessionId);
							this.sessionDirs.set(sessionId, outputDir);
						}
						try {
							await this.transcoderService.startTranscode(
								sessionId, file.filePath,
								{ quality, audioTrack: options.audioTrack, subtitleTrack: options.subtitleTrack, livePlayback: true },
								outputDir,
							);
						} catch (e2: any) {
							this.chunkManager.resumeBackground();
							throw new BadRequestException('Unable to play this file.');
						}
					}
				}
			}
		}

		// Look up resume position from watch history, and ensure a history
		// entry exists (so the movie appears in history immediately on play).
		// Skip for shared/anonymous sessions — __shared__ user has no DB record.
		let resumePosition = 0;
		if (userId !== '__shared__') {
			const historyRows = await this.database.db
				.select()
				.from(userWatchHistory)
				.where(
					and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, movieId)),
				);

			if (historyRows.length > 0) {
				resumePosition = historyRows[0]!.positionSeconds ?? 0;
				// Touch watchedAt so it sorts to the top of history
				await this.database.db
					.update(userWatchHistory)
					.set({ watchedAt: nowISO() })
					.where(eq(userWatchHistory.id, historyRows[0]!.id));
			} else {
				// Create history entry immediately on play
				await this.database.db.insert(userWatchHistory).values({
					id: crypto.randomUUID(),
					userId,
					movieId,
					positionSeconds: 0,
					durationWatchedSeconds: 0,
					watchedAt: nowISO(),
				});
			}
		}

		// Build stream URL based on mode
		const directPlay = mode === StreamMode.DIRECT_PLAY;
		let streamUrl: string;
		if (directPlay) {
			streamUrl = `/api/v1/stream/direct/${file.id}`;
		} else {
			// Both TRANSCODE and DIRECT_STREAM use HLS manifest
			streamUrl = `/api/v1/stream/${sessionId}/manifest.m3u8`;
		}

		// Store session info for chunk manager lookups
		this.sessionInfo.set(sessionId, { movieFileId: file.id, quality });

		this.events.emit(WsEvent.STREAM_STARTED, {
			sessionId,
			movieId,
			userId,
			mode,
		});

		const resolvedDir =
			this.sessionDirs.get(sessionId) || this.transcoderService.getSessionDir(sessionId);
		this.logger.log(
			`Stream started: session=${this.guidResolver.resolve(sessionId)}, movie=${this.guidResolver.resolve(movieId)}, file=${this.guidResolver.resolve(file.id)}, mode=${mode}, quality=${quality}, segmentDir=${resolvedDir}`,
		);

		// Direct play and cached transcodes are ready immediately;
		// live transcodes need time for ffmpeg to produce the first segment.
		const ready = directPlay || (mode !== StreamMode.DIRECT_PLAY && hasCached);

		// Parse audio tracks from file metadata
		const audioTracks = this.parseAudioTracks(file);

		// Build available quality options (capped at source resolution)
		const qualities = this.getAvailableQualities(file.videoHeight);

		return {
			sessionId,
			movieId,
			streamUrl,
			streamMode: mode,
			directPlay,
			ready,
			format: directPlay ? 'native' : 'hls',
			quality,
			subtitles: subtitleTracks.map((t, i) => {
				const lang = (t.language || 'und').toUpperCase();
				const title =
					t.title && t.title !== `Track ${t.index}` && t.title !== t.language
						? t.title
						: null;
				const label = title ? `${lang} — ${title}` : `${lang} (Track ${i + 1})`;
				return {
					id: String(t.index),
					label,
					language: t.language,
					url: `/api/v1/stream/${sessionId}/subtitles/${t.index}.vtt`,
				};
			}),
			audioTracks,
			qualities,
			startPosition: resumePosition,
			durationSeconds: file.durationSeconds ?? null,
		};
	}

	/**
	 * Restart transcoding from a new seek position.
	 * Stops the current FFmpeg, cleans up ephemeral segments, and restarts from the given time.
	 */
	async seekStream(sessionId: string, positionSeconds: number): Promise<void> {
		const session = await this.database.db
			.select()
			.from(streamSessions)
			.where(eq(streamSessions.id, sessionId));

		if (session.length === 0) {
			throw new NotFoundException(`Stream session ${sessionId} not found`);
		}

		const sess = session[0]!;
		const fileId = sess.movieFileId;
		if (!fileId) {
			throw new NotFoundException('Session has no associated file');
		}

		const file = await this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.id, fileId));

		if (file.length === 0) {
			throw new NotFoundException(`File ${fileId} not found`);
		}

		const movieFile = file[0]!;
		const mode = this.determineStreamMode(movieFile);

		// Only applicable to transcoded streams
		if (mode !== StreamMode.TRANSCODE && mode !== StreamMode.DIRECT_STREAM) {
			return;
		}

		// If chunked transcoding is active for this file, just reprioritize chunks
		const quality = sess.quality || '1080p';
		if (this.chunkManager.isEnabled()) {
			const chunkMap = this.chunkManager.getChunkMap(movieFile.id, quality);
			if (chunkMap) {
				this.chunkManager.reprioritizeForSeek(movieFile.id, quality, positionSeconds);
				// Point session at persistent dir (chunks are written there)
				const persistDir = this.transcoderService.getPersistentDir(movieFile.id, quality);
				this.sessionDirs.set(sessionId, persistDir);
				this.logger.log(`Chunk-based seek for session ${this.guidResolver.resolve(sessionId)} to ${positionSeconds}s`);
				return;
			}
		}

		// Stop current transcode
		this.transcoderService.stopTranscode(sessionId);

		// Clean up ephemeral session dir (not persistent cache)
		const sessionDir = this.transcoderService.getSessionDir(sessionId);
		const currentDir = this.sessionDirs.get(sessionId);
		const persistDir = this.transcoderService.getPersistentDir(movieFile.id, quality);

		// Only clean ephemeral dirs, not persistent cache
		if (currentDir !== persistDir) {
			await this.transcoderService.cleanup(sessionId);
		}

		// Create new ephemeral dir for this seek
		const newDir = this.transcoderService.getSessionDir(sessionId);
		this.sessionDirs.set(sessionId, newDir);
		if (mode === StreamMode.TRANSCODE) {
			await this.transcoderService.startTranscode(
				sessionId,
				movieFile.filePath,
				{ quality, seekSeconds: positionSeconds },
				newDir,
			);
		} else {
			await this.transcoderService.startRemux(sessionId, movieFile.filePath, newDir);
		}

		this.logger.log(`Seek-restart session ${this.guidResolver.resolve(sessionId)} from ${positionSeconds}s`);
	}

	async updateProgress(sessionId: string, positionSeconds: number) {
		const sessions = await this.database.db
			.select()
			.from(streamSessions)
			.where(eq(streamSessions.id, sessionId));

		if (sessions.length === 0) {
			throw new NotFoundException(`Stream session ${sessionId} not found`);
		}

		const session = sessions[0]!;

		await this.database.db
			.update(streamSessions)
			.set({
				positionSeconds,
				lastActiveAt: nowISO(),
			})
			.where(eq(streamSessions.id, sessionId));

		// Upsert watch history
		const existing = await this.database.db
			.select()
			.from(userWatchHistory)
			.where(
				and(
					eq(userWatchHistory.userId, session.userId),
					eq(userWatchHistory.movieId, session.movieId),
				),
			);

		if (existing.length > 0) {
			await this.database.db
				.update(userWatchHistory)
				.set({
					positionSeconds,
					watchedAt: nowISO(),
				})
				.where(eq(userWatchHistory.id, existing[0]!.id));
		} else {
			await this.database.db.insert(userWatchHistory).values({
				id: crypto.randomUUID(),
				userId: session.userId,
				movieId: session.movieId,
				positionSeconds,
				durationWatchedSeconds: 0,
				watchedAt: nowISO(),
			});
		}
	}

	async endStream(sessionId: string) {
		const sessions = await this.database.db
			.select()
			.from(streamSessions)
			.where(eq(streamSessions.id, sessionId));

		if (sessions.length === 0) {
			throw new NotFoundException(`Stream session ${sessionId} not found`);
		}

		const session = sessions[0]!;

		// Stop any active transcode
		if (session.transcoding) {
			this.transcoderService.stopTranscode(sessionId);
			// Only delete ephemeral session dirs — persistent cache dirs are kept
			const isPersistent = this.sessionDirs.has(sessionId);
			if (!isPersistent) {
				await this.transcoderService.cleanup(sessionId);
			}
			this.sessionDirs.delete(sessionId);
			this.sessionInfo.delete(sessionId);
		}

		// Resume background chunk encoding (was paused for live stream priority)
		this.chunkManager.resumeBackground();

		// Mark session as ended by clearing lastActiveAt
		await this.database.db.delete(streamSessions).where(eq(streamSessions.id, sessionId));

		// Update watch history with final position
		const finalPosition = session.positionSeconds ?? 0;
		const existing = await this.database.db
			.select()
			.from(userWatchHistory)
			.where(
				and(
					eq(userWatchHistory.userId, session.userId),
					eq(userWatchHistory.movieId, session.movieId),
				),
			);

		if (existing.length > 0) {
			await this.database.db
				.update(userWatchHistory)
				.set({
					positionSeconds: finalPosition,
					watchedAt: nowISO(),
				})
				.where(eq(userWatchHistory.id, existing[0]!.id));
		} else {
			await this.database.db.insert(userWatchHistory).values({
				id: crypto.randomUUID(),
				userId: session.userId,
				movieId: session.movieId,
				positionSeconds: finalPosition,
				durationWatchedSeconds: 0,
				watchedAt: nowISO(),
			});
		}

		this.events.emit(WsEvent.STREAM_ENDED, {
			sessionId,
			userId: session.userId,
			movieId: session.movieId,
		});

		this.transcodeDebugger.endSession(sessionId, 'completed');
		this.logger.log(`Stream ended: session=${this.guidResolver.resolve(sessionId)}`);
	}

	async getActiveSessions() {
		return this.database.db
			.select({
				sessionId: streamSessions.id,
				userId: streamSessions.userId,
				username: users.username,
				movieId: streamSessions.movieId,
				movieTitle: movies.title,
				position: streamSessions.positionSeconds,
				startedAt: streamSessions.startedAt,
				lastActivity: streamSessions.lastActiveAt,
			})
			.from(streamSessions)
			.leftJoin(users, eq(streamSessions.userId, users.id))
			.leftJoin(movies, eq(streamSessions.movieId, movies.id))
			.all();
	}

	async endAllSessions(): Promise<number> {
		const sessions = this.database.db.select().from(streamSessions).all();

		for (const session of sessions) {
			try {
				await this.endStream(session.id);
			} catch (err: any) {
				this.logger.warn(`Failed to end session ${this.guidResolver.resolve(session.id)}: ${err.message}`);
			}
		}

		return sessions.length;
	}

	/**
	 * Get the HLS directory for a session — persistent cache dir if available,
	 * otherwise the default ephemeral session dir.
	 */
	getSessionCacheDir(sessionId: string): string | undefined {
		return this.sessionDirs.get(sessionId);
	}

	/**
	 * Get the movieFileId and quality for a session.
	 */
	getSessionInfo(sessionId: string): { movieFileId: string; quality: string } | undefined {
		return this.sessionInfo.get(sessionId);
	}

	/**
	 * Select the best file from a list of available movie files.
	 * Prefers the highest resolution file available.
	 */
	private selectBestFile(files: any[]) {
		if (files.length === 1) return files[0];

		// Sort by resolution height descending, pick the first
		return files.sort((a, b) => {
			const aHeight = a.videoHeight ?? 0;
			const bHeight = b.videoHeight ?? 0;
			return bHeight - aHeight;
		})[0];
	}

	/**
	 * Resolve the best default quality for a movie file.
	 * Considers: source file resolution, cached transcodes, and configured default.
	 * Never upscales — caps quality at source resolution.
	 */
	/**
	 * Resolve which quality to stream for a movie file.
	 *
	 * Priority:
	 * 1. If "streamHighestAvailable" → use highest completed cache
	 * 2. Otherwise → prefer default encoding quality cache
	 * 3. Fall back to any completed cache (highest first)
	 * 4. If no cache → return the quality that should be encoded
	 *    (default quality, or file's native if "encodeHighestAvailable" is on)
	 */
	private resolveDefaultQuality(movieFileId: string, sourceHeight?: number | null): string {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const defaultQuality = enc?.quality || '1080p';
		const encodeHighest = enc?.encodeHighestAvailable === true;
		const streamHighest = enc?.streamHighestAvailable === true;

		const QUALITIES = ['480p', '720p', '1080p', '4k'] as const;
		const ranks: Record<string, number> = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4 };

		// Find all completed caches for this file
		const completedQualities: string[] = [];
		for (const q of QUALITIES) {
			const dir = this.transcoderService.getPersistentDir(movieFileId, q);
			if (existsSync(path.join(dir, '.complete'))) {
				completedQualities.push(q);
			}
		}

		// Sort by rank descending (highest first)
		completedQualities.sort((a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0));

		if (completedQualities.length > 0) {
			if (streamHighest) {
				// Stream at highest available completed quality
				this.logger.debug(
					`Streaming highest available: ${completedQualities[0]} for ${movieFileId}`,
				);
				return completedQualities[0]!;
			}

			// Prefer default encoding quality if it exists
			if (completedQualities.includes(defaultQuality)) {
				return defaultQuality;
			}

			// Default quality not cached — use highest available
			this.logger.debug(
				`Default ${defaultQuality} not cached, using ${completedQualities[0]} for ${movieFileId}`,
			);
			return completedQualities[0]!;
		}

		// No completed cache — determine what quality to encode
		// Determine source-native quality
		let sourceQuality = defaultQuality;
		if (sourceHeight && sourceHeight > 0) {
			if (sourceHeight >= 2160) sourceQuality = '4k';
			else if (sourceHeight >= 1080) sourceQuality = '1080p';
			else if (sourceHeight >= 720) sourceQuality = '720p';
			else sourceQuality = '480p';
		}

		if (encodeHighest && sourceHeight && sourceHeight > 0) {
			// Encode at the file's native quality (or default, whichever is higher)
			const sourceRank = ranks[sourceQuality] ?? 0;
			const defaultRank = ranks[defaultQuality] ?? 0;
			const chosen = sourceRank > defaultRank ? sourceQuality : defaultQuality;
			this.logger.debug(
				`No cache, will encode at ${chosen} (encodeHighest, source=${sourceHeight}px)`,
			);
			return chosen;
		}

		// Encode at default quality (don't cap — let FFmpeg handle scaling)
		this.logger.debug(`No cache, will encode at ${defaultQuality}`);
		return defaultQuality;
	}

	/**
	 * Determine the optimal stream mode based on container, video codec, and audio codec.
	 *
	 * Browser-native playback requires:
	 * - Video: H.264 (or VP8/VP9 in WebM)
	 * - Audio: AAC, MP3, Opus, FLAC, Vorbis (NOT DTS, TrueHD, AC3, EAC3)
	 * - Container: MP4, WebM, or M4V
	 *
	 * Decision hierarchy: DIRECT_PLAY → DIRECT_STREAM → TRANSCODE
	 */
	determineStreamMode(file: any): string {
		const filePath = (file.filePath || '').toLowerCase();
		const videoCodec = (file.codecVideo || '').toLowerCase();
		const audioCodec = (file.codecAudio || '').toLowerCase();

		// If codec info is missing (file wasn't probed yet), default to transcode
		if (!videoCodec) {
			return StreamMode.TRANSCODE;
		}
		const ext = filePath.slice(filePath.lastIndexOf('.'));

		const isH264 = videoCodec === 'h264' || videoCodec === 'avc' || videoCodec === 'h.264';
		const isMp4 = ext === '.mp4' || ext === '.m4v';
		const isMkv = ext === '.mkv';
		const isWebm = ext === '.webm';

		// Browser-compatible containers
		const isBrowserContainer = isMp4 || isWebm;

		// Browser-compatible audio codecs — these can play natively
		const BROWSER_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'flac', 'vorbis', 'mp4a', 'pcm_s16le'];
		const isBrowserAudio =
			!audioCodec || BROWSER_AUDIO_CODECS.some((c) => audioCodec.includes(c));

		// Audio codecs that ALWAYS require transcoding (common in movie files)
		const TRANSCODE_AUDIO_CODECS = ['dts', 'truehd', 'ac3', 'eac3', 'dca', 'mlp'];
		const needsAudioTranscode = TRANSCODE_AUDIO_CODECS.some((c) => audioCodec.includes(c));

		this.logger.debug(
			`Stream mode decision: file=${filePath}, video=${videoCodec}, audio=${audioCodec}, ` +
				`ext=${ext}, browserAudio=${isBrowserAudio}, needsAudioTranscode=${needsAudioTranscode}`,
		);

		// If we have codec info, use it for precise decisions
		if (videoCodec) {
			if (isH264 && isBrowserContainer && isBrowserAudio && !needsAudioTranscode) {
				return StreamMode.DIRECT_PLAY;
			}
			if (isH264 && isMkv && isBrowserAudio && !needsAudioTranscode) {
				// H.264 video is fine, just wrong container — remux to HLS
				return StreamMode.DIRECT_STREAM;
			}
			// If video is H.264 but audio needs transcoding, we must transcode
			// (can't remux with copy if audio codec is incompatible)
			if (isH264 && needsAudioTranscode) {
				this.logger.debug(
					`Audio codec "${audioCodec}" requires transcoding despite H.264 video`,
				);
				return StreamMode.TRANSCODE;
			}
			// HEVC, XviD, MPEG-4, etc. all need transcoding
			return StreamMode.TRANSCODE;
		}

		// No codec info — decide based on container only.
		if (isMp4 || isWebm) return StreamMode.DIRECT_PLAY;

		return StreamMode.TRANSCODE;
	}

	/**
	 * Parse audio tracks from the file's stored metadata.
	 * Returns a list of { index, codec, language, title, channels } objects.
	 */
	private parseAudioTracks(
		file: any,
	): { index: number; codec: string; language: string; title: string; channels?: number }[] {
		try {
			const raw = file.audioTracks;
			if (!raw) {
				// Fall back to basic info from codecAudio
				if (file.codecAudio) {
					return [
						{
							index: 0,
							codec: file.codecAudio,
							language: 'und',
							title: file.codecAudio.toUpperCase(),
						},
					];
				}
				return [];
			}
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
			if (Array.isArray(parsed)) return parsed;
			return [];
		} catch {
			return [];
		}
	}

	/**
	 * Get available quality options, capped at the source file's resolution.
	 * Returns qualities from lowest to highest that don't exceed the source.
	 */
	private getAvailableQualities(
		sourceHeight?: number | null,
	): { quality: string; height: number; label: string }[] {
		const allQualities = [
			{ quality: '480p', height: 480, label: '480p (SD)' },
			{ quality: '720p', height: 720, label: '720p (HD)' },
			{ quality: '1080p', height: 1080, label: '1080p (Full HD)' },
			{ quality: '4k', height: 2160, label: '4K (Ultra HD)' },
		];

		if (!sourceHeight || sourceHeight <= 0) return allQualities;

		// Only include qualities at or below source resolution
		return allQualities.filter((q) => q.height <= sourceHeight);
	}
}
