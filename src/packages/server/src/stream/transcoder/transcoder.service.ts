import { ChildProcess, execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { GuidResolverService } from '../../common/guid-resolver.service.js';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, transcodeCache } from '../../database/schema/index.js';
import { EventsService } from '../../events/events.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { TranscodeDebuggerService } from './transcode-debugger.service.js';
import { TRANSCODING_PROFILES } from './transcoder.profiles.js';

interface TranscodeOptions {
	quality?: string;
	audioTrack?: number;
	subtitleTrack?: number;
	/** Start transcoding from this position (seconds). Used for seek-restart. */
	seekSeconds?: number;
	/** Use ultrafast preset for live playback (faster startup, lower quality) */
	livePlayback?: boolean;
}

/**
 * Take an FFmpeg bitrate string ("5M", "256k", "1000000") and return
 * the same string scaled 2×. Used to derive a `bufsize` from a `maxrate`
 * so CRF VBV constraints have ~2 seconds of headroom for legitimate
 * peaks without blowing past the cap on the long-term average.
 *
 * Falls back to the input string unchanged if the value can't be parsed.
 */
function doubleBitrate(bitrate: string): string {
	const m = bitrate.match(/^([\d.]+)\s*([kKmMgG]?)$/);
	if (!m) return bitrate;
	const n = parseFloat(m[1]!);
	const unit = (m[2] || '').toLowerCase();
	if (!Number.isFinite(n) || n <= 0) return bitrate;
	const doubled = n * 2;
	// Keep the unit suffix the caller used so the output reads sensibly
	// in logs ("10M" not "10000000").
	if (unit === 'g') return `${doubled}G`;
	if (unit === 'm') return `${doubled}M`;
	if (unit === 'k') return `${doubled}k`;
	return String(Math.round(doubled));
}

type TranscodeState = 'running' | 'completed' | 'failed';

