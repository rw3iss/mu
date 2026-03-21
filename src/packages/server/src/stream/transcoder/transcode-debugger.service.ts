import type { ChildProcess } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service.js';
import type {
	ClientRequestLog,
	FFmpegStderrLine,
	TranscodeDebugContext,
	TranscodeDebugEvent,
	TranscodeDebugSummary,
} from './transcode-debug.types.js';

const MAX_SESSIONS = 20;
const MAX_STDERR_LINES = 200;

@Injectable()
export class TranscodeDebuggerService implements OnModuleInit {
	private readonly logger = new Logger(TranscodeDebuggerService.name);
	private readonly sessions = new Map<string, TranscodeDebugContext>();
	private readonly sessionOrder: string[] = [];
	private enabled = false;
	private readonly logPath: string;

	constructor(private readonly settings: SettingsService) {
		this.logPath = path.resolve('./data/logs/transcode-debug.log');
	}

	onModuleInit(): void {
		this.refreshConfig();
	}

	refreshConfig(): void {
		if (process.env.DEBUG_TRANSCODE === 'true') {
			this.enabled = true;
			return;
		}
		const debug = this.settings.get<Record<string, unknown>>('debug', {}) as any;
		if (debug?.transcode === true) {
			this.enabled = true;
			return;
		}
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		if (enc?.debugTranscoding === true) {
			this.enabled = true;
			return;
		}
		this.enabled = false;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	startSession(
		sessionId: string,
		movieFileId: string,
		source: TranscodeDebugContext['source'],
		encoding: TranscodeDebugContext['encoding'],
	): void {
		if (!this.isEnabled()) return;

		const ctx: TranscodeDebugContext = {
			sessionId,
			movieFileId,
			startedAt: new Date().toISOString(),
			status: 'running',
			source,
			encoding,
			ffmpeg: {
				stderrLines: [],
			},
			timing: {},
			segments: [],
			segmentCount: 0,
			totalSegmentBytes: 0,
			performance: {},
			clientRequests: [],
			manifestRequests: 0,
			segmentRequests: 0,
			retryCount: 0,
			events: [],
			errors: [],
		};

		// Evict oldest session if at capacity
		if (this.sessions.size >= MAX_SESSIONS && this.sessionOrder.length > 0) {
			const oldest = this.sessionOrder.shift()!;
			this.sessions.delete(oldest);
		}

		this.sessions.set(sessionId, ctx);
		this.sessionOrder.push(sessionId);

		this.recordEvent(sessionId, 'session_start', `Debug session started for ${movieFileId}`);
		this.logger.log(`Transcode debug session started: ${sessionId}`);
	}

	endSession(sessionId: string, status: 'completed' | 'failed' | 'cancelled'): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		ctx.status = status;
		ctx.endedAt = new Date().toISOString();

		this.recordEvent(sessionId, 'session_end', `Session ended with status: ${status}`);

		// Compute performance averages
		if (ctx.segments.length > 0) {
			const totalMs = ctx.segments.reduce((sum, s) => sum + s.elapsed, 0);
			ctx.performance.avgSegmentTimeMs = Math.round(totalMs / ctx.segments.length);
		}

		this.writeSummary(ctx);
	}

	recordEvent(sessionId: string, type: string, detail: string, data?: unknown): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		const event: TranscodeDebugEvent = {
			timestamp: new Date().toISOString(),
			elapsed: Date.now() - new Date(ctx.startedAt).getTime(),
			type,
			detail,
			data,
		};
		ctx.events.push(event);

