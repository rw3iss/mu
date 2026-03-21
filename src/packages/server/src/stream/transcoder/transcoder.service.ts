import { ChildProcess, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { transcodeCache } from '../../database/schema/index.js';
import { SettingsService } from '../../settings/settings.service.js';
import { TRANSCODING_PROFILES } from './transcoder.profiles.js';

interface TranscodeOptions {
	quality?: string;
	audioTrack?: number;
	subtitleTrack?: number;
	/** Start transcoding from this position (seconds). Used for seek-restart. */
	seekSeconds?: number;
}

type TranscodeState = 'running' | 'completed' | 'failed';

@Injectable()
export class TranscoderService implements OnModuleDestroy {
	private readonly logger = new Logger(TranscoderService.name);
	private readonly activeProcesses = new Map<string, ChildProcess>();
	/** Tracks the state of each transcode session (running / completed / failed) */
	private readonly sessionStates = new Map<string, { state: TranscodeState; error?: string }>();
	/** Sessions that have already retried with software encoding (prevents infinite loops) */
	private readonly swFallbackAttempted = new Set<string>();
	/** If true, hardware encoding has failed and all encodes should use software */
	private hwAccelBroken = false;
	private readonly cacheDir: string;

	constructor(
		private readonly config: ConfigService,
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
	) {
		this.cacheDir = path.resolve(
			this.config.get<string>('cache.streamDir') || './data/cache/streams',
		);

		// Restore hwAccelBroken from persisted settings
		this.hwAccelBroken = this.settings.get<boolean>('hwAccelBroken', false);

		// Set explicit ffmpeg/ffprobe paths from config
		// This avoids PATH issues on Windows (WinGet symlink permissions, Git Bash vs system PATH)
		const ffmpegPath = this.config.get<string>('transcoding.ffmpegPath', 'ffmpeg');
		const ffprobePath = this.config.get<string>('transcoding.ffprobePath', 'ffprobe');
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
						this.logger.log(`Auto-detected ffmpeg at: ${candidate}`);
						break;
					}
				} catch {}
			}
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
	async clearCache(movieFileId?: string): Promise<void> {
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

	async startTranscode(
		sessionId: string,
		filePath: string,
		options: TranscodeOptions = {},
		outputDir?: string,
	): Promise<void> {
		const targetDir = outputDir || this.getSessionDir(sessionId);

		// Clean out stale partial files from a previously failed transcode
		if (outputDir) {
			try {
				await access(path.join(targetDir, 'stream.m3u8'));
				// File exists but no .complete marker (checked by caller) — wipe and recreate
				this.logger.warn(`Removing stale partial transcode in ${targetDir}`);
				await rm(targetDir, { recursive: true, force: true });
			} catch {
				// No existing file — nothing to clean
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
		const hwAccel = enc.hwAccel;
		const videoCodec = this.getVideoCodec(hwAccel);
		const segDuration = String(enc.segmentDuration);
		// GOP size = segment_duration × assumed_fps (round to nearest even)
		const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

		return new Promise<void>((resolve, reject) => {
			const videoRateOpts =
				enc.rateControl === 'crf'
					? ['-crf', String(enc.crf)]
					: ['-b:v', profile.videoBitrate];

			// Use scale filter instead of .size() to preserve aspect ratio
			const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;

			let command = ffmpeg(filePath);

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
					'-vf',
					scaleFilter,
					'-threads',
					'0',
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
					this.logger.log(
						`FFmpeg started for session ${sessionId}, outputDir=${targetDir}`,
					);
					this.logger.debug(`FFmpeg command: ${commandLine}`);
					this.sessionStates.set(sessionId, { state: 'running' });
					// Resolve immediately once FFmpeg starts; segments will be generated progressively
					resolve();
				})
				.on('progress', (progress: any) => {
					this.logger.debug(
						`Transcode progress [${sessionId}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(`FFmpeg error for session ${sessionId}: ${err.message}`);
					this.activeProcesses.delete(sessionId);

					// If hardware acceleration was used, retry with software encoding
					if (hwAccel !== 'none' && !this.swFallbackAttempted.has(sessionId)) {
						this.swFallbackAttempted.add(sessionId);
						this.hwAccelBroken = true;
						this.settings.set("hwAccelBroken", true);
						this.logger.warn(
							`Hardware acceleration (${hwAccel}) failed for session ${sessionId}, switching to software encoding globally`,
						);
						this.retryWithSoftware(sessionId, filePath, options, outputDir).catch(
							(retryErr) => {
								this.logger.error(
									`Software fallback also failed for session ${sessionId}: ${retryErr.message}`,
								);
							},
						);
						return;
					}

					this.sessionStates.set(sessionId, { state: 'failed', error: err.message });
					// Only reject if we haven't resolved yet
					reject(err);
				})
				.on('end', () => {
					this.logger.log(`Transcode complete for session ${sessionId}`);
					this.activeProcesses.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'completed' });
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
			}
		});
	}

	async startRemux(sessionId: string, filePath: string, outputDir?: string): Promise<void> {
		const targetDir = outputDir || this.getSessionDir(sessionId);

		// Clean out stale partial files from a previously failed remux
		if (outputDir) {
			try {
				await access(path.join(targetDir, 'stream.m3u8'));
				this.logger.warn(`Removing stale partial remux in ${targetDir}`);
				await rm(targetDir, { recursive: true, force: true });
			} catch {
				// No existing file — nothing to clean
			}
		}

		await mkdir(targetDir, { recursive: true });

		const outputPath = path.join(targetDir, 'stream.m3u8');
		const segmentPattern = path.join(targetDir, 'segment_%04d.ts');
		const enc = this.getEncodingSettings();
		const segDuration = String(enc.segmentDuration);

		return new Promise<void>((resolve, reject) => {
			const command = ffmpeg(filePath)
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
						`FFmpeg remux started for session ${sessionId}, outputDir=${targetDir}`,
					);
					this.logger.debug(`FFmpeg command: ${commandLine}`);
					this.sessionStates.set(sessionId, { state: 'running' });
					resolve();
				})
				.on('progress', (progress: any) => {
					this.logger.debug(
						`Remux progress [${sessionId}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`FFmpeg remux error for session ${sessionId}: ${err.message}`,
					);
					this.activeProcesses.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'failed', error: err.message });
					reject(err);
				})
				.on('end', () => {
					this.logger.log(`Remux complete for session ${sessionId}`);
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
	 * Run a full transcode or remux to the persistent cache directory.
	 * Resolves when FFmpeg finishes (not on start), so the cache is complete.
	 */
	async preTranscode(
		movieFileId: string,
		filePath: string,
		mode: string,
		quality: string = '1080p',
		onProgress?: (percent: number) => void,
	): Promise<void> {
		const persistDir = this.getPersistentDir(movieFileId, quality);

		// Already cached
		if (await this.hasCachedTranscode(movieFileId, quality)) {
			this.logger.log(`Pre-transcode skipped — cache exists for ${movieFileId}/${quality}`);
			return;
		}

		// Clean out stale partial files from a previously failed pre-transcode
		try {
			await access(path.join(persistDir, 'stream.m3u8'));
			this.logger.warn(`Removing stale partial pre-transcode in ${persistDir}`);
			await rm(persistDir, { recursive: true, force: true });
		} catch {
			// No existing file — nothing to clean
		}

		await mkdir(persistDir, { recursive: true });

		const outputPath = path.join(persistDir, 'stream.m3u8');
		const segmentPattern = path.join(persistDir, 'segment_%04d.ts');
		const processKey = `pre-${movieFileId}-${quality}`;

		const isTranscode = mode === 'transcode';

		const enc = this.getEncodingSettings();
		const hwAccel = enc.hwAccel;
		const segDuration = String(enc.segmentDuration);

		return new Promise<void>((resolve, reject) => {
			let command = ffmpeg(filePath).outputOptions([
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
				const videoRateOpts =
					enc.rateControl === 'crf'
						? ['-crf', String(enc.crf)]
						: ['-b:v', profile.videoBitrate];
				const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
				const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

				command = command
					.videoCodec(videoCodec)
					.audioCodec('aac')
					.outputOptions([
						'-vf',
						scaleFilter,
						'-threads',
						'0',
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
					this.logger.log(`Pre-transcode started for ${movieFileId}: ${commandLine}`);
				})
				.on('progress', (progress: any) => {
					const pct = progress.percent;
					if (typeof pct === 'number' && !Number.isNaN(pct)) {
						onProgress?.(Math.min(100, Math.max(0, pct)));
					}
					this.logger.debug(
						`Pre-transcode progress [${movieFileId}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(`Pre-transcode error for ${movieFileId}: ${err.message}`);
					this.activeProcesses.delete(processKey);

					// If hardware acceleration was used, retry with software encoding
					if (
						isTranscode &&
						hwAccel !== 'none' &&
						!this.swFallbackAttempted.has(processKey)
					) {
						this.swFallbackAttempted.add(processKey);
						this.hwAccelBroken = true;
						this.settings.set("hwAccelBroken", true);
						this.logger.warn(
							`Hardware acceleration (${hwAccel}) failed for pre-transcode ${movieFileId}, switching to software encoding globally`,
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
					this.logger.log(`Pre-transcode complete for ${movieFileId}/${quality}`);
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
	 * Validate a cached transcode is actually usable.
	 * Checks that the manifest exists, is parseable, and that the segments it
	 * references actually exist on disk. Returns 'complete', 'partial', 'invalid', or 'empty'.
	 */
	async validateCache(
		movieFileId: string,
		quality: string,
	): Promise<'complete' | 'partial' | 'invalid' | 'empty'> {
		const dir = this.getPersistentDir(movieFileId, quality);

		// Fast path: .complete marker exists — trust it
		try {
			await access(path.join(dir, '.complete'));
			// Quick sanity check: manifest exists
			try {
				await access(path.join(dir, 'stream.m3u8'));
				return 'complete';
			} catch {
				// .complete but no manifest — invalid
				return 'invalid';
			}
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

		// Has manifest with ENDLIST? Means FFmpeg finished but .complete wasn't written
		if (files.includes('stream.m3u8')) {
			try {
				const manifest = await readFile(path.join(dir, 'stream.m3u8'), 'utf-8');
				if (manifest.includes('#EXT-X-ENDLIST')) {
					await writeFile(path.join(dir, '.complete'), '');
					this.logger.log(
						`Repaired missing .complete marker for ${movieFileId}/${quality}`,
					);
					return 'complete';
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
			this.logger.log(`Stopping transcode for session ${sessionId}`);
			try {
				// On Windows, SIGKILL is not available; use SIGTERM which works cross-platform.
				// fluent-ffmpeg processes respond to SIGTERM gracefully.
				proc.kill();
			} catch (err) {
				this.logger.warn(`Failed to kill FFmpeg process for session ${sessionId}: ${err}`);
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
			this.logger.debug(`Boosted FFmpeg priority for session ${sessionId} (PID ${proc.pid})`);
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
			this.logger.log(`Cleaned up transcode files for session ${sessionId}`);
		} catch (err) {
			this.logger.warn(`Failed to clean up session ${sessionId}: ${err}`);
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
		const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
		const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

		return new Promise<void>((resolve, reject) => {
			const videoRateOpts =
				enc.rateControl === 'crf'
					? ['-crf', String(enc.crf)]
					: ['-b:v', profile.videoBitrate];

			let command = ffmpeg(filePath)
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
					'-vf',
					scaleFilter,
					'-threads',
					'0',
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
				])
				.outputOptions(['-map', '0:v:0']);

			if (options.audioTrack !== undefined) {
				command = command.outputOptions(['-map', `0:a:${options.audioTrack}?`]);
			} else {
				command = command.outputOptions(['-map', '0:a:0?']);
			}

			command
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.logger.log(`FFmpeg SW fallback started for session ${sessionId}`);
					this.logger.debug(`FFmpeg command: ${commandLine}`);
					this.sessionStates.set(sessionId, { state: 'running' });
					resolve();
				})
				.on('progress', (progress: any) => {
					this.logger.debug(
						`SW fallback progress [${sessionId}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`FFmpeg SW fallback error for session ${sessionId}: ${err.message}`,
					);
					this.activeProcesses.delete(sessionId);
					this.sessionStates.set(sessionId, { state: 'failed', error: err.message });
					reject(err);
				})
				.on('end', () => {
					this.logger.log(`SW fallback transcode complete for session ${sessionId}`);
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
		const videoRateOpts =
			enc.rateControl === 'crf' ? ['-crf', String(enc.crf)] : ['-b:v', profile.videoBitrate];
		const segDuration = String(enc.segmentDuration);
		const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
		const gopSize = String(Math.round((enc.segmentDuration * 24) / 2) * 2);

		const outputPath = path.join(persistDir, 'stream.m3u8');
		const segmentPattern = path.join(persistDir, 'segment_%04d.ts');
		const processKey = `pre-${movieFileId}-${quality}`;

		return new Promise<void>((resolve, reject) => {
			const command = ffmpeg(filePath)
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
					'-vf',
					scaleFilter,
					'-threads',
					'0',
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
				])
				.outputOptions(['-map', '0:v:0', '-map', '0:a:0?'])
				.output(outputPath)
				.on('start', (commandLine: string) => {
					this.logger.log(
						`Pre-transcode SW fallback started for ${movieFileId}: ${commandLine}`,
					);
				})
				.on('progress', (progress: any) => {
					const pct = progress.percent;
					if (typeof pct === 'number' && !Number.isNaN(pct)) {
						onProgress?.(Math.min(100, Math.max(0, pct)));
					}
					this.logger.debug(
						`Pre-transcode SW fallback [${movieFileId}]: ${progress.percent?.toFixed(1)}%`,
					);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`Pre-transcode SW fallback error for ${movieFileId}: ${err.message}`,
					);
					this.activeProcesses.delete(processKey);
					reject(err);
				})
				.on('end', () => {
					this.logger.log(
						`Pre-transcode SW fallback complete for ${movieFileId}/${quality}`,
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

	private getEncodingSettings() {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const configuredHwAccel = enc?.hwAccel || 'none';
		const hwAccel = this.hwAccelBroken ? 'none' : configuredHwAccel;
		const configuredPreset = enc?.preset || 'veryfast';
		// NVENC uses different preset names: map libx264 presets to NVENC equivalents
		const preset =
			hwAccel === 'nvenc' ? this.mapNvencPreset(configuredPreset) : configuredPreset;
		return {
			hwAccel,
			preset,
			rateControl: enc?.rateControl || 'cbr',
			crf: enc?.crf ?? 23,
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
		const profile =
			TRANSCODING_PROFILES[quality as keyof typeof TRANSCODING_PROFILES] ??
			TRANSCODING_PROFILES['1080p'];
		if (!profile) throw new Error(`No transcoding profile for quality "${quality}"`);

		const enc = this.getEncodingSettings();
		const forceSoftware = useSoftware || this.hwAccelBroken;
		const hwAccel = forceSoftware ? 'none' : enc.hwAccel;
		const videoCodec = forceSoftware ? 'libx264' : this.getVideoCodec(hwAccel);
		const videoRateOpts =
			enc.rateControl === 'crf' ? ['-crf', String(enc.crf)] : ['-b:v', profile.videoBitrate];
		const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`;
		const gopSize = String(Math.round((chunkDuration * 24) / 2) * 2);
		const processKey = `chunk-${path.basename(outputPath, '.ts')}`;

		return new Promise<void>((resolve, reject) => {
			let command = ffmpeg(filePath)
				.inputOptions(['-ss', String(startTime)])
				.outputOptions([
					'-t',
					String(chunkDuration),
					'-f',
					'mpegts',
					'-force_key_frames',
					'expr:eq(t,0)',
				])
				.videoCodec(videoCodec)
				.audioCodec('aac')
				.outputOptions([
					'-vf',
					scaleFilter,
					'-threads',
					'0',
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
				.on('start', () => {
					this.logger.debug(`Chunk encode started: ${path.basename(outputPath)}`);
				})
				.on('error', (err: Error) => {
					this.logger.error(
						`Chunk encode failed ${path.basename(outputPath)}: ${err.message}`,
					);
					this.activeProcesses.delete(processKey);

					// If hardware encoding failed, retry with software
					if (hwAccel !== 'none' && !forceSoftware) {
						this.hwAccelBroken = true;
						this.settings.set("hwAccelBroken", true);
						this.logger.warn(
							`HW accel failed for chunk ${path.basename(outputPath)}, switching to software for all future chunks`,
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
					resolve();
				});

			command.run();
			const ffmpegProcess = (command as any).ffmpegProc;
			if (ffmpegProcess) {
				this.activeProcesses.set(processKey, ffmpegProcess);
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
