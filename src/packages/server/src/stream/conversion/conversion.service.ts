import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WsEvent } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, movies } from '../../database/schema/index.js';
import { EventsService } from '../../events/events.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { TranscoderService } from '../transcoder/transcoder.service.js';

/** What the planner decided to do with a file. */
export type ConversionAction = 'remux' | 'reencode-audio' | 'reencode' | 'skip';

export interface ConversionPlan {
	action: ConversionAction;
	reason: string;
	/** Estimated output size for `reencode` (used for the would-grow guard). */
	predictedBytes?: number;
}

export interface ConversionResult {
	status: 'converted' | 'skipped' | 'failed';
	action: ConversionAction;
	reason?: string;
	movieId?: string;
	fileId?: string;
	newPath?: string;
	newSizeBytes?: number;
	originalSizeBytes?: number;
}

/** Audio codecs browsers can play natively (no re-encode needed). */
const BROWSER_AUDIO = ['aac', 'mp3', 'opus', 'flac', 'vorbis', 'mp4a', 'pcm_s16le'];

/**
 * Near-lossless H.264 reference bitrate per max-height bracket — used only to
 * *estimate* the output size of a full re-encode so we can skip cases that
 * would grow the file (e.g. an efficient HEVC source). These are deliberately
 * generous (quality-first); the actual encode uses CRF.
 */
const H264_REF_BITRATE: Array<[number, number]> = [
	[480, 2_500_000],
	[720, 5_000_000],
	[1080, 10_000_000],
	[1440, 16_000_000],
	[Number.POSITIVE_INFINITY, 30_000_000],
];

/**
 * Converts library files to native direct-play MP4 (faststart H.264/AAC).
 *
 * Strategy (see docs/features/mp4-direct-play-conversion-plan.md):
 *  - H.264 + browser audio, wrong container → lossless remux.
 *  - H.264 + incompatible audio → copy video, re-encode audio only.
 *  - non-H.264 → full re-encode, BUT skipped when the predicted size would
 *    exceed `originalSize * growthThreshold` (those stay on on-demand HLS).
 *
 * In-place mode replaces the original on disk (verify-then-delete) and repoints
 * the movie_files row; cache mode writes a direct-play MP4 into the persistent
 * cache and clears the file's stale HLS caches. Either way it emits
 * STREAM_SUPERSEDED so any client mid-playback reloads onto the new source.
 */
@Injectable()
export class ConversionService {
	private readonly logger = new Logger(ConversionService.name);
	/** fileId → temp output path of an in-flight conversion (for cancel). */
	private readonly activeByFile = new Map<string, string>();

	constructor(
		private readonly transcoder: TranscoderService,
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly events: EventsService,
	) {}

	getConfig() {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const threshold = Number(enc?.conversionGrowthThreshold);
		return {
			// Both default ON (the destructive in-place replace was explicitly requested on).
			convertOriginalFile: enc?.convertOriginalFile !== false,
			autoConvertToMp4: enc?.autoConvertToMp4 !== false,
			growthThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 1.05,
		};
	}

	private isH264(codec?: string | null): boolean {
		const c = (codec || '').toLowerCase();
		return c === 'h264' || c === 'avc' || c === 'h.264';
	}

	private isBrowserAudio(codec?: string | null): boolean {
		const c = (codec || '').toLowerCase();
		if (!c) return true; // no audio track → nothing to transcode
		return BROWSER_AUDIO.some((b) => c.includes(b));
	}

	private h264RefBitrate(height: number): number {
		for (const [maxH, bps] of H264_REF_BITRATE) {
			if (height <= maxH) return bps;
		}
		return 30_000_000;
	}

	private parseHeight(file: any): number {
		if (typeof file.videoHeight === 'number' && file.videoHeight > 0) return file.videoHeight;
		const res = String(file.resolution ?? '');
		const p = res.match(/(\d{3,4})p/);
		if (p) return Number(p[1]);
		const wxh = res.match(/\d{3,4}\s*[x×]\s*(\d{3,4})/);
		if (wxh) return Number(wxh[1]);
		return 1080;
	}

