import crypto from 'node:crypto';
import { statSync } from 'node:fs';
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
				this.logger.log(`Reaped stale session ${session.id} (movie: ${session.movieId})`);
			} catch (err: any) {
				this.logger.warn(`Failed to reap session ${session.id}: ${err.message}`);
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
					`Movie ${movieId} has ${allFiles.length} file(s) but none are available. ` +
						`Paths: ${allFiles.map((f) => f.filePath).join(', ')}`,
				);
				throw new NotFoundException(
					'The source file for this movie is not currently accessible. ' +
						'It may have been moved or the storage is disconnected. Try running a library scan.',
				);
			}

			throw new NotFoundException(`No file found for movie ${movieId}`);
		}

		// Pick the best available file (prefer highest resolution)
		const file = this.selectBestFile(movieFileList);

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
		const quality = options.quality || this.resolveDefaultQuality(file.id, file.videoHeight);

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

		// Extract subtitles from the file
		let subtitleTracks: { index: number; language: string; title: string }[] = [];
		try {
			subtitleTracks = await this.subtitleService.extractSubtitles(file.filePath, file.id);
		} catch (err) {
			this.logger.warn(`Failed to extract subtitles for file ${file.id}: ${err}`);
		}

		// Start transcode or remux pipeline as needed
		const lib = this.settings.get<Record<string, unknown>>('library', {});
		const persistEnabled = (lib as any)?.persistTranscodes !== false;
		let hasCached = false;

		if (mode === StreamMode.TRANSCODE || mode === StreamMode.DIRECT_STREAM) {
			const persistDir = this.transcoderService.getPersistentDir(file.id, quality);
			hasCached =
				persistEnabled &&
				(await this.transcoderService.hasCachedTranscode(file.id, quality));

			if (hasCached) {
				// Use the existing persistent cache — no FFmpeg needed
				this.sessionDirs.set(sessionId, persistDir);
				this.logger.log(`Using cached transcode for session=${sessionId}, file=${file.id}`);
			} else {
				const outputDir = persistEnabled ? persistDir : undefined;
				if (outputDir) {
					this.sessionDirs.set(sessionId, persistDir);
				}

				if (mode === StreamMode.TRANSCODE) {
					await this.transcoderService.startTranscode(
						sessionId,
						file.filePath,
						{
							quality,
							audioTrack: options.audioTrack,
							subtitleTrack: options.subtitleTrack,
						},
						outputDir,
					);
				} else {
					await this.transcoderService.startRemux(sessionId, file.filePath, outputDir);
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

		this.events.emit(WsEvent.STREAM_STARTED, {
			sessionId,
			movieId,
			userId,
			mode,
		});

		const resolvedDir =
			this.sessionDirs.get(sessionId) || this.transcoderService.getSessionDir(sessionId);
		this.logger.log(
			`Stream started: session=${sessionId}, movie=${movieId}, file=${file.id}, mode=${mode}, quality=${quality}, segmentDir=${resolvedDir}`,
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
			subtitles: subtitleTracks.map((t) => ({
				id: String(t.index),
				label: t.title || t.language,
				language: t.language,
				url: `/api/v1/stream/${sessionId}/subtitles/${t.index}.vtt`,
			})),
			audioTracks,
			qualities,
			startPosition: resumePosition,
		};
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
		}

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

		this.logger.log(`Stream ended: session=${sessionId}`);
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
				this.logger.warn(`Failed to end session ${session.id}: ${err.message}`);
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
	private resolveDefaultQuality(movieFileId: string, sourceHeight?: number | null): string {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const defaultQuality = enc?.quality || '1080p';
		const encodeHighest = enc?.encodeHighestAvailable === true;

		const ranks: Record<string, number> = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4 };

		// Cap quality at source resolution to avoid upscaling
		let maxQuality = defaultQuality;
		if (sourceHeight && sourceHeight > 0) {
			if (sourceHeight < 720) maxQuality = '480p';
			else if (sourceHeight < 1080) maxQuality = '720p';
			else if (sourceHeight < 2160) maxQuality = '1080p';
			else maxQuality = '4k';

			// Don't exceed source-capped quality
			const defaultRank = ranks[defaultQuality] ?? 3;
			const sourceMaxRank = ranks[maxQuality] ?? 3;
			if (defaultRank <= sourceMaxRank) {
				maxQuality = defaultQuality;
			} else {
				this.logger.debug(
					`Capping quality from ${defaultQuality} to ${maxQuality} (source height: ${sourceHeight}px)`,
				);
			}
		}

		if (!encodeHighest) return maxQuality;

		try {
			const cached = this.database.db
				.select({ quality: transcodeCache.quality })
				.from(transcodeCache)
				.where(eq(transcodeCache.movieFileId, movieFileId))
				.all();

			if (cached.length === 0) return maxQuality;

			const maxRank = ranks[maxQuality] ?? 3;
			let best = maxQuality;
			let bestRank = ranks[maxQuality] ?? 0;

			for (const { quality } of cached) {
				const rank = ranks[quality] ?? 0;
				// Don't exceed source resolution
				if (rank > bestRank && rank <= maxRank) {
					best = quality;
					bestRank = rank;
				}
			}

			return best;
		} catch {
			return maxQuality;
		}
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