		if (type.includes('error')) {
			ctx.errors.push(detail);
		}
	}

	recordMilestone(
		sessionId: string,
		milestone: keyof TranscodeDebugContext['timing'],
	): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		ctx.timing[milestone] = Date.now() - new Date(ctx.startedAt).getTime();
	}

	recordFFmpegCommand(sessionId: string, commandLine: string): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		ctx.ffmpeg.commandLine = commandLine;
	}

	recordFFmpegProgress(sessionId: string, progress: any): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		if (progress.currentFps != null) {
			const fps = Number(progress.currentFps);
			ctx.ffmpeg.lastFps = String(fps);
			if (!ctx.performance.peakFps || fps > ctx.performance.peakFps) {
				ctx.performance.peakFps = fps;
			}
		}

		if (progress.currentKbps != null) {
			ctx.ffmpeg.lastSpeed = `${progress.currentKbps}kbps`;
		}

		// fluent-ffmpeg sometimes provides a timemark-based speed estimate
		if (typeof progress.targetSize === 'number') {
			// Extract speed from percent if available
			const pct = progress.percent;
			if (typeof pct === 'number' && pct > 0) {
				const elapsed = (Date.now() - new Date(ctx.startedAt).getTime()) / 1000;
				const duration = ctx.source.durationSeconds;
				if (duration && elapsed > 0) {
					const processedSeconds = (pct / 100) * duration;
					const speed = processedSeconds / elapsed;
					ctx.ffmpeg.lastSpeed = `${speed.toFixed(2)}x`;
					if (!ctx.performance.peakSpeed || speed > ctx.performance.peakSpeed) {
						ctx.performance.peakSpeed = speed;
					}
				}
			}
		}
	}

	recordSegmentReady(sessionId: string, index: number, sizeBytes: number): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		const elapsed = Date.now() - new Date(ctx.startedAt).getTime();

		ctx.segments.push({
			index,
			readyAt: new Date().toISOString(),
			elapsed,
			sizeBytes,
		});
		ctx.segmentCount++;
		ctx.totalSegmentBytes += sizeBytes;

		if (ctx.segmentCount === 1 && !ctx.timing.firstSegmentReady) {
			ctx.timing.firstSegmentReady = elapsed;
		}
	}

	recordClientRequest(
		sessionId: string,
		type: ClientRequestLog['type'],
		segmentIndex: number | undefined,
		responseCode: number,
		responseTimeMs: number,
	): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		ctx.clientRequests.push({
			timestamp: new Date().toISOString(),
			type,
			segmentIndex,
			responseCode,
			responseTimeMs,
		});

		if (type === 'manifest') ctx.manifestRequests++;
		if (type === 'segment') ctx.segmentRequests++;
		if (responseCode === 503) ctx.retryCount++;
	}

	recordChunkState(sessionId: string, chunkState: unknown): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;

		ctx.chunkState = chunkState;
	}

	attachStderr(sessionId: string, proc: ChildProcess): void {
		if (!this.isEnabled()) return;

		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;
		if (!proc.stderr) return;

		proc.stderr.on('data', (data: Buffer) => {
			const lines = data.toString().split('\n').filter((l) => l.trim());
			for (const line of lines) {
				if (ctx.ffmpeg.stderrLines.length >= MAX_STDERR_LINES) {
					ctx.ffmpeg.stderrLines.shift();
				}
				const entry: FFmpegStderrLine = {
					timestamp: new Date().toISOString(),
					line,
				};
				ctx.ffmpeg.stderrLines.push(entry);

				// Parse speed/fps from stderr lines like "speed=1.23x" or "fps=45"
				const speedMatch = line.match(/speed=\s*([\d.]+)x/);
				if (speedMatch) {
					const speed = parseFloat(speedMatch[1]!);
					ctx.ffmpeg.lastSpeed = `${speed}x`;
					if (!ctx.performance.peakSpeed || speed > ctx.performance.peakSpeed) {
						ctx.performance.peakSpeed = speed;
					}
				}
				const fpsMatch = line.match(/fps=\s*([\d.]+)/);
				if (fpsMatch) {
					const fps = parseFloat(fpsMatch[1]!);
					ctx.ffmpeg.lastFps = String(fps);
					if (!ctx.performance.peakFps || fps > ctx.performance.peakFps) {
						ctx.performance.peakFps = fps;
					}
				}
			}
		});
	}

	getSession(sessionId: string): TranscodeDebugContext | undefined {
		return this.sessions.get(sessionId);
	}

	getAllSessions(): TranscodeDebugSummary[] {
		const summaries: TranscodeDebugSummary[] = [];
		for (const ctx of this.sessions.values()) {
			summaries.push(this.toSummary(ctx));
		}
		return summaries;
	}

	getActiveSessions(): TranscodeDebugSummary[] {
		const summaries: TranscodeDebugSummary[] = [];
		for (const ctx of this.sessions.values()) {
			if (ctx.status === 'running') {
				summaries.push(this.toSummary(ctx));
			}
		}
		return summaries;
	}

	private toSummary(ctx: TranscodeDebugContext): TranscodeDebugSummary {
		return {
			sessionId: ctx.sessionId,
			movieFileId: ctx.movieFileId,
			status: ctx.status,
			startedAt: ctx.startedAt,
			endedAt: ctx.endedAt,
			quality: ctx.encoding.quality,
			segmentCount: ctx.segmentCount,
			errorCount: ctx.errors.length,
			lastSpeed: ctx.ffmpeg.lastSpeed,
			lastFps: ctx.ffmpeg.lastFps,
		};
	}

	private async writeToLog(message: string): Promise<void> {
		try {
			const dir = path.dirname(this.logPath);
			await mkdir(dir, { recursive: true });
			await appendFile(this.logPath, message + '\n');
		} catch (err) {
			this.logger.warn(`Failed to write transcode debug log: ${err}`);
		}
	}

	private writeSummary(ctx: TranscodeDebugContext): void {
		const t = ctx.timing;
		const avgSegMs = ctx.performance.avgSegmentTimeMs ?? 0;

		const lines: string[] = [
			'',
			'\u2550\u2550\u2550 TRANSCODE DEBUG \u2550\u2550\u2550',
			`Session: ${ctx.sessionId}  Movie: ${ctx.movieFileId}`,
			`Source: ${ctx.source.filePath}  Video: ${ctx.source.codecVideo ?? '?'}  Audio: ${ctx.source.codecAudio ?? '?'}  Resolution: ${ctx.source.resolution ?? '?'}  Duration: ${ctx.source.durationSeconds ?? '?'}s`,
			`Quality: ${ctx.encoding.quality ?? '?'}  Mode: ${ctx.encoding.mode ?? '?'}  Preset: ${ctx.encoding.preset ?? '?'}  Codec: ${ctx.encoding.videoCodec ?? '?'}`,
			`FFmpeg: ${ctx.ffmpeg.commandLine ?? '(not captured)'}`,
			`TIMING: Request\u2192+${t.requestReceived ?? '?'}ms  FFmpeg\u2192+${t.ffmpegSpawned ?? '?'}ms  FirstSeg\u2192+${t.firstSegmentReady ?? '?'}ms  FirstServed\u2192+${t.firstSegmentServed ?? '?'}ms`,
			`SPEED: ${ctx.ffmpeg.lastFps ?? '?'}fps (${ctx.ffmpeg.lastSpeed ?? '?'} realtime)  Segments: ${ctx.segmentCount} (avg ${avgSegMs}ms each)`,
			`CLIENT: ${ctx.manifestRequests} manifest, ${ctx.segmentRequests} segment, ${ctx.retryCount} retries (503)`,
			`ERRORS: ${ctx.errors.length}`,
		];

		if (ctx.errors.length > 0) {
			for (const err of ctx.errors) {
				lines.push(`  ${err}`);
			}
		}

		lines.push('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

		const summary = lines.join('\n');
		this.logger.log(summary);
		this.writeToLog(`[${new Date().toISOString()}]${summary}`);
	}
}