@Injectable()
export class TranscoderService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(TranscoderService.name);
	private readonly activeProcesses = new Map<string, ChildProcess>();
	/**
	 * Active single-file MP4 conversions, keyed by an opaque conversion key
	 * (see {@link remuxToMp4} / {@link transcodeToMp4}). Tracked separately
	 * from {@link activeProcesses} (which is HLS-session keyed) so a convert
	 * job can be cancelled via {@link cancelConversion} without touching live
	 * streaming sessions.
	 */
	private readonly activeConversions = new Map<string, ReturnType<typeof ffmpeg>>();
	/** Tracks the state of each transcode session (running / completed / failed) */
	private readonly sessionStates = new Map<string, { state: TranscodeState; error?: string }>();
	/** Sessions that have already retried with software encoding (prevents infinite loops) */
	private readonly swFallbackAttempted = new Set<string>();
	/**
	 * Sessions we deliberately killed (seek-restart / stop / cancel / supersede).
	 * Their FFmpeg exits non-zero with the encoder name still in stderr, which
	 * must NOT be misread as a hardware-encoder failure. Checked + cleared in the
	 * 'error' handler.
	 */
	private readonly intentionallyStopped = new Set<string>();
	/**
	 * Rolling buffer of the last N stderr lines per active session, used by
	 * {@link isHardwareEncoderFailure} to distinguish real GPU failures from
	 * input-path / IO errors. Bounded to keep memory predictable.
	 */
	private readonly sessionStderr = new Map<string, string[]>();
	private static readonly STDERR_BUFFER_LINES = 50;
	/** If true, hardware encoding has failed and all encodes should use software */
	private hwAccelBroken = false;
	/**
	 * CPU+GPU parallel transcoding: per-job encoder leases. At most one job
	 * holds the 'gpu' lease; further concurrent encode jobs get 'cpu'. Only
	 * consulted when `encoding.cpuParallelTranscode` is enabled.
	 */
	private readonly encoderLeases = new Map<string, 'gpu' | 'cpu'>();
	/** If true, FFmpeg itself cannot spawn (Windows DLL init failure) — skip background encodes */
	private ffmpegSpawnBroken = false;
	private ffmpegSpawnBrokenUntil = 0;
	private ffmpegSpawnFailCount = 0;
	private cacheDir: string;
	/** Resolved FFmpeg binary path used for direct spawns (probes, etc.) */
	private ffmpegPath = 'ffmpeg';

	constructor(
		private readonly config: ConfigService,
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
		private readonly transcodeDebugger: TranscodeDebuggerService,
		private readonly guidResolver: GuidResolverService,
		private readonly events: EventsService,
	) {
		// Use config/env for initial cache dir — DB override applied in onModuleInit
		// Check both camelCase and lowercase (env vars are lowercased by config loader)
		const configCacheDir =
			this.config.get<string>('cache.streamDir') ||
			this.config.get<string>('cache.streamdir');
		const dataDir = path.resolve(
			this.config.get<string>('dataDir') ||
				this.config.get<string>('datadir') ||
				'../../data',
		);
		this.cacheDir = path.resolve(configCacheDir || path.join(dataDir, 'cache', 'streams'));
	}

	onModuleInit() {
		// DB setting overrides config file / env var for cache directory
		const lib = this.settings.get<Record<string, unknown>>('library', {}) as any;
		const dbCacheDir = lib?.cacheDir;
		if (dbCacheDir) {
			this.cacheDir = path.resolve(dbCacheDir);
			this.logger.log(`Cache directory overridden by settings: ${this.cacheDir}`);
		}

		// Restore hwAccelBroken from persisted settings
		this.hwAccelBroken = this.settings.get<boolean>('hwAccelBroken', false);
		if (this.hwAccelBroken) {
			this.logger.warn('Hardware acceleration marked as broken from previous session');
		}

		// Set explicit ffmpeg/ffprobe paths from config
		// This avoids PATH issues on Windows (WinGet symlink permissions, Git Bash vs system PATH)
		const ffmpegPath = this.config.get<string>('transcoding.ffmpegPath', 'ffmpeg');
		const ffprobePath = this.config.get<string>('transcoding.ffprobePath', 'ffprobe');
		this.ffmpegPath = ffmpegPath;
		if (ffmpegPath !== 'ffmpeg') {
			ffmpeg.setFfmpegPath(ffmpegPath);
			this.logger.log(`Using ffmpeg at: ${ffmpegPath}`);
		}
		if (ffprobePath !== 'ffprobe') {
			ffmpeg.setFfprobePath(ffprobePath);
			this.logger.log(`Using ffprobe at: ${ffprobePath}`);
		}

		// Auto-detect: if default 'ffmpeg' fails, try common locations
		if (ffmpegPath === 'ffmpeg') {
			const candidates =
				process.platform === 'win32'
					? [
							'C:/ffmpeg/ffmpeg.exe',
							'C:\\ffmpeg\\ffmpeg.exe',
							'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
						]
					: ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
			for (const candidate of candidates) {
				try {
					if (existsSync(candidate)) {
						ffmpeg.setFfmpegPath(candidate);
						const probePath = candidate.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
						ffmpeg.setFfprobePath(probePath);
						this.ffmpegPath = candidate;
						this.logger.log(`Auto-detected ffmpeg at: ${candidate}`);
						break;
					}
				} catch {}
			}
		}

		// Reconcile disk caches with transcode_cache DB on startup
		setTimeout(() => this.reconcileCaches(), 5000);
	}

	/**
	 * Scan persistent cache directories and add any completed caches
	 * that aren't tracked in the transcode_cache DB table.
	 */
	private async reconcileCaches(): Promise<void> {
		const persistBase = path.join(this.cacheDir, 'persistent');
		if (!existsSync(persistBase)) return;

		try {
			const dirs = readdirSync(persistBase);
			let added = 0;

			for (const fileId of dirs) {
				const filePath = path.join(persistBase, fileId);
				try {
					if (!statSync(filePath).isDirectory()) continue;
				} catch {
					continue;
				}

				// Check file exists in DB
				const _dbFile = this.database.db
					.select({ id: transcodeCache.movieFileId })
					.from(transcodeCache)
					.where(eq(transcodeCache.movieFileId, fileId))
					.get();

				// Check movie_files table for this ID
				const movieFile = this.database.db
					.select()
					.from(movieFiles)
					.where(eq(movieFiles.id, fileId))
					.get();
				if (!movieFile) continue;

				const qualities = readdirSync(filePath);
				for (const quality of qualities) {
					const qPath = path.join(filePath, quality);
					try {
						if (!statSync(qPath).isDirectory()) continue;
					} catch {
						continue;
					}

					if (!existsSync(path.join(qPath, '.complete'))) continue;

					// Count segments and size from disk first — both the
					// insert path (new row) and the backfill path (existing
					// row missing these fields) need the same numbers.
					const segFiles = readdirSync(qPath).filter(
						(f: string) => f.startsWith('segment_') && f.endsWith('.ts'),
					);
					let sizeBytes = 0;
					for (const seg of segFiles) {
						try {
							sizeBytes += statSync(path.join(qPath, seg)).size;
						} catch {}
					}

					// Existing row? Backfill sizeBytes / segmentCount if
					// they're null — these columns were added after some
					// rows already existed, so without this update the UI
					// would never get a size for a cache created before
					// the schema change.
					const existing = this.database.db
						.select()
						.from(transcodeCache)
						.where(
							and(
								eq(transcodeCache.movieFileId, fileId),
								eq(transcodeCache.quality, quality),
							),
						)
						.get();
					if (existing) {
						if (existing.sizeBytes == null || existing.segmentCount == null) {
							this.database.db
								.update(transcodeCache)
								.set({ sizeBytes, segmentCount: segFiles.length })
								.where(eq(transcodeCache.id, existing.id))
								.run();
						}
						continue;
					}

					// New row — full insert.
					const enc = this.getEncodingSettings();
					this.database.db
						.insert(transcodeCache)
						.values({
							id: crypto.randomUUID(),
							movieFileId: fileId,
							quality,
							encodingSettings: JSON.stringify({
								hwAccel: enc.hwAccel,
								preset: enc.preset,
								rateControl: enc.rateControl,
								crf: enc.crf,
							}),
							completedAt: new Date().toISOString(),
							filePath: movieFile.filePath ?? null,
							cachePath: `persistent/${fileId}/${quality}`,
							sizeBytes,
							segmentCount: segFiles.length,
						})
						.run();
					added++;
				}
			}

			if (added > 0) {
				this.logger.log(`Reconciled ${added} completed caches from disk to database`);
			}
		} catch (err: any) {
			this.logger.warn(`Cache reconciliation failed: ${err.message}`);
		}
	}

	async onModuleDestroy() {
		const count = this.activeProcesses.size;
		if (count > 0) {
			this.logger.warn(`Server shutting down — killing ${count} active FFmpeg processes`);
			for (const [sessionId] of this.activeProcesses) {
				this.stopTranscode(sessionId);
			}
		}
	}

	/**
	 * Get the persistent cache directory for a given movie file + quality.
	 */
	getPersistentDir(movieFileId: string, quality: string): string {
		return path.join(this.cacheDir, 'persistent', movieFileId, quality);
	}

	/** Root persistent-cache dir for a file (parent of all quality subdirs). */
	getFilePersistentRoot(movieFileId: string): string {
		return path.join(this.cacheDir, 'persistent', movieFileId);
	}

	/**
	 * Path to a cache-mode direct-play MP4 for a file (written by
	 * ConversionService when `convertOriginalFile` is OFF), or null if none.
	 * When present it supersedes the source: the file can direct-play even if
	 * its original codecs would otherwise require transcoding.
	 */
	getCachedDirectMp4(movieFileId: string): string | null {
		const p = path.join(this.getPersistentDir(movieFileId, 'direct'), 'direct.mp4');
		return existsSync(p) ? p : null;
	}

	/**
	 * Remove every persistent quality cache for a file EXCEPT the given
	 * quality subdir. Used by cache-mode conversion to drop stale HLS caches
	 * while keeping the freshly-written direct-play MP4.
	 */
	async clearHlsCachesExcept(movieFileId: string, keepQuality: string): Promise<void> {
		const root = this.getFilePersistentRoot(movieFileId);
		let entries: string[] = [];
		try {
			entries = await readdir(root);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry === keepQuality) continue;
			await rm(path.join(root, entry), { recursive: true, force: true }).catch(() => {});
		}
		for (const key of this.healthCache.keys()) {
			if (key.includes(movieFileId)) this.healthCache.delete(key);
		}
	}

	/**
	 * Check whether a fully completed transcode cache exists.
	 */
	async hasCachedTranscode(movieFileId: string, quality: string): Promise<boolean> {
		const dir = this.getPersistentDir(movieFileId, quality);
		try {
			await access(path.join(dir, '.complete'));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Remove persistent cache for one file (all qualities) or all files.
	 */
	/**
	 * Clear a specific quality cache for a movie file.
	 */
	async clearCacheQuality(movieFileId: string, quality: string): Promise<void> {
		const dir = this.getPersistentDir(movieFileId, quality);
		// Clear health cache
		for (const key of this.healthCache.keys()) {
			if (key.includes(movieFileId)) this.healthCache.delete(key);
		}
		try {
			await rm(dir, { recursive: true, force: true });
			this.logger.log(`Cleared cache: ${movieFileId}/${quality}`);
		} catch (err) {
			this.logger.warn(`Failed to clear cache ${dir}: ${err}`);
		}
		// Remove DB entry
		this.database.db
			.delete(transcodeCache)
			.where(
				and(
					eq(transcodeCache.movieFileId, movieFileId),
					eq(transcodeCache.quality, quality),
				),
			)
			.run();
	}

	async clearCache(movieFileId?: string): Promise<void> {
		// Clear health check cache for affected directories
		if (movieFileId) {
			for (const key of this.healthCache.keys()) {
				if (key.includes(movieFileId)) this.healthCache.delete(key);
			}
		} else {
			this.healthCache.clear();
		}

		const target = movieFileId
			? path.join(this.cacheDir, 'persistent', movieFileId)
			: path.join(this.cacheDir, 'persistent');
		try {
			await rm(target, { recursive: true, force: true });
			this.logger.log(`Cleared persistent cache: ${target}`);
		} catch (err) {
			this.logger.warn(`Failed to clear cache ${target}: ${err}`);
		}

		// Also purge transcode_cache DB entries
		try {
			if (movieFileId) {
				this.database.db
					.delete(transcodeCache)
					.where(eq(transcodeCache.movieFileId, movieFileId))
					.run();
			} else {
				this.database.db.delete(transcodeCache).run();
			}
		} catch (err) {
			this.logger.warn(`Failed to clear transcode_cache entries: ${err}`);
		}
	}

	/**
	 * Get the transcode state for a session. Returns undefined if the session
	 * was never tracked (e.g. direct play or unknown session).
	 */
	getTranscodeState(sessionId: string): { state: TranscodeState; error?: string } | undefined {
		return this.sessionStates.get(sessionId);
	}

	// ====================================================================
	// Single-file MP4 conversion (direct-play target)
	// --------------------------------------------------------------------
	// Unlike startTranscode/startRemux (which emit HLS segments for live or
	// cached streaming), these produce one faststart .mp4 that the browser
	// can direct-play natively — no MediaSource, so Web Audio EQ/Compressor
	// work. Used by ConversionService for in-place original replacement and
	// cached direct-play artifacts. These RESOLVE ON COMPLETION (not on
	// ffmpeg start) because the caller needs the finished file to verify.
	// ====================================================================

	/**
	 * ffprobe a media file. Returns null if it can't be probed (used to
	 * verify a freshly-converted file before we trust/replace anything).
	 */
	async probeFile(filePath: string): Promise<{
		durationSeconds: number | null;
		sizeBytes: number;
		codecVideo: string | null;
		codecAudio: string | null;
		videoWidth: number | null;
		videoHeight: number | null;
	} | null> {
		try {
			const sizeBytes = statSync(filePath).size;
			const data = await new Promise<any>((resolve, reject) => {
				ffmpeg.ffprobe(filePath, (err, d) => (err ? reject(err) : resolve(d)));
			});
			const streams: any[] = data?.streams ?? [];
			const v = streams.find((s) => s.codec_type === 'video');
			const a = streams.find((s) => s.codec_type === 'audio');
			const dur = Number(data?.format?.duration);
			return {
				durationSeconds: Number.isFinite(dur) ? dur : null,
				sizeBytes,
				codecVideo: v?.codec_name ?? null,
				codecAudio: a?.codec_name ?? null,
				videoWidth: v?.width ?? null,
				videoHeight: v?.height ?? null,
			};
		} catch (err) {
			this.logger.warn(`probeFile failed for ${filePath}: ${err}`);
			return null;
		}
	}

	/**
	 * Lossless container change: copy existing (already browser-compatible)
	 * video+audio streams into a faststart MP4. Seconds of CPU, no re-encode,
	 * identical quality and ~identical size.
	 */
	async remuxToMp4(
		filePath: string,
		outputPath: string,
		onProgress?: (pct: number) => void,
	): Promise<void> {
		if (this.isFfmpegSpawnBroken()) {
			throw new Error('FFmpeg spawn temporarily disabled (Windows DLL error cooldown)');
		}
		await mkdir(path.dirname(outputPath), { recursive: true });
		const key = `remux-mp4:${outputPath}`;
		return new Promise<void>((resolve, reject) => {
			const command = this.createFfmpegCommand(filePath)
				.outputOptions(['-map', '0:v:0', '-map', '0:a:0?'])
				.videoCodec('copy')
				.audioCodec('copy')
				// Force the MP4 muxer so the output path's extension is free
				// (callers write to a non-media temp name to dodge the scanner).
				.outputOptions(['-f', 'mp4', '-movflags', '+faststart'])
				.output(outputPath);
			this.wireConversionEvents(command, key, onProgress, resolve, reject);
			command.run();
		});
	}

	/**
	 * Re-encode to H.264/AAC in a faststart MP4. `preserveResolution` keeps the
	 * source dimensions (used for in-place original replacement so we don't
	 * downscale the master); otherwise the requested quality profile's scale is
	 * applied. `nearLossless` biases toward CRF at a high-quality value since the
	 * output may replace the original.
	 */
	async transcodeToMp4(
		filePath: string,
		outputPath: string,
		opts: {
			quality?: string;
			preserveResolution?: boolean;
			nearLossless?: boolean;
			/** Copy the video stream untouched and only re-encode audio → AAC. */
			videoCopy?: boolean;
			/** Target video codec. 'av1' uses NVENC AV1 (requires a working GPU). */
			targetCodec?: 'h264' | 'av1';
			/** AV1 NVENC constant-quality value; overrides the encoding setting. */
			av1Cq?: number;
			/** Encode on the CPU (libx264) even when a GPU is configured. */
			forceCpu?: boolean;
		} = {},
		onProgress?: (pct: number) => void,
	): Promise<void> {
		if (this.isFfmpegSpawnBroken()) {
			throw new Error('FFmpeg spawn temporarily disabled (Windows DLL error cooldown)');
		}
		await mkdir(path.dirname(outputPath), { recursive: true });

		const quality = opts.quality || '1080p';
		const profile =
			TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES] ??
			TRANSCODING_PROFILES['1080p'];
		if (!profile) {
			throw new Error(`No transcoding profile found for quality "${quality}"`);
		}
		const enc = this.getEncodingSettings();
		if (opts.forceCpu) {
			// CPU+GPU parallel mode: this job encodes on the CPU. Drop to
			// software and swap any NVENC preset for a libx264 one.
			enc.hwAccel = 'none';
			if (/^p[1-7]$/.test(enc.preset)) enc.preset = 'veryfast';
		}
		if (opts.nearLossless) {
			// Replacing the master — bias toward quality. CRF with a high-quality
			// value; cap at the user's configured CRF so they can go higher still.
			enc.rateControl = 'crf';
			enc.crf = Math.min(enc.crf, 20);
		}
		const hwAccel = enc.hwAccel;
		const key = `transcode-mp4:${outputPath}`;

		return new Promise<void>((resolve, reject) => {
			let command = this.createFfmpegCommand(filePath);

			if (opts.targetCodec === 'av1') {
				// GPU AV1 (NVENC). Browser-universal (Chrome/Firefox/Edge, modern
				// Safari) AND ~as efficient as HEVC, so no H.264-style doubling.
				// Constant-quality via -cq; preserves source resolution in-place.
				const cq = opts.av1Cq ?? enc.av1Cq;
				const av1Preset = /^p[1-7]$/.test(enc.preset) ? enc.preset : 'p5';
				command = command
					.videoCodec('av1_nvenc')
					.audioCodec('aac')
					.outputOptions([
						'-ac',
						'2',
						'-b:a',
						profile.audioBitrate,
						'-preset',
						av1Preset,
						'-rc',
						'vbr',
						'-cq',
						String(cq),
						'-b:v',
						'0',
						'-pix_fmt',
						'yuv420p',
					]);
				if (!opts.preserveResolution) {
					const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
					command = command.outputOptions(['-vf', scaleFilter]);
				}
			} else if (opts.videoCopy) {
				// Video is already browser-compatible (H.264) — copy it losslessly
				// and only bring the audio to AAC. Fast, no video quality loss.
				command = command
					.videoCodec('copy')
					.audioCodec('aac')
					.outputOptions(['-ac', '2', '-b:a', profile.audioBitrate]);
			} else {
				const videoCodec = this.getVideoCodec(hwAccel);
				const videoRateOpts = this.getRateControlOpts(enc, profile.videoBitrate);
				if (hwAccel === 'vaapi') {
					command = command.inputOptions([
						'-hwaccel',
						'vaapi',
						'-hwaccel_output_format',
						'vaapi',
						'-vaapi_device',
						'/dev/dri/renderD128',
					]);
				} else if (hwAccel === 'qsv') {
					command = command.inputOptions(['-hwaccel', 'qsv']);
				}

				command = command
					.videoCodec(videoCodec)
					.audioCodec('aac')
					.outputOptions(['-ac', '2', '-b:a', profile.audioBitrate, ...videoRateOpts]);

				if (!opts.preserveResolution) {
					const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
					command = command.outputOptions(['-vf', scaleFilter]);
				}

				command = command.outputOptions([
					'-preset',
					enc.preset,
					...(enc.pixFmt ? ['-pix_fmt', enc.pixFmt] : []),
				]);
			}

			command = command
				.outputOptions(['-map', '0:v:0', '-map', '0:a:0?'])
				.outputOptions(['-f', 'mp4', '-movflags', '+faststart'])
				.output(outputPath);

			this.wireConversionEvents(command, key, onProgress, resolve, reject);
			command.run();
		});
	}

	/** Cancel an in-flight MP4 conversion by its output path. */
	cancelConversionByOutput(outputPath: string): void {
		this.cancelConversion(`remux-mp4:${outputPath}`);
		this.cancelConversion(`transcode-mp4:${outputPath}`);
	}

	private cancelConversion(key: string): void {
		const cmd = this.activeConversions.get(key);
		if (cmd) {
			try {
				cmd.kill('SIGKILL');
			} catch {
				/* already gone */
			}
			this.activeConversions.delete(key);
		}
	}

	/**
	 * Shared event wiring for the single-file MP4 converters. Resolves on
	 * `end` (completion) — not on `start` — so callers get a finished file.
	 */
	private wireConversionEvents(
		command: ReturnType<typeof ffmpeg>,
		key: string,
		onProgress: ((pct: number) => void) | undefined,
		resolve: () => void,
		reject: (e: Error) => void,
	): void {
		this.activeConversions.set(key, command);
		command
			.on('start', (commandLine: string) => {
				this.resetFfmpegSpawnFailCount();
				this.logger.log(`MP4 conversion started: ${key}`);
				this.logger.debug(`FFmpeg command: ${commandLine}`);
			})
			.on('progress', (progress: any) => {
				if (onProgress && typeof progress?.percent === 'number') {
					onProgress(Math.max(0, Math.min(100, progress.percent)));
				}
			})
			.on('error', (err: Error) => {
				this.activeConversions.delete(key);
				if (this.isWindowsSpawnFailure(err)) {
					this.markFfmpegSpawnBroken();
				}
				this.logger.error(`MP4 conversion failed (${key}): ${err.message}`);
				reject(err);
			})
			.on('end', () => {
				this.activeConversions.delete(key);
				this.logger.log(`MP4 conversion finished: ${key}`);
				resolve();
			});
	}

	async startTranscode(
		sessionId: string,
		filePath: string,
		options: TranscodeOptions = {},
		outputDir?: string,
	): Promise<void> {
		const targetDir = outputDir || this.getSessionDir(sessionId);

		// Clean out stale partial files from a previously failed transcode
		// NEVER wipe a directory that has a .complete marker — it's a valid cache
		if (outputDir) {
			try {
				await access(path.join(targetDir, '.complete'));
				// Complete cache exists — don't destroy it
				this.logger.log(`Target dir has .complete marker — reusing cached version`);
			} catch {
				// No .complete — safe to clean stale partials
				try {
					await access(path.join(targetDir, 'stream.m3u8'));
					this.logger.warn(`Removing stale partial transcode in ${targetDir}`);
					await rm(targetDir, { recursive: true, force: true });
				} catch {
					// No existing file — nothing to clean
				}
			}
		}

		await mkdir(targetDir, { recursive: true });

		const quality = options.quality || '1080p';
		const profile =
			TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES] ??
			TRANSCODING_PROFILES['1080p'];

		if (!profile) {
			throw new Error(`No transcoding profile found for quality "${quality}"`);
		}

		const outputPath = path.join(targetDir, 'stream.m3u8');
		const segmentPattern = path.join(targetDir, 'segment_%04d.ts');

		const enc = this.getEncodingSettings();
		// For live playback, use ultrafast preset for fastest startup (3-5x realtime)
		// Background pre-transcoding uses the configured preset (better quality)
		if (options.livePlayback && enc.hwAccel === 'none') {
			enc.preset = 'ultrafast';
		} else if (options.livePlayback && enc.hwAccel === 'nvenc') {
			enc.preset = 'p1'; // fastest NVENC preset
		}
		const hwAccel = enc.hwAccel;
		const videoCodec = this.getVideoCodec(hwAccel);
		// Use smaller segments for live playback (faster first segment)
		const segDuration = options.livePlayback ? '2' : String(enc.segmentDuration);
		// GOP size = segment_duration × assumed_fps (round to nearest even)
		const gopSize = String(Math.round((Number(segDuration) * 24) / 2) * 2);

		return new Promise<void>((resolve, reject) => {
			const videoRateOpts = this.getRateControlOpts(enc, profile.videoBitrate);

			// Use scale filter instead of .size() to preserve aspect ratio
			const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;

			let command = this.createFfmpegCommand(filePath);

			// Seek to start position if specified (input-level -ss for fast seek)
			if (options.seekSeconds && options.seekSeconds > 0) {
				command = command.inputOptions(['-ss', String(options.seekSeconds)]);
			}

			command = command
				.outputOptions([
					'-f',
					'hls',
					'-hls_time',
					segDuration,
					'-hls_list_size',
					'0',
					'-hls_segment_filename',
					segmentPattern,
					'-hls_playlist_type',
					'event',
					'-hls_flags',
					'independent_segments',
				])
				.videoCodec(videoCodec)
				.audioCodec('aac')
				.outputOptions([
					'-ac',
					'2',
					'-vf',
					scaleFilter,
					'-g',
					gopSize,
					'-sc_threshold',
					'0',
					'-b:a',
					profile.audioBitrate,
					...videoRateOpts,
				])
				.outputOptions([
					'-preset',
					enc.preset,
					...(enc.pixFmt ? ['-pix_fmt', enc.pixFmt] : []),
				]);

			// Apply hardware acceleration input options
			if (hwAccel === 'nvenc') {
				// Don't add -hwaccel cuda — it conflicts with CPU-based scale filters.
				// NVENC still uses GPU for encoding; only decoding stays on CPU.
			} else if (hwAccel === 'vaapi') {
				command = command.inputOptions([
					'-hwaccel',
					'vaapi',
					'-hwaccel_output_format',
					'vaapi',
					'-vaapi_device',
					'/dev/dri/renderD128',
				]);
			} else if (hwAccel === 'qsv') {
				command = command.inputOptions(['-hwaccel', 'qsv']);
			}

			// Map video stream
			command = command.outputOptions(['-map', '0:v:0']);

			// Select specific audio track if provided (? suffix prevents crash on files with no audio)
			if (options.audioTrack !== undefined) {
				command = command.outputOptions(['-map', `0:a:${options.audioTrack}?`]);
			} else {
				command = command.outputOptions(['-map', '0:a:0?']);
			}

			command
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.resetFfmpegSpawnFailCount();
					this.sessionStderr.set(sessionId, []);
					this.logger.log(
						`FFmpeg started for session ${this.guidResolver.resolve(sessionId)}, outputDir=${targetDir}`,
					);
					this.logger.debug(`FFmpeg command: ${commandLine}`);
					this.sessionStates.set(sessionId, { state: 'running' });
					this.transcodeDebugger.recordFFmpegCommand(sessionId, commandLine);
					this.transcodeDebugger.recordMilestone(sessionId, 'ffmpegSpawned');
					// Resolve immediately once FFmpeg starts; segments will be generated progressively
					resolve();
				})
				.on('stderr', (line: string) => {
					this.appendSessionStderr(sessionId, line);
				})
				.on('progress', (progress: any) => {
					this.logger.debug(
						`Transcode progress [${this.guidResolver.resolve(sessionId)}]: ${progress.percent?.toFixed(1)}%`,
					);
					this.transcodeDebugger.recordFFmpegProgress(sessionId, progress);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`FFmpeg error for session ${this.guidResolver.resolve(sessionId)}: ${err.message}`,
					);
					this.transcodeDebugger.recordEvent(sessionId, 'ffmpeg_error', err.message);
					this.activeProcesses.delete(sessionId);
					const stderrLines = this.sessionStderr.get(sessionId) ?? [];

					// Deliberate kill (seek-restart / stop / cancel)? Then this isn't a
					// failure — the process exited because WE terminated it. Never flip
					// hwAccelBroken or retry software here; just clean up. Without this,
					// scrubbing a video repeatedly killed the nvenc FFmpeg and the leftover
					// "nvenc" in its stderr was misread as a GPU failure, disabling
					// hardware encoding for everyone until a manual recycle.
					if (this.intentionallyStopped.has(sessionId)) {
						this.intentionallyStopped.delete(sessionId);
						this.sessionStderr.delete(sessionId);
						this.swFallbackAttempted.delete(sessionId);
						this.sessionStates.set(sessionId, { state: 'failed', error: 'stopped' });
						reject(err);
						return;
					}

					// Windows DLL init failure with NVENC — likely NVIDIA DLLs can't load
					// in non-interactive session. Fall through to software retry first.
					if (this.isWindowsSpawnFailure(err) && hwAccel === 'none') {
						// Software encoding also failed — FFmpeg itself is broken
						this.markFfmpegSpawnBroken();
						this.sessionStates.set(sessionId, {
							state: 'failed',
							error: 'FFmpeg cannot start (Windows DLL error) — try again in 60s',
						});
						this.sessionStderr.delete(sessionId);
						reject(err);
						return;
					}

					// Only retry with software encoding when the failure looks
					// like a real hardware-encoder problem. Path-parse errors
					// (e.g. brackets in filename), missing files, or permission
					// errors used to mistakenly flip hwAccelBroken globally and
					// disable hardware encoding for everyone — even though the
					// GPU was fine. The detector is conservative: anything we
					// can't confidently attribute to the GPU fails the job
					// without polluting global state.
					if (
						hwAccel !== 'none' &&
						!this.swFallbackAttempted.has(sessionId) &&
						this.isHardwareEncoderFailure(hwAccel, err.message, stderrLines)
					) {
						this.swFallbackAttempted.add(sessionId);
						const reason = stderrLines.slice(-3).join(' | ') || err.message;
						this.setHwAccelBroken(reason, hwAccel);
						this.retryWithSoftware(sessionId, filePath, options, outputDir).catch(
							(retryErr) => {
								this.logger.error(
									`Software fallback also failed for session ${this.guidResolver.resolve(sessionId)}: ${retryErr.message}`,
								);
							},
						);
						return;
					}

					const friendly = this.explainFfmpegError(err, stderrLines);
					this.sessionStates.set(sessionId, { state: 'failed', error: friendly });
					this.sessionStderr.delete(sessionId);
					// Reject with the friendly message so the job-history
					// entry is self-explanatory; the original technical
					// error has already been logged at error level above.
					reject(new Error(friendly));
				})
				.on('end', () => {
					this.logger.log(
						`Transcode complete for session ${this.guidResolver.resolve(sessionId)}`,
					);
					this.activeProcesses.delete(sessionId);
					this.sessionStderr.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'completed' });
					this.transcodeDebugger.recordEvent(
						sessionId,
						'ffmpeg_complete',
						'Transcode finished',
					);
					// Write .complete marker for persistent cache
					if (outputDir) {
						writeFile(path.join(targetDir, '.complete'), '').catch(() => {});
					}
				});

			// Run the command and capture the child process
			const _proc = command.run();

			// fluent-ffmpeg stores the process on the command object
			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(sessionId, ffmpegProcess);
				this.boostProcessPriority(sessionId);
				this.transcodeDebugger.attachStderr(sessionId, ffmpegProcess);
			}
		});
	}

	async startRemux(sessionId: string, filePath: string, outputDir?: string): Promise<void> {
		const targetDir = outputDir || this.getSessionDir(sessionId);

		// Clean out stale partial files from a previously failed remux
		// Never wipe a directory with a .complete marker
		if (outputDir) {
			try {
				await access(path.join(targetDir, '.complete'));
				this.logger.log(`Remux target has .complete marker — reusing cached version`);
			} catch {
				try {
					await access(path.join(targetDir, 'stream.m3u8'));
					this.logger.warn(`Removing stale partial remux in ${targetDir}`);
					await rm(targetDir, { recursive: true, force: true });
				} catch {
					// No existing file — nothing to clean
				}
			}
		}

		await mkdir(targetDir, { recursive: true });

		const outputPath = path.join(targetDir, 'stream.m3u8');
		const segmentPattern = path.join(targetDir, 'segment_%04d.ts');
		const enc = this.getEncodingSettings();
		const segDuration = String(enc.segmentDuration);

		return new Promise<void>((resolve, reject) => {
			const command = this.createFfmpegCommand(filePath)
				.outputOptions([
					'-f',
					'hls',
					'-hls_time',
					segDuration,
					'-hls_list_size',
					'0',
					'-hls_segment_filename',
					segmentPattern,
					'-hls_playlist_type',
					'event',
					'-hls_flags',
					'independent_segments',
				])
				.videoCodec('copy')
				.audioCodec('copy')
				.outputOptions(['-map', '0:v:0', '-map', '0:a:0?'])
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.logger.log(
						`FFmpeg remux started for session ${this.guidResolver.resolve(sessionId)}, outputDir=${targetDir}`,
					);
					this.logger.debug(`FFmpeg command: ${commandLine}`);
					this.sessionStates.set(sessionId, { state: 'running' });
					this.transcodeDebugger.recordFFmpegCommand(sessionId, commandLine);
					this.transcodeDebugger.recordMilestone(sessionId, 'ffmpegSpawned');
					resolve();
				})
				.on('progress', (progress: any) => {
					this.logger.debug(
						`Remux progress [${this.guidResolver.resolve(sessionId)}]: ${progress.percent?.toFixed(1)}%`,
					);
					this.transcodeDebugger.recordFFmpegProgress(sessionId, progress);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`FFmpeg remux error for session ${this.guidResolver.resolve(sessionId)}: ${err.message}`,
					);
					this.transcodeDebugger.recordEvent(sessionId, 'ffmpeg_error', err.message);
					this.activeProcesses.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'failed', error: err.message });
					reject(err);
				})
				.on('end', () => {
					this.logger.log(
						`Remux complete for session ${this.guidResolver.resolve(sessionId)}`,
					);
					this.activeProcesses.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'completed' });
					this.transcodeDebugger.recordEvent(
						sessionId,
						'ffmpeg_complete',
						'Remux finished',
					);
					if (outputDir) {
						writeFile(path.join(targetDir, '.complete'), '').catch(() => {});
					}
				});

			command.run();

			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(sessionId, ffmpegProcess);
				this.transcodeDebugger.attachStderr(sessionId, ffmpegProcess);
			}
		});
	}

	/**
	 * Run a full transcode or remux to the persistent cache directory.
	 * Resolves when FFmpeg finishes (not on start), so the cache is complete.
	 */
	async preTranscode(
		movieFileId: string,
		filePath: string,
		mode: string,
		quality: string = '1080p',
		onProgress?: (percent: number) => void,
		opts?: { forceCpu?: boolean },
	): Promise<void> {
		const persistDir = this.getPersistentDir(movieFileId, quality);

		// Already cached
		if (await this.hasCachedTranscode(movieFileId, quality)) {
			this.logger.log(
				`Pre-transcode skipped — cache exists for ${this.guidResolver.resolve(movieFileId)}/${quality}`,
			);
			return;
		}

		// Clean out stale partial files from a previously failed pre-transcode
		// Never wipe a directory with a .complete marker
		try {
			await access(path.join(persistDir, '.complete'));
			this.logger.log(`Pre-transcode dir has .complete marker — skipping`);
			return;
		} catch {
			// No .complete — safe to clean
			try {
				await access(path.join(persistDir, 'stream.m3u8'));
				this.logger.warn(`Removing stale partial pre-transcode in ${persistDir}`);
				await rm(persistDir, { recursive: true, force: true });
			} catch {
				// No existing file — nothing to clean
			}
		}

		await mkdir(persistDir, { recursive: true });

		// CPU+GPU parallel mode: this job was assigned the CPU — use the
		// existing software pipeline directly (it shadows hwAccel='none').
		if (opts?.forceCpu && mode === 'transcode') {
			return this.preTranscodeWithSoftware(
				movieFileId,
				filePath,
				quality,
				persistDir,
				onProgress,
			);
		}

		const outputPath = path.join(persistDir, 'stream.m3u8');
		const segmentPattern = path.join(persistDir, 'segment_%04d.ts');
		const processKey = `pre-${movieFileId}-${quality}`;

		const isTranscode = mode === 'transcode';

		const enc = this.getEncodingSettings();
		const hwAccel = enc.hwAccel;
		const segDuration = String(enc.segmentDuration);

		return new Promise<void>((resolve, reject) => {
			let command = this.createFfmpegCommand(filePath).outputOptions([
				'-f',
				'hls',
				'-hls_time',
				segDuration,
				'-hls_list_size',
				'0',
				'-hls_segment_filename',
				segmentPattern,
				'-hls_playlist_type',
				'event',
				'-hls_flags',
				'independent_segments',
			]);

			if (isTranscode) {
				const profile = (TRANSCODING_PROFILES[
					quality as keyof typeof TRANSCODING_PROFILES
				] ?? TRANSCODING_PROFILES['1080p'])!;
				const videoCodec = this.getVideoCodec(hwAccel);
				const videoRateOpts = this.getRateControlOpts(enc, profile.videoBitrate);
				const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
				const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

				command = command
					.videoCodec(videoCodec)
					.audioCodec('aac')
					.outputOptions([
						'-ac',
						'2',
						'-vf',
						scaleFilter,
						'-g',
						gopSize,
						'-sc_threshold',
						'0',
						'-b:a',
						profile.audioBitrate,
						...videoRateOpts,
					])
					.outputOptions([
						'-preset',
						enc.preset,
						...(enc.pixFmt ? ['-pix_fmt', enc.pixFmt] : []),
					]);

				if (hwAccel === 'nvenc') {
					// Don't add -hwaccel cuda — it conflicts with CPU-based scale filters.
					// NVENC still uses GPU for encoding; only decoding stays on CPU.
				} else if (hwAccel === 'vaapi') {
					command = command.inputOptions([
						'-hwaccel',
						'vaapi',
						'-hwaccel_output_format',
						'vaapi',
						'-vaapi_device',
						'/dev/dri/renderD128',
					]);
				} else if (hwAccel === 'qsv') {
					command = command.inputOptions(['-hwaccel', 'qsv']);
				}
			} else {
				// DIRECT_STREAM → remux (copy codecs)
				command = command.videoCodec('copy').audioCodec('copy');
			}

			command = command.outputOptions(['-map', '0:v:0', '-map', '0:a:0?']);

			command
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.resetFfmpegSpawnFailCount();
					this.logger.log(
						`Pre-transcode started for ${this.guidResolver.resolve(movieFileId)}: ${commandLine}`,
					);
					this.transcodeDebugger.recordFFmpegCommand(processKey, commandLine);
					this.transcodeDebugger.recordMilestone(processKey, 'ffmpegSpawned');
				})
				.on('progress', (progress: any) => {
					const pct = progress.percent;
					if (typeof pct === 'number' && !Number.isNaN(pct)) {
						onProgress?.(Math.min(100, Math.max(0, pct)));
					}
					this.logger.debug(
						`Pre-transcode progress [${this.guidResolver.resolve(movieFileId)}]: ${progress.percent?.toFixed(1)}%`,
					);
					this.transcodeDebugger.recordFFmpegProgress(processKey, progress);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`Pre-transcode error for ${this.guidResolver.resolve(movieFileId)}: ${err.message}`,
					);
					this.transcodeDebugger.recordEvent(processKey, 'ffmpeg_error', err.message);
					this.activeProcesses.delete(processKey);

					// Windows DLL init failure with software encoding — FFmpeg itself is broken
					if (this.isWindowsSpawnFailure(err) && hwAccel === 'none') {
						this.markFfmpegSpawnBroken();
						reject(err);
						return;
					}

					// If hardware acceleration was used, retry with software encoding
					// For background pre-transcode, only fall back for this job — don't
					// persist hwAccelBroken globally, as it may be a transient issue
					if (
						isTranscode &&
						hwAccel !== 'none' &&
						!this.swFallbackAttempted.has(processKey)
					) {
						this.swFallbackAttempted.add(processKey);
						this.logger.warn(
							`Hardware acceleration (${hwAccel}) failed for pre-transcode ${this.guidResolver.resolve(movieFileId)}, retrying with software (not persisting globally)`,
						);
						this.preTranscodeWithSoftware(
							movieFileId,
							filePath,
							quality,
							persistDir,
							onProgress,
						)
							.then(resolve)
							.catch(reject);
						return;
					}

					reject(err);
				})
				.on('end', () => {
					this.logger.log(
						`Pre-transcode complete for ${this.guidResolver.resolve(movieFileId)}/${quality}`,
					);
					this.activeProcesses.delete(processKey);
					this.transcodeDebugger.recordEvent(
						processKey,
						'ffmpeg_complete',
						'Pre-transcode finished',
					);
					writeFile(path.join(persistDir, '.complete'), '')
						.then(() => resolve())
						.catch(() => resolve());
				});

			command.run();

			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(processKey, ffmpegProcess);
				this.lowerProcessPriority(ffmpegProcess, processKey);
				this.transcodeDebugger.attachStderr(processKey, ffmpegProcess);
			}
		});
	}

	/**
	 * Validate a cached transcode is actually usable.
	 * Checks that the manifest exists, is parseable, and that the segments it
	 * references actually exist on disk. Returns 'complete', 'partial', 'invalid', or 'empty'.
	 */
	/**
	 * Check manifest duration against the expected movie duration.
	 * Returns true if the cache covers at least 95% of the movie.
	 */
	private async checkManifestDuration(dir: string, movieFileId: string): Promise<boolean> {
		try {
			const manifest = await readFile(path.join(dir, 'stream.m3u8'), 'utf-8');
			// Sum all EXTINF durations
			const extinfs = manifest.match(/#EXTINF:([\d.]+)/g);
			if (!extinfs || extinfs.length === 0) return false;

			let cacheDuration = 0;
			for (const e of extinfs) {
				cacheDuration += Number.parseFloat(e.replace('#EXTINF:', ''));
			}

			// Get expected duration from DB
			const file = this.database.db
				.select({ durationSeconds: movieFiles.durationSeconds })
				.from(movieFiles)
				.where(eq(movieFiles.id, movieFileId))
				.get();

			if (!file?.durationSeconds || file.durationSeconds <= 0) {
				// No expected duration — can't validate, trust the manifest
				return true;
			}

			const ratio = cacheDuration / file.durationSeconds;
			if (ratio < 0.95) {
				this.logger.warn(
					`Cache for ${this.guidResolver.resolve(movieFileId)} has ${Math.round(ratio * 100)}% of expected duration (${Math.round(cacheDuration)}s / ${file.durationSeconds}s) — incomplete`,
				);
				return false;
			}
			return true;
		} catch {
			return true; // Can't check — don't block
		}
	}

	async validateCache(
		movieFileId: string,
		quality: string,
	): Promise<'complete' | 'partial' | 'invalid' | 'empty'> {
		const dir = this.getPersistentDir(movieFileId, quality);

		// Fast path: .complete marker exists — trust it.
		// The .complete marker is written by our own code only after FFmpeg exits
		// successfully. If it exists with a manifest and first segment, the cache
		// is valid regardless of duration ratio or codec probe results.
		try {
			await access(path.join(dir, '.complete'));
			// Sanity check: manifest and first segment must exist
			try {
				await access(path.join(dir, 'stream.m3u8'));
				await access(path.join(dir, 'segment_0000.ts'));
			} catch {
				this.logger.warn(
					`Cache for ${this.guidResolver.resolve(movieFileId)}/${quality} has .complete but missing manifest or segment_0000 — marking invalid`,
				);
				return 'invalid';
			}
			// Run optional checks but only log warnings — never reject a .complete cache
			const durationOk = await this.checkManifestDuration(dir, movieFileId);
			if (!durationOk) {
				this.logger.warn(
					`Cache for ${this.guidResolver.resolve(movieFileId)}/${quality} may be truncated but .complete exists — using anyway`,
				);
			}
			const healthy = await this.probeSegmentHealth(dir);
			if (!healthy) {
				this.logger.warn(
					`Cache for ${this.guidResolver.resolve(movieFileId)}/${quality} has potential codec issues but .complete exists — using anyway`,
				);
			}
			return 'complete';
		} catch {
			// No .complete marker
		}

		// Check if directory has any content
		let files: string[];
		try {
			files = await readdir(dir);
		} catch {
			return 'empty';
		}

		const segments = files.filter((f) => f.startsWith('segment_') && f.endsWith('.ts'));
		if (segments.length === 0) {
			return files.includes('stream.m3u8') ? 'invalid' : 'empty';
		}

		// Has manifest with ENDLIST? Check if duration is complete before trusting it
		if (files.includes('stream.m3u8')) {
			try {
				const manifest = await readFile(path.join(dir, 'stream.m3u8'), 'utf-8');
				if (manifest.includes('#EXT-X-ENDLIST')) {
					// Verify it's actually complete (FFmpeg writes ENDLIST even on kill)
					const durationOk = await this.checkManifestDuration(dir, movieFileId);
					if (durationOk) {
						await writeFile(path.join(dir, '.complete'), '');
						this.logger.log(
							`Repaired missing .complete marker for ${this.guidResolver.resolve(movieFileId)}/${quality}`,
						);
						return 'complete';
					}
					// Truncated — treat as partial (will be cleaned and re-encoded)
					this.logger.warn(
						`Cache for ${this.guidResolver.resolve(movieFileId)}/${quality} has ENDLIST but is truncated — marking invalid`,
					);
					return 'invalid';
				}
			} catch {}
		}

		// Has chunk-meta.json? Then the chunk system manages it
		if (files.includes('chunk-meta.json')) {
			return 'partial';
		}

		// Old-format partial cache — check if it has enough segments to be useful
		return segments.length >= 3 ? 'partial' : 'invalid';
	}

	/**
	 * Probe the first segment in a cache directory to verify codecs are valid
	 * for browser playback. Catches issues like 5.1 AAC (channels detection
	 * fails in HLS.js), wrong video codec, or corrupt segments.
	 * Results are cached in-memory to avoid repeated FFprobe calls.
	 */
	private readonly healthCache = new Map<string, boolean>();

	private async probeSegmentHealth(cacheDir: string): Promise<boolean> {
		// Check in-memory cache first
		const cached = this.healthCache.get(cacheDir);
		if (cached !== undefined) return cached;

		const segmentPath = path.join(cacheDir, 'segment_0000.ts');
		try {
			await access(segmentPath);
		} catch {
			// No first segment — can't validate, assume OK (will fail elsewhere)
			return true;
		}

		try {
			const { execSync } = await import('node:child_process');
			const cmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels -of json "${segmentPath}"`;
			const out = JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 10000 }));
			const audioStream = (out.streams || [])[0];

			if (audioStream) {
				// Check for zero channels (causes HLS.js SourceBuffer errors)
				if (audioStream.channels === 0) {
					this.logger.warn(
						`Segment health check failed: audio has 0 channels in ${cacheDir}`,
					);
					this.healthCache.set(cacheDir, false);
					return false;
				}
				// Check for non-stereo AAC that browsers may not handle in HLS
				if (audioStream.codec_name === 'aac' && audioStream.channels > 2) {
					this.logger.warn(
						`Segment health check: ${audioStream.channels}-channel AAC detected in ${cacheDir} — re-encode to stereo`,
					);
					this.healthCache.set(cacheDir, false);
					return false;
				}
			}

			// Check video codec (take first line only — MPEG-TS can report multiple streams)
			const vidCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${segmentPath}"`;
			const videoCodec = execSync(vidCmd, { encoding: 'utf-8', timeout: 10000 })
				.trim()
				.split('\n')[0]
				?.trim();
			if (videoCodec && videoCodec !== 'h264') {
				this.logger.warn(
					`Segment health check: unexpected video codec "${videoCodec}" in ${cacheDir}`,
				);
				this.healthCache.set(cacheDir, false);
				return false;
			}

			this.healthCache.set(cacheDir, true);
			return true;
		} catch (err: any) {
			this.logger.warn(`Segment health probe failed for ${cacheDir}: ${err.message}`);
			// Probe failure — don't block playback, assume OK
			this.healthCache.set(cacheDir, true);
			return true;
		}
	}

	/**
	 * Check whether a partially transcoded cache has enough segments to begin playback.
	 */
	async hasPlayablePartialCache(
		movieFileId: string,
		quality: string,
		minSegments = 3,
	): Promise<boolean> {
		const dir = this.getPersistentDir(movieFileId, quality);
		try {
			await access(path.join(dir, 'stream.m3u8'));
		} catch {
			return false;
		}
		// Count segment files
		try {
			const files = await readdir(dir);
			const segCount = files.filter(
				(f) => f.startsWith('segment_') && f.endsWith('.ts'),
			).length;
			return segCount >= minSegments;
		} catch {
			return false;
		}
	}

	getActiveTranscodeCount(): number {
		return this.activeProcesses.size;
	}

	stopTranscode(sessionId: string): void {
		const proc = this.activeProcesses.get(sessionId);
		if (proc) {
			// Mark as a deliberate kill so the 'error' handler doesn't mistake the
			// resulting non-zero exit for a hardware-encoder failure (the killed
			// process's stderr still contains the encoder name, e.g. h264_nvenc).
			this.intentionallyStopped.add(sessionId);
			this.logger.log(
				`Stopping transcode for session ${this.guidResolver.resolve(sessionId)}`,
			);
			try {
				// On Windows, SIGKILL is not available; use SIGTERM which works cross-platform.
				// fluent-ffmpeg processes respond to SIGTERM gracefully.
				proc.kill();
			} catch (err) {
				this.logger.warn(
					`Failed to kill FFmpeg process for session ${this.guidResolver.resolve(sessionId)}: ${err}`,
				);
			}
			this.activeProcesses.delete(sessionId);
		}
	}

	/**
	 * Attempt to raise the priority of an FFmpeg process for active streaming.
	 * On Unix: renice to -5 (higher priority). On Windows: wmic to AboveNormal.
	 * Failures are silently ignored (may require elevated privileges).
	 */
	boostProcessPriority(sessionId: string): void {
		const proc = this.activeProcesses.get(sessionId);
		if (!proc?.pid) return;
		try {
			if (process.platform === 'win32') {
				execSync(
					`wmic process where ProcessId=${proc.pid} CALL setpriority "above normal"`,
					{ stdio: 'ignore' },
				);
			} else {
				execSync(`renice -n -5 -p ${proc.pid}`, { stdio: 'ignore' });
			}
			this.logger.debug(
				`Boosted FFmpeg priority for session ${this.guidResolver.resolve(sessionId)} (PID ${proc.pid})`,
			);
		} catch {
			// Requires elevated privileges — silently ignore
		}
	}

	getSessionDir(sessionId: string): string {
		return path.join(this.cacheDir, sessionId);
	}

	async cleanup(sessionId: string): Promise<void> {
		const sessionDir = this.getSessionDir(sessionId);
		try {
			await rm(sessionDir, { recursive: true, force: true });
			this.logger.log(
				`Cleaned up transcode files for session ${this.guidResolver.resolve(sessionId)}`,
			);
		} catch (err) {
			this.logger.warn(
				`Failed to clean up session ${this.guidResolver.resolve(sessionId)}: ${err}`,
			);
		}
	}

	/** Return PIDs of all active child processes (for memory tracking). */
	getChildPids(): number[] {
		const pids: number[] = [];
		for (const proc of this.activeProcesses.values()) {
			if (proc.pid != null && !proc.killed) pids.push(proc.pid);
		}
		return pids;
	}

	/**
	 * Retry a failed transcode using software encoding (libx264).
	 * Called automatically when hardware acceleration fails.
	 */
	private async retryWithSoftware(
		sessionId: string,
		filePath: string,
		options: TranscodeOptions,
		outputDir?: string,
	): Promise<void> {
		const targetDir = outputDir || this.getSessionDir(sessionId);

		// Clean up the failed attempt
		try {
			await rm(targetDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
		await mkdir(targetDir, { recursive: true });

		const quality = options.quality || '1080p';
		const profile =
			TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES] ??
			TRANSCODING_PROFILES['1080p'];

		if (!profile) throw new Error(`No transcoding profile found for quality "${quality}"`);

		const outputPath = path.join(targetDir, 'stream.m3u8');
		const segmentPattern = path.join(targetDir, 'segment_%04d.ts');
		const enc = this.getEncodingSettings();
		const segDuration = String(enc.segmentDuration);
		// Force software settings — this is a SW fallback, ignore NVENC settings.
		// Synthesize a shadow `enc` with hwAccel='none' so getRateControlOpts
		// emits libx264 CRF + maxrate (not NVENC VBR) even when the global
		// setting selects NVENC.
		const swRateOpts = this.getRateControlOpts(
			{ ...enc, hwAccel: 'none' },
			profile.videoBitrate,
		);
		const swPreset = enc.hwAccel === 'nvenc' ? 'veryfast' : enc.preset;
		const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
		const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

		return new Promise<void>((resolve, reject) => {
			let command = this.createFfmpegCommand(filePath)
				.outputOptions([
					'-f',
					'hls',
					'-hls_time',
					segDuration,
					'-hls_list_size',
					'0',
					'-hls_segment_filename',
					segmentPattern,
					'-hls_playlist_type',
					'event',
					'-hls_flags',
					'independent_segments',
				])
				.videoCodec('libx264')
				.audioCodec('aac')
				.outputOptions([
					'-ac',
					'2',
					'-vf',
					scaleFilter,
					'-g',
					gopSize,
					'-sc_threshold',
					'0',
					'-b:a',
					profile.audioBitrate,
					...swRateOpts,
				])
				.outputOptions(['-preset', swPreset])
				.outputOptions(['-map', '0:v:0']);

			if (options.audioTrack !== undefined) {
				command = command.outputOptions(['-map', `0:a:${options.audioTrack}?`]);
			} else {
				command = command.outputOptions(['-map', '0:a:0?']);
			}

			command
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.logger.log(
						`FFmpeg SW fallback started for session ${this.guidResolver.resolve(sessionId)}`,
					);
					this.logger.debug(`FFmpeg command: ${commandLine}`);
					this.sessionStates.set(sessionId, { state: 'running' });
					resolve();
				})
				.on('progress', (progress: any) => {
					this.logger.debug(
						`SW fallback progress [${this.guidResolver.resolve(sessionId)}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`FFmpeg SW fallback error for session ${this.guidResolver.resolve(sessionId)}: ${err.message}`,
					);
					this.activeProcesses.delete(sessionId);

					// Software encoding ALSO failed. If it's the Windows DLL
					// init failure it means FFmpeg can't spawn at all — engage
					// the circuit breaker and surface the encoder banner so
					// the user knows why their next several jobs will fail too.
					if (this.isWindowsSpawnFailure(err)) {
						this.markFfmpegSpawnBroken();
					}

					const friendly = this.explainFfmpegError(err, []);
					this.sessionStates.set(sessionId, { state: 'failed', error: friendly });
					reject(new Error(friendly));
				})
				.on('end', () => {
					this.logger.log(
						`SW fallback transcode complete for session ${this.guidResolver.resolve(sessionId)}`,
					);
					this.activeProcesses.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'completed' });
					if (outputDir) {
						writeFile(path.join(targetDir, '.complete'), '').catch(() => {});
					}
				});

			command.run();
			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(sessionId, ffmpegProcess);
			}
		});
	}

	/**
	 * Retry a failed pre-transcode using software encoding (libx264).
	 */
	private async preTranscodeWithSoftware(
		movieFileId: string,
		filePath: string,
		quality: string,
		persistDir: string,
		onProgress?: (percent: number) => void,
	): Promise<void> {
		// Clean up the failed attempt
		try {
			await rm(persistDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
		await mkdir(persistDir, { recursive: true });

		const profile = (TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES] ??
			TRANSCODING_PROFILES['1080p'])!;
		const enc = this.getEncodingSettings();
		const segDuration = String(enc.segmentDuration);
		// Force software settings — this is a SW fallback, ignore NVENC settings.
		// Synthesize a shadow `enc` with hwAccel='none' so getRateControlOpts
		// emits libx264 CRF + maxrate (not NVENC VBR) even when the global
		// setting selects NVENC.
		const swRateOpts = this.getRateControlOpts(
			{ ...enc, hwAccel: 'none' },
			profile.videoBitrate,
		);
		// Map NVENC presets back to libx264 presets
		const swPreset = enc.hwAccel === 'nvenc' ? 'veryfast' : enc.preset;
		const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
		const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

		const outputPath = path.join(persistDir, 'stream.m3u8');
		const segmentPattern = path.join(persistDir, 'segment_%04d.ts');
		const processKey = `pre-${movieFileId}-${quality}`;

		return new Promise<void>((resolve, reject) => {
			const command = this.createFfmpegCommand(filePath)
				.outputOptions([
					'-f',
					'hls',
					'-hls_time',
					segDuration,
					'-hls_list_size',
					'0',
					'-hls_segment_filename',
					segmentPattern,
					'-hls_playlist_type',
					'event',
					'-hls_flags',
					'independent_segments',
				])
				.videoCodec('libx264')
				.audioCodec('aac')
				.outputOptions([
					'-ac',
					'2',
					'-vf',
					scaleFilter,
					'-g',
					gopSize,
					'-sc_threshold',
					'0',
					'-b:a',
					profile.audioBitrate,
					...swRateOpts,
				])
				.outputOptions(['-preset', swPreset])
				.outputOptions(['-map', '0:v:0', '-map', '0:a:0?'])
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.logger.log(
						`Pre-transcode SW fallback started for ${this.guidResolver.resolve(movieFileId)}: ${commandLine}`,
					);
				})
				.on('progress', (progress: any) => {
					const pct = progress.percent;
					if (typeof pct === 'number' && !Number.isNaN(pct)) {
						onProgress?.(Math.min(100, Math.max(0, pct)));
					}
					this.logger.debug(
						`Pre-transcode SW fallback [${this.guidResolver.resolve(movieFileId)}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`Pre-transcode SW fallback error for ${this.guidResolver.resolve(movieFileId)}: ${err.message}`,
					);
					this.activeProcesses.delete(processKey);

					// Same handling as the live-stream SW fallback path: if the
					// software fallback ALSO hits a Windows DLL init failure,
					// FFmpeg itself is busted and queueing more jobs will just
					// keep failing. Engage the circuit breaker.
					if (this.isWindowsSpawnFailure(err)) {
						this.markFfmpegSpawnBroken();
					}

					const friendly = this.explainFfmpegError(err, []);
					reject(new Error(friendly));
				})
				.on('end', () => {
					this.logger.log(
						`Pre-transcode SW fallback complete for ${this.guidResolver.resolve(movieFileId)}/${quality}`,
					);
					this.activeProcesses.delete(processKey);
					writeFile(path.join(persistDir, '.complete'), '')
						.then(() => resolve())
						.catch(() => resolve());
				});

			command.run();
			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(processKey, ffmpegProcess);
			}
		});
	}

	/**
	 * Windows exit code 0xC0000142 (3221225794) = STATUS_DLL_INIT_FAILED.
	 * This means FFmpeg itself can't start — retrying immediately will fail and
	 * leak handles, making the problem worse. Back off for 60s.
	 */
	private isWindowsSpawnFailure(err: Error): boolean {
		return err.message.includes('3221225794');
	}

	private markFfmpegSpawnBroken(): void {
		this.ffmpegSpawnFailCount++;
		// Only pause after 3+ consecutive failures (transient issues are common)
		if (this.ffmpegSpawnFailCount < 3) {
			this.logger.warn(
				`FFmpeg spawn failure (${this.ffmpegSpawnFailCount}/3) — will retry on next request`,
			);
			return;
		}
		if (this.ffmpegSpawnBroken) return;
		this.ffmpegSpawnBroken = true;
		this.ffmpegSpawnBrokenUntil = Date.now() + 15_000;
		this.logger.warn('FFmpeg spawn failed 3+ times — pausing background encoding for 15s');

		// Surface to the user via the encoder-health banner. This is a
		// stronger failure than hwAccelBroken (NVENC-only): FFmpeg
		// can't spawn at all, so the software fallback won't save us
		// either. We piggyback on the same banner channel rather than
		// inventing a parallel UI path — the user just needs to know
		// "encoding is busted right now, here's why".
		this.setHwAccelBroken(
			'FFmpeg failed to start (Windows DLL init error 0xC0000142). Software fallback also failed. Try restarting the audio / GPU service in Task Manager, or restart Windows.',
			'spawn',
		);

		setTimeout(() => {
			this.ffmpegSpawnBroken = false;
			this.ffmpegSpawnFailCount = 0;
			this.logger.log('FFmpeg spawn cooldown expired — encoding re-enabled');
		}, 15_000);
	}

	/** Reset spawn failure counter on successful FFmpeg start */
	private resetFfmpegSpawnFailCount(): void {
		this.ffmpegSpawnFailCount = 0;
	}

	/** Returns true if FFmpeg spawns are temporarily disabled (background only) */
	isFfmpegSpawnBroken(): boolean {
		if (this.ffmpegSpawnBroken && Date.now() > this.ffmpegSpawnBrokenUntil) {
			this.ffmpegSpawnBroken = false;
			this.ffmpegSpawnFailCount = 0;
		}
		return this.ffmpegSpawnBroken;
	}

	/**
	 * Create an FFmpeg command with base input options.
	 *
	 * The input path is wrapped in the `file:` protocol so FFmpeg never
	 * tries to interpret it. Without this, square brackets in folder /
	 * file names (`[TGx]`, `[Hurtom]`, `[Ukr, Eng]` in YIFY-style
	 * release tags) collide with FFmpeg's filter-graph and `concat:`
	 * syntax — input parsing fails before encoding even starts, with
	 * an error that previously got misattributed to the encoder.
	 *
	 * On Windows, explicitly disables hardware decoding to prevent
	 * NVIDIA DLL loading failures (0xC0000142) in non-interactive
	 * sessions.
	 */
	private createFfmpegCommand(filePath: string): ReturnType<typeof ffmpeg> {
		const command = ffmpeg(`file:${filePath}`);
		if (process.platform === 'win32') {
			command.inputOptions(['-hwaccel', 'none']);
		}
		// Limit FFmpeg thread count to avoid saturating the system.
		// Reserve at least 2 cores for the OS and the Node.js process.
		const cpuCount = os.cpus().length;
		const maxThreads = Math.max(1, Math.floor(cpuCount / 2));
		command.outputOptions(['-threads', String(maxThreads)]);
		return command;
	}

	/**
	 * Append a single FFmpeg stderr line to the rolling buffer for the
	 * session. Bounded to {@link STDERR_BUFFER_LINES} lines so memory
	 * stays predictable even on long-running encodes that emit progress
	 * to stderr.
	 */
	private appendSessionStderr(sessionId: string, line: string): void {
		const buf = this.sessionStderr.get(sessionId);
		if (!buf) return;
		buf.push(line);
		if (buf.length > TranscoderService.STDERR_BUFFER_LINES) {
			buf.splice(0, buf.length - TranscoderService.STDERR_BUFFER_LINES);
		}
	}

	/**
	 * Translate a raw FFmpeg failure into a short, human-readable
	 * explanation that ends up in `jobHistory.error` and the admin UI.
	 *
	 * Without this, the user sees opaque exit codes (e.g. 3199971767 =
	 * AVERROR_INVALIDDATA) and has to look them up. With this, common
	 * failure modes (corrupt file, missing file, GPU unavailable, etc.)
	 * become self-explanatory at a glance. The original technical
	 * message is still logged at error level for diagnosis.
	 */
	private explainFfmpegError(err: Error, stderrLines: string[]): string {
		const hay = `${err.message}\n${stderrLines.join('\n')}`.toLowerCase();
		if (
			hay.includes('ebml header parsing failed') ||
			hay.includes('invalid as first byte of an ebml')
		) {
			return 'Source file appears corrupt — the Matroska/MKV header is missing or damaged. The file may have been truncated or incompletely downloaded.';
		}
		if (hay.includes('invalid data found when processing input')) {
			return 'Source file format could not be parsed — the file is corrupt or in an unsupported format.';
		}
		if (
			hay.includes('no such file or directory') ||
			hay.includes('error opening input file') ||
			hay.includes('error opening input files')
		) {
			return 'Could not open source file — it may have been moved, renamed, or the path contains characters FFmpeg cannot parse.';
		}
		if (hay.includes('permission denied')) {
			return 'Cannot read source file — permission denied.';
		}
		if (hay.includes('no nvenc capable devices') || hay.includes('cannot load nvencodeapi')) {
			return 'Hardware encoder (NVENC) is unavailable on this system. Software encoding will be used instead.';
		}
		if (hay.includes('3221225794') || hay.includes('c0000142')) {
			return 'FFmpeg failed to start (Windows DLL initialization error). Will retry shortly.';
		}
		if (hay.includes('protocol not found')) {
			return 'FFmpeg refused the input — likely a path containing FFmpeg-reserved characters.';
		}
		// Strip the noisy "ffmpeg exited with code N: " prefix when nothing
		// matched, so at minimum the user sees the human-readable tail.
		return err.message.replace(/^ffmpeg exited with code \d+:\s*/i, '');
	}

	/**
	 * Decide whether an FFmpeg error is plausibly a hardware-encoder
	 * problem (NVENC / QSV / VAAPI / DXVA) vs a generic input/output
	 * issue (path parse error, file not found, permission denied).
	 *
	 * Conservative by design: anything that isn't clearly a hardware
	 * failure returns false, so `hwAccelBroken` only flips on real GPU
	 * problems. The bracket-in-path bug used to fail-fast at input
	 * parse, then this code mistakenly attributed the failure to the
	 * encoder and globally disabled hardware encoding for everyone.
	 */
	private isHardwareEncoderFailure(
		hwAccel: string,
		errMessage: string,
		stderrLines: string[],
	): boolean {
		if (hwAccel === 'none') return false;
		const haystack = `${errMessage}\n${stderrLines.join('\n')}`.toLowerCase();
		// A process terminated by signal (a seek-restart / stop / cancel we issued)
		// is never a GPU failure — its stderr just still mentions the encoder name.
		// Backstop to the intentionallyStopped guard for kills via other paths.
		if (
			haystack.includes('killed with signal') ||
			haystack.includes('sigkill') ||
			haystack.includes('sigterm') ||
			haystack.includes('signal 15') ||
			haystack.includes('signal 9') ||
			haystack.includes('received signal')
		) {
			return false;
		}
		// Generic "input file is bad" markers — these are NEVER the
		// encoder's fault; bail out before the hardware check.
		if (
			haystack.includes('error opening input file') ||
			haystack.includes('no such file or directory') ||
			haystack.includes('permission denied') ||
			haystack.includes('protocol not found')
		) {
			return false;
		}
		// Only PERSISTENT hardware / driver / DLL failures globally disable the
		// GPU. We deliberately do NOT match the bare encoder name ('nvenc' /
		// 'gpu' / 'cuda') — those appear in normal FFmpeg output, so a killed or
		// interrupted nvenc encode used to trip a false "GPU broken" and disable
		// hardware encoding for everyone. Transient / load failures (session
		// limit, out of memory) are also excluded — they fail just that one job,
		// not the whole GPU.
		const brokenMarkers = [
			'no capable devices found',
			'no nvenc capable devices',
			'cannot load nvcuda',
			'cannot load nvencodeapi',
			'cannot load library',
			'driver does not support',
			'the minimum required nvidia driver',
			'incompatible client key',
			'nvenc api version',
			'0xc0000142',
			'3221225794',
			'failed to initialise vaapi',
			'error initializing the mfx session',
		];
		return brokenMarkers.some((m) => haystack.includes(m));
	}

	/**
	 * Mark hardware encoding as broken globally and broadcast a
	 * `server:status` event so the client can surface a banner.
	 *
	 * `reason` should be the most diagnostic piece of FFmpeg output we
	 * have (last stderr line, the encoder name, etc.) so the user can
	 * see what actually went wrong. `since` lets the client deduplicate
	 * dismissals against re-fires of the same failure.
	 */
	private setHwAccelBroken(reason: string, hwAccel: string): void {
		if (this.hwAccelBroken) return; // already flipped — don't re-broadcast
		this.hwAccelBroken = true;
		this.settings.set('hwAccelBroken', true);
		const since = new Date().toISOString();
		this.settings.set('hwAccelBrokenSince', since);
		this.settings.set('hwAccelBrokenReason', reason);
		this.logger.error(
			`Hardware encoder (${hwAccel}) BROKEN — falling back to software for all sessions. Reason: ${reason}`,
		);
		this.events.emit(WsEvent.SERVER_STATUS, {
			type: 'encoder-degraded',
			encoderDegraded: true,
			hwAccel,
			reason,
			since,
		});
	}

	/**
	 * Manually clear the hwAccelBroken flag — used by the admin "Reset
	 * & Retry" button when a user has fixed the GPU / driver / DLL
	 * issue and wants to attempt hardware encoding again. Subsequent
	 * encode failures will of course re-flip the flag if the underlying
	 * problem isn't actually fixed.
	 */
	resetHwAccelBroken(): void {
		if (!this.hwAccelBroken) return;
		this.hwAccelBroken = false;
		this.settings.delete('hwAccelBroken');
		this.settings.delete('hwAccelBrokenSince');
		this.settings.delete('hwAccelBrokenReason');
		this.logger.log(
			'Hardware encoder broken flag manually cleared — will retry hardware encoding',
		);
		this.events.emit(WsEvent.SERVER_STATUS, {
			type: 'encoder-degraded',
			encoderDegraded: false,
		});
	}

	/**
	 * Map a configured `hwAccel` value to the FFmpeg encoder name we'd
	 * use for it. Used by the encoder probe.
	 */
	private encoderForHwAccel(hwAccel: string): string {
		switch (hwAccel) {
			case 'nvenc':
				return 'h264_nvenc';
			case 'qsv':
				return 'h264_qsv';
			case 'vaapi':
				return 'h264_vaapi';
			default:
				return 'libx264';
		}
	}

	/**
	 * Run a tiny test transcode through the configured hardware encoder
	 * to verify it actually works. Generates a 0.1s null-source video
	 * (`-f lavfi -i nullsrc`), pipes it through `h264_nvenc` (or qsv /
	 * vaapi), and discards the output. If FFmpeg exits 0 the encoder
	 * is operational; on failure we capture stderr so the caller can
	 * surface the actual reason.
	 */
	private probeEncoder(
		encoderName: string,
	): Promise<{ ok: true } | { ok: false; stderr: string }> {
		return new Promise((resolve) => {
			const args = [
				'-hide_banner',
				'-y',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				'nullsrc=size=320x240:rate=24:duration=0.1',
				'-c:v',
				encoderName,
				'-t',
				'0.1',
				'-f',
				'null',
				'-',
			];
			const ff = spawn(this.ffmpegPath, args, { windowsHide: true });
			let stderr = '';
			ff.stderr?.on('data', (d) => {
				stderr += d.toString();
			});
			let resolved = false;
			const finish = (result: { ok: true } | { ok: false; stderr: string }) => {
				if (resolved) return;
				resolved = true;
				resolve(result);
			};
			ff.on('close', (code) => {
				if (code === 0) finish({ ok: true });
				else
					finish({
						ok: false,
						stderr: stderr.trim() || `Probe exited with code ${code}`,
					});
			});
			ff.on('error', (err) => finish({ ok: false, stderr: err.message }));
			// Hard timeout — a 0.1s probe should finish in <1s; if it doesn't,
			// FFmpeg is stuck and we treat that as a failure.
			setTimeout(() => {
				if (!resolved) {
					try {
						ff.kill('SIGKILL');
					} catch {}
					finish({ ok: false, stderr: 'Probe timed out after 10s' });
				}
			}, 10_000);
		});
	}

	/**
	 * Try to recover from a broken hardware-encoder state.
	 *
	 *   1. Kill orphan FFmpeg processes that may be holding NVENC
	 *      sessions or DLL handles.
	 *   2. Brief settle delay so the OS can reclaim resources.
	 *   3. Reset all the broken-state flags (hwAccelBroken,
	 *      ffmpegSpawnBroken, fail counters).
	 *   4. Run a tiny probe transcode through the configured hardware
	 *      encoder. If it succeeds → broadcast the all-clear and
	 *      report success. If it fails → re-set the broken flag with
	 *      the new probe stderr as the reason and return failure.
	 *
	 * Returns a structured report so callers can surface the action
	 * log and probe stderr to the user.
	 */
	async recycleHwAccel(): Promise<{
		ok: boolean;
		message: string;
		actions: string[];
		probeStderr?: string;
	}> {
		const actions: string[] = [];
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as Record<
			string,
			unknown
		>;
		const configuredHwAccel = (enc?.hwAccel as string) || 'none';

		if (configuredHwAccel === 'none') {
			return {
				ok: false,
				message: 'No hardware encoder is configured (encoding.hwAccel is "none").',
				actions,
			};
		}

		// Step 1: kill orphan FFmpegs.
		actions.push('Killing orphan FFmpeg processes…');
		try {
			if (process.platform === 'win32') {
				execSync('taskkill /F /IM ffmpeg.exe /T', { timeout: 5000, stdio: 'pipe' });
			} else {
				execSync('pkill -9 ffmpeg || true', { timeout: 5000, stdio: 'pipe' });
			}
			actions.push('  ✓ ffmpeg processes terminated');
		} catch {
			// taskkill exits non-zero when no matching process exists — fine.
			actions.push('  · no orphan ffmpeg processes to kill');
		}

		// Step 2: settle.
		await new Promise<void>((r) => setTimeout(r, 1000));
		actions.push('Settled for 1s');

		// Step 3: clear broken-state flags so the chain rebuilds with hw on.
		this.hwAccelBroken = false;
		this.ffmpegSpawnBroken = false;
		this.ffmpegSpawnFailCount = 0;
		this.settings.delete('hwAccelBroken');
		this.settings.delete('hwAccelBrokenSince');
		this.settings.delete('hwAccelBrokenReason');
		actions.push('Cleared broken-state flags (hwAccelBroken, spawn-broken, fail counters)');

		// Step 4: probe.
		const encoderName = this.encoderForHwAccel(configuredHwAccel);
		actions.push(`Probing ${encoderName} with a 0.1s null-source transcode…`);
		const result = await this.probeEncoder(encoderName);

		if (result.ok) {
			actions.push(`  ✓ Probe succeeded — ${configuredHwAccel} is operational`);
			this.logger.log(`Hardware encoder recycle succeeded: ${configuredHwAccel} probe OK`);
			this.events.emit(WsEvent.SERVER_STATUS, {
				type: 'encoder-degraded',
				encoderDegraded: false,
			});
			return {
				ok: true,
				message: `Hardware encoder (${configuredHwAccel}) recycled successfully and is operational.`,
				actions,
			};
		}

		actions.push(`  ✗ Probe failed: ${result.stderr.split('\n').pop() ?? 'unknown'}`);
		this.logger.warn(
			`Hardware encoder recycle: probe still failing for ${configuredHwAccel}: ${result.stderr}`,
		);
		// Re-flip the broken flag with the probe's actual reason so the
		// banner reflects the post-recycle state.
		this.setHwAccelBroken(
			`Probe still failing after recycle: ${result.stderr.split('\n').pop()?.trim() ?? result.stderr}`,
			configuredHwAccel,
		);
		return {
			ok: false,
			message: `Hardware encoder (${configuredHwAccel}) probe still failing after recycle.`,
			actions,
			probeStderr: result.stderr,
		};
	}

	/**
	 * Lower the OS priority of a spawned FFmpeg child process so it doesn't
	 * starve the rest of the system. Uses os.setPriority() which maps to
	 * BELOW_NORMAL_PRIORITY_CLASS on Windows and nice 10 on Unix.
	 */
	private lowerProcessPriority(proc: ChildProcess, label: string): void {
		if (!proc.pid) return;
		try {
			// os.constants.priority.PRIORITY_BELOW_NORMAL = 10 on Windows, nice 10 on Unix
			os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
			this.logger.debug(`Set below-normal priority for FFmpeg PID ${proc.pid} (${label})`);
		} catch (err: any) {
			this.logger.debug(`Could not lower priority for PID ${proc.pid}: ${err.message}`);
		}
	}

	/**
	 * Build rate-control FFmpeg options.
	 *
	 * For CRF mode we now ALSO emit `-maxrate` + `-bufsize` (set to the
	 * profile's nominal video bitrate + 2× bufsize). This caps the burst
	 * budget on complex/grainy scenes so a CRF-23 1080p movie can't blow
	 * past ~5 Mbps and produce 4-5 GB files for a 90-minute runtime —
	 * which was the previous behavior with uncapped CRF.
	 *
	 * For NVENC + CRF, we switch from `-rc constqp` (which is even more
	 * bursty than libx264's CRF) to `-rc vbr -cq X -b:v 0 -maxrate Y -bufsize Z`.
	 * VBR with a VBV cap delivers significantly tighter file sizes for
	 * essentially the same perceptual quality. NVENC's `constqp` ignores
	 * rate budgets entirely.
	 *
	 * For CBR mode the bitrate alone is sufficient — unchanged.
	 */
	getRateControlOpts(
		enc: ReturnType<TranscoderService['getEncodingSettings']>,
		videoBitrate: string,
	): string[] {
		if (enc.rateControl === 'crf') {
			const maxrate = videoBitrate;
			const bufsize = doubleBitrate(videoBitrate);
			if (enc.hwAccel === 'nvenc') {
				return [
					'-rc',
					'vbr',
					'-cq',
					String(enc.crf),
					'-b:v',
					'0',
					'-maxrate',
					maxrate,
					'-bufsize',
					bufsize,
				];
			}
			return ['-crf', String(enc.crf), '-maxrate', maxrate, '-bufsize', bufsize];
		}
		return ['-b:v', videoBitrate];
	}

	/**
	 * Effective hardware-accel mode after the broken-encoder guard. Returns
	 * 'none' when hardware encoding has been marked broken (e.g. NVENC can't
	 * init in a non-interactive session). Public so ConversionService can gate
	 * the AV1 path on a genuinely-usable GPU encoder.
	 */
	getEffectiveHwAccel(): string {
		return this.getEncodingSettings().hwAccel;
	}

	/**
	 * Acquire an encoder for a background encode job (CPU+GPU parallel mode).
	 * First concurrent job gets the GPU; the rest get the CPU. When no usable
	 * GPU is configured everything is 'cpu'. Pair with releaseEncoderLease().
	 */
	acquireEncoderLease(holder: string): 'gpu' | 'cpu' {
		if (this.getEffectiveHwAccel() === 'none') {
			this.encoderLeases.set(holder, 'cpu');
			return 'cpu';
		}
		const gpuTaken = [...this.encoderLeases.values()].includes('gpu');
		const kind: 'gpu' | 'cpu' = gpuTaken ? 'cpu' : 'gpu';
		this.encoderLeases.set(holder, kind);
		return kind;
	}

	releaseEncoderLease(holder: string): void {
		this.encoderLeases.delete(holder);
	}

	/** Configured AV1 NVENC quality (CQ). Public accessor for UI/job summaries. */
	getAv1Cq(): number {
		return this.getEncodingSettings().av1Cq;
	}

	private getEncodingSettings() {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const configuredHwAccel = enc?.hwAccel || 'none';
		const hwAccel = this.hwAccelBroken ? 'none' : configuredHwAccel;
		const configuredPreset = enc?.preset || 'veryfast';
		// NVENC uses different preset names: map libx264 presets to NVENC equivalents
		const preset =
			hwAccel === 'nvenc' ? this.mapNvencPreset(configuredPreset) : configuredPreset;
		const av1Cq = Number(enc?.av1Cq);
		return {
			hwAccel,
			preset,
			rateControl: enc?.rateControl || 'cbr',
			crf: enc?.crf ?? 23,
			// AV1 NVENC constant-quality (0–63; ~32 is a good 1080p balance).
			av1Cq: Number.isFinite(av1Cq) && av1Cq > 0 ? av1Cq : 32,
			segmentDuration: enc?.segmentDuration ?? 4,
			// Force 8-bit output for hardware encoders (NVENC doesn't support 10-bit H.264)
			pixFmt: hwAccel !== 'none' ? 'yuv420p' : undefined,
		};
	}

	/**
	 * Transcode a single chunk (time range) of a movie into an MPEG-TS segment.
	 * Returns a promise that resolves when the chunk is fully encoded.
	 */
	async transcodeChunk(
		filePath: string,
		outputPath: string,
		startTime: number,
		chunkDuration: number,
		quality: string = '1080p',
		useSoftware = false,
	): Promise<void> {
		if (this.isFfmpegSpawnBroken()) {
			throw new Error('FFmpeg spawn temporarily disabled (Windows DLL error cooldown)');
		}
		const profile =
			TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES] ??
			TRANSCODING_PROFILES['1080p'];
		if (!profile) throw new Error(`No transcoding profile for quality "${quality}"`);

		const enc = this.getEncodingSettings();
		const forceSoftware = useSoftware || this.hwAccelBroken;
		const hwAccel = forceSoftware ? 'none' : enc.hwAccel;
		const videoCodec = forceSoftware ? 'libx264' : this.getVideoCodec(hwAccel);
		const videoRateOpts = this.getRateControlOpts(enc, profile.videoBitrate);
		const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
		const gopSize = String(Math.round((chunkDuration * 24) / 2) * 2);
		const processKey = `chunk-${path.basename(outputPath, '.ts')}`;

		return new Promise<void>((resolve, reject) => {
			let command = this.createFfmpegCommand(filePath)
				.inputOptions(['-ss', String(startTime)])
				.outputOptions([
					'-t',
					String(chunkDuration),
					'-f',
					'mpegts',
					'-force_key_frames',
					'expr:eq(t,0)',
					'-output_ts_offset',
					String(startTime),
				])
				.videoCodec(videoCodec)
				.audioCodec('aac')
				.outputOptions([
					'-ac',
					'2',
					'-vf',
					scaleFilter,
					'-g',
					gopSize,
					'-sc_threshold',
					'0',
					'-b:a',
					profile.audioBitrate,
					...videoRateOpts,
					'-preset',
					enc.preset,
					...(enc.pixFmt ? ['-pix_fmt', enc.pixFmt] : []),
					'-map',
					'0:v:0',
					'-map',
					'0:a:0?',
				]);

			// Hardware acceleration input options
			if (hwAccel === 'nvenc') {
				// Don't add -hwaccel cuda — it conflicts with CPU-based scale filters.
				// NVENC still uses GPU for encoding; only decoding stays on CPU.
			} else if (hwAccel === 'vaapi') {
				command = command.inputOptions([
					'-hwaccel',
					'vaapi',
					'-hwaccel_output_format',
					'vaapi',
					'-vaapi_device',
					'/dev/dri/renderD128',
				]);
			} else if (hwAccel === 'qsv') {
				command = command.inputOptions(['-hwaccel', 'qsv']);
			}

			command
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.resetFfmpegSpawnFailCount();
					this.logger.debug(`Chunk encode started: ${path.basename(outputPath)}`);
					this.transcodeDebugger.recordFFmpegCommand(processKey, commandLine);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`Chunk encode failed ${path.basename(outputPath)}: ${err.message}`,
					);
					this.transcodeDebugger.recordEvent(processKey, 'ffmpeg_error', err.message);
					this.activeProcesses.delete(processKey);

					// Windows DLL init failure with software — FFmpeg itself is broken
					if (this.isWindowsSpawnFailure(err) && hwAccel === 'none') {
						this.markFfmpegSpawnBroken();
						reject(err);
						return;
					}

					// If hardware encoding failed, retry with software
					// Don't persist hwAccelBroken for background chunks — transient issues
					if (hwAccel !== 'none' && !forceSoftware) {
						this.logger.warn(
							`HW accel failed for chunk ${path.basename(outputPath)}, retrying with software (not persisting globally)`,
						);
						this.transcodeChunk(
							filePath,
							outputPath,
							startTime,
							chunkDuration,
							quality,
							true,
						)
							.then(resolve)
							.catch(reject);
						return;
					}
					reject(err);
				})
				.on('end', () => {
					this.logger.debug(`Chunk encode complete: ${path.basename(outputPath)}`);
					this.activeProcesses.delete(processKey);
					this.transcodeDebugger.recordEvent(
						processKey,
						'ffmpeg_complete',
						'Chunk encode finished',
					);
					resolve();
				});

			command.run();
			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(processKey, ffmpegProcess);
				this.lowerProcessPriority(ffmpegProcess, processKey);
				this.transcodeDebugger.attachStderr(processKey, ffmpegProcess);
			}
		});
	}

	/**
	 * Get a hash of the current encoding settings for cache invalidation.
	 */
	getEncodingSettingsHash(): string {
		const enc = this.getEncodingSettings();
		return JSON.stringify({
			hwAccel: enc.hwAccel,
			preset: enc.preset,
			rateControl: enc.rateControl,
			crf: enc.crf,
		});
	}

	/**
	 * Map libx264 preset names to NVENC equivalents.
	 * NVENC uses p1-p7 or slow/medium/fast, not ultrafast/veryfast/etc.
	 */
	private mapNvencPreset(preset: string): string {
		const map: Record<string, string> = {
			ultrafast: 'p1',
			superfast: 'p1',
			veryfast: 'p2',
			faster: 'p3',
			fast: 'p4',
			medium: 'p5',
			slow: 'p6',
			slower: 'p7',
			veryslow: 'p7',
		};
		return map[preset] ?? 'p2';
	}

	private getVideoCodec(hwAccel: string): string {
		switch (hwAccel) {
			case 'nvenc':
				return 'h264_nvenc';
			case 'vaapi':
				return 'h264_vaapi';
			case 'qsv':
				return 'h264_qsv';
			default:
				return 'libx264';
		}
	}
}