	/** Decide what (if anything) to do with a file. Pure / no side effects. */
	planConversion(file: any): ConversionPlan {
		const ext = path.extname(String(file.filePath ?? '')).toLowerCase();
		const videoCodec = file.codecVideo as string | null;
		const audioCodec = file.codecAudio as string | null;

		if (!videoCodec) return { action: 'skip', reason: 'unprobed' };

		const h264 = this.isH264(videoCodec);
		const isMp4 = ext === '.mp4' || ext === '.m4v';
		const browserAudio = this.isBrowserAudio(audioCodec);

		if (h264 && isMp4 && browserAudio) {
			return { action: 'skip', reason: 'already-direct-play' };
		}
		if (h264 && browserAudio) {
			return { action: 'remux', reason: 'h264-wrong-container' };
		}
		if (h264 && !browserAudio) {
			return { action: 'reencode-audio', reason: 'h264-incompatible-audio' };
		}

		// Non-H.264 → full re-encode. Guard against growing the file.
		const duration = Number(file.durationSeconds);
		const originalBytes = Number(file.fileSize);
		if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(originalBytes) || originalBytes <= 0) {
			return { action: 'skip', reason: 'cannot-estimate-size' };
		}
		const refVideo = this.h264RefBitrate(this.parseHeight(file));
		const audioBps = 256_000;
		const predictedBytes = Math.round(((refVideo + audioBps) / 8) * duration);
		const threshold = this.getConfig().growthThreshold;
		if (predictedBytes > originalBytes * threshold) {
			return { action: 'skip', reason: 'would-grow', predictedBytes };
		}
		return { action: 'reencode', reason: 'incompatible-codec', predictedBytes };
	}

	/** All available files that have actionable conversion work. */
	eligibleFiles(): any[] {
		const rows = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.available, true))
			.all();
		return rows.filter((f) => this.planConversion(f).action !== 'skip');
	}

	private sanitizeName(title: string, year?: number | null): string {
		const base = `${title}${year ? ` (${year})` : ''}`;
		// Strip characters illegal on Windows/most filesystems; collapse spaces.
		return (
			base
				.replace(/[\\/:*?"<>|]/g, '')
				.replace(/\s+/g, ' ')
				.trim() || 'movie'
		);
	}

	/** Verify a freshly-produced file before we trust it / delete the original. */
	private verifyOutput(probe: NonNullable<Awaited<ReturnType<TranscoderService['probeFile']>>>, file: any): boolean {
		if (!(probe.sizeBytes > 1_000_000)) return false; // sanity: > 1 MB
		const orig = Number(file.durationSeconds);
		if (Number.isFinite(orig) && orig > 0 && probe.durationSeconds) {
			const diff = Math.abs(probe.durationSeconds - orig);
			if (diff > Math.max(3, orig * 0.01)) return false; // within 3s or 1%
		}
		return true;
	}

	private async safeUnlink(p: string): Promise<void> {
		await rm(p, { force: true }).catch(() => {});
	}

	/** Cancel an in-flight conversion for a file (kills the ffmpeg process). */
	cancel(fileId: string): void {
		const temp = this.activeByFile.get(fileId);
		if (temp) this.transcoder.cancelConversionByOutput(temp);
	}

	/**
	 * Convert one file to direct-play MP4. `inPlace` (default from settings)
	 * replaces the original on disk after verification; otherwise a cached
	 * direct-play MP4 is produced and the file's HLS caches are cleared.
	 */
	async convertFile(
		file: any,
		opts: { inPlace?: boolean } = {},
		onProgress?: (pct: number) => void,
	): Promise<ConversionResult> {
		const inPlace = opts.inPlace ?? this.getConfig().convertOriginalFile;
		const plan = this.planConversion(file);
		const base: ConversionResult = {
			status: 'skipped',
			action: plan.action,
			reason: plan.reason,
			movieId: file.movieId,
			fileId: file.id,
			originalSizeBytes: Number(file.fileSize) || undefined,
		};

		if (plan.action === 'skip') return base;

		const srcPath = String(file.filePath);
		if (!existsSync(srcPath)) {
			return { ...base, status: 'failed', reason: 'source-missing' };
		}

		const movieRow = this.database.db
			.select({ title: movies.title, year: movies.year })
			.from(movies)
			.where(eq(movies.id, file.movieId))
			.get();
		const title = movieRow?.title || file.fileName || 'movie';
		const year = movieRow?.year ?? undefined;

		const dir = inPlace
			? path.dirname(srcPath)
			: this.transcoder.getPersistentDir(file.id, 'direct');
		const baseName = inPlace ? this.sanitizeName(title, year) : 'direct';
		let finalPath = path.join(dir, `${baseName}.mp4`);
		if (
			inPlace &&
			existsSync(finalPath) &&
			path.resolve(finalPath) !== path.resolve(srcPath)
		) {
			finalPath = path.join(dir, `${baseName} (converted).mp4`);
		}
		// Non-media extension so a concurrent library scan can't index the
		// half-written file. The MP4 muxer is forced via `-f mp4` in the
		// transcoder, so the extension is free.
		const tempPath = path.join(dir, `.${baseName}.converting.part`);
		await mkdir(dir, { recursive: true });
		await this.safeUnlink(tempPath);
		this.activeByFile.set(file.id, tempPath);

		try {
			if (plan.action === 'remux') {
				await this.transcoder.remuxToMp4(srcPath, tempPath, onProgress);
			} else if (plan.action === 'reencode-audio') {
				await this.transcoder.transcodeToMp4(srcPath, tempPath, { videoCopy: true }, onProgress);
			} else {
				await this.transcoder.transcodeToMp4(
					srcPath,
					tempPath,
					{ preserveResolution: true, nearLossless: true },
					onProgress,
				);
			}
		} catch (err) {
			this.activeByFile.delete(file.id);
			await this.safeUnlink(tempPath);
			return { ...base, status: 'failed', reason: (err as Error).message };
		}
		this.activeByFile.delete(file.id);

		const probe = await this.transcoder.probeFile(tempPath);
		if (!probe || !this.verifyOutput(probe, file)) {
			await this.safeUnlink(tempPath);
			return { ...base, status: 'failed', reason: 'verification-failed' };
		}

		try {
			await this.safeUnlink(finalPath);
			await rename(tempPath, finalPath);
		} catch (err) {
			await this.safeUnlink(tempPath);
			return { ...base, status: 'failed', reason: `move-failed: ${(err as Error).message}` };
		}

		if (inPlace) {
			// New file verified & in place — now it's safe to drop the original.
			if (path.resolve(finalPath) !== path.resolve(srcPath)) {
				await this.safeUnlink(srcPath);
			}
			this.database.db
				.update(movieFiles)
				.set({
					filePath: finalPath,
					fileName: path.basename(finalPath),
					fileSize: probe.sizeBytes,
					codecVideo: 'h264',
					codecAudio: probe.codecAudio ?? 'aac',
					containerFormat: 'mp4',
					videoWidth: probe.videoWidth ?? file.videoWidth ?? null,
					videoHeight: probe.videoHeight ?? file.videoHeight ?? null,
					fileModifiedAt: new Date().toISOString(),
					available: true,
				})
				.where(eq(movieFiles.id, file.id))
				.run();
			await this.transcoder.clearCache(file.id);
		} else {
			await writeFile(path.join(dir, '.complete'), '').catch(() => {});
			await this.transcoder.clearHlsCachesExcept(file.id, 'direct');
		}

		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId: file.movieId });
		this.events.emit(WsEvent.STREAM_SUPERSEDED, { movieId: file.movieId, fileId: file.id });

		this.logger.log(
			`Converted ${path.basename(srcPath)} → ${path.basename(finalPath)} ` +
				`(${plan.action}, ${this.fmt(file.fileSize)} → ${this.fmt(probe.sizeBytes)}, inPlace=${inPlace})`,
		);

		return {
			status: 'converted',
			action: plan.action,
			movieId: file.movieId,
			fileId: file.id,
			newPath: finalPath,
			newSizeBytes: probe.sizeBytes,
			originalSizeBytes: Number(file.fileSize) || undefined,
		};
	}

	private fmt(bytes: unknown): string {
		const n = Number(bytes);
		if (!Number.isFinite(n) || n <= 0) return '?';
		const gb = n / 1024 ** 3;
		return gb >= 1 ? `${gb.toFixed(2)}GB` : `${(n / 1024 ** 2).toFixed(0)}MB`;
	}
}
