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
import { MemoryCacheService } from '../memory-cache/memory-cache.service.js';
import { TranscoderService } from '../transcoder/transcoder.service.js';

/** What the planner decided to do with a file. */
export type ConversionAction =
	| 'remux'
	| 'reencode-audio'
	| 'reencode'
	| 'reencode-av1'
	| 'shrink'
	| 'skip';

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
/** Default for `encoding.shrinkWorthRatio` — a shrink re-encode must predict
 *  ≤ this fraction of the original size to be worthwhile. */
const SHRINK_WORTH_RATIO = 0.8;

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
 * Bitrate H.264 needs relative to the SOURCE codec for comparable quality.
 *
 * <1 means the source codec is less efficient than H.264, so re-encoding at a
 * *lower* bitrate holds quality (XviD, MPEG-2). >1 means the source is more
 * efficient and H.264 genuinely needs more bits — which is exactly the case
 * the would-grow guard exists to catch (HEVC, VP9, AV1).
 *
 * Ballpark figures from the usual codec-generation comparisons; they only feed
 * a size *estimate*, and the real encode is CRF-driven.
 */
const H264_BITRATE_RATIO: Record<string, number> = {
	mpeg1video: 0.5,
	mpeg2video: 0.55,
	msmpeg4v3: 0.7,
	mpeg4: 0.7,
	xvid: 0.7,
	divx: 0.7,
	mp4v: 0.7,
	wmv3: 0.85,
	vc1: 0.9,
	'vc-1': 0.9,
	theora: 0.8,
	vp8: 1.0,
	h264: 1.0,
	avc1: 1.0,
	vp9: 1.5,
	hevc: 1.6,
	h265: 1.6,
	hvc1: 1.6,
	av1: 1.8,
	av01: 1.8,
};

/**
 * Typical bitrate per audio codec, used to split a whole-file bitrate into its
 * video and audio parts (ffprobe's per-stream audio bitrate isn't stored).
 * Over-estimating here would inflate the predicted video bitrate, so these lean
 * to the low side of each codec's common range.
 */
const AUDIO_BPS_BY_CODEC: Record<string, number> = {
	ac3: 384_000,
	eac3: 384_000,
	dts: 768_000,
	truehd: 1_500_000,
	flac: 900_000,
	pcm_s16le: 1_400_000,
	mp3: 160_000,
	aac: 128_000,
	mp4a: 128_000,
	opus: 96_000,
	vorbis: 128_000,
};
const DEFAULT_SOURCE_AUDIO_BPS = 192_000;

/** Audio bitrate the converted file is written at (stereo AAC). */
const OUTPUT_AUDIO_BPS = 256_000;

/** Never predict a video bitrate below this — guards against absurd inputs. */
const MIN_PREDICTED_VIDEO_BPS = 300_000;

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
		private readonly memoryCache: MemoryCacheService,
	) {}

	getConfig() {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const threshold = Number(enc?.conversionGrowthThreshold);
		return {
			// Both default ON (the destructive in-place replace was explicitly requested on).
			convertOriginalFile: enc?.convertOriginalFile !== false,
			autoConvertToMp4: enc?.autoConvertToMp4 !== false,
			growthThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 1.5,
			// Convert HEVC → AV1 MP4 (GPU). AV1 is browser-universal AND efficient
			// (no doubling), but requires a working NVENC AV1 encoder. Default off.
			convertHevcToAv1: enc?.convertHevcToAv1 === true,
			// Re-encode (shrink) any file whose overall bitrate exceeds this many
			// Mbps. Targets bloated H.264 BluRay rips. 0 = off. AV1 (GPU) when
			// available, else H.264 CRF.
			reencodeAboveMbps: (() => {
				const v = Number(enc?.reencodeAboveMbps);
				return Number.isFinite(v) && v > 0 ? v : 0;
			})(),
			// A shrink must predict ≤ this fraction of the original size to be
			// worthwhile (read on demand; Settings → Encoding).
			shrinkWorthRatio: (() => {
				const v = Number(enc?.shrinkWorthRatio);
				return Number.isFinite(v) && v >= 0.1 && v <= 1 ? v : SHRINK_WORTH_RATIO;
			})(),
		};
	}

	/** Overall bitrate in Mbps (whole-file: video+audio), or 0 if unknown. */
	private bitrateMbps(file: any): number {
		const bytes = Number(file.fileSize);
		const dur = Number(file.durationSeconds);
		if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(dur) || dur <= 0) return 0;
		return (bytes * 8) / dur / 1_000_000;
	}

	/** True when an AV1-capable hardware encoder (NVENC) is actually usable. */
	private nvencActive(): boolean {
		return this.transcoder.getEffectiveHwAccel() === 'nvenc';
	}

	private isH264(codec?: string | null): boolean {
		const c = (codec || '').toLowerCase();
		return c === 'h264' || c === 'avc' || c === 'h.264';
	}

	private isHevc(codec?: string | null): boolean {
		const c = (codec || '').toLowerCase();
		return c === 'hevc' || c === 'h265' || c === 'h.265' || c === 'hvc1' || c === 'hev1';
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

	/**
	 * Estimate the byte size of re-encoding `file` to H.264.
	 *
	 * The old estimate was resolution-only: it assumed a fresh encode would use
	 * the full H264_REF_BITRATE for the source's height. For a modern 1080p file
	 * that's a fair ceiling, but for an old low-bitrate SD rip it was wildly
	 * high — a 1.47 Mbps 384p XviD was predicted at 2.5 Mbps video, i.e. 1.88x
	 * its real size, so the would-grow guard skipped it. Every MPEG-4 file in
	 * the library was stuck on the HLS path for that reason.
	 *
	 * Now it starts from what the source actually spends on video and adjusts by
	 * the codec-generation ratio, keeping the resolution figure as a ceiling.
	 * That preserves the guard's original purpose (HEVC/AV1 ratios are >1, so
	 * they still predict growth and are still skipped) while letting genuinely
	 * inefficient sources through.
	 *
	 * Returns null when duration/size are unknown, so callers can distinguish
	 * "can't estimate" from "estimated large".
	 */
	private predictReencodeBytes(file: any): number | null {
		const duration = Number(file.durationSeconds);
		const originalBytes = Number(file.fileSize);
		if (
			!Number.isFinite(duration) ||
			duration <= 0 ||
			!Number.isFinite(originalBytes) ||
			originalBytes <= 0
		) {
			return null;
		}

		const ceilingBps = this.h264RefBitrate(this.parseHeight(file));
		const totalBps = (originalBytes * 8) / duration;

		const audioCodec = String(file.codecAudio ?? '').toLowerCase();
		const sourceAudioBps = AUDIO_BPS_BY_CODEC[audioCodec] ?? DEFAULT_SOURCE_AUDIO_BPS;
		// Never attribute more than half the file to audio — a bad codec guess
		// on a low-bitrate source would otherwise gut the video estimate.
		const sourceVideoBps = Math.max(totalBps - sourceAudioBps, totalBps * 0.5);

		const videoCodec = String(file.codecVideo ?? '').toLowerCase();
		const ratio = H264_BITRATE_RATIO[videoCodec] ?? 1.0;

		const predictedVideoBps = Math.min(
			ceilingBps,
			Math.max(sourceVideoBps * ratio, MIN_PREDICTED_VIDEO_BPS),
		);
		return Math.round(((predictedVideoBps + OUTPUT_AUDIO_BPS) / 8) * duration);
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

		// Oversized H.264 → re-encode the *video* to shrink it (the only path
		// that touches H.264 video; remux/reencode-audio copy it verbatim, so a
		// 22 Mbps BluRay rip stays huge). Gated on `reencodeAboveMbps` and only
		// when it would actually shrink. Takes precedence over the direct-play
		// skip and the audio-only paths below.
		const shrinkMbps = this.getConfig().reencodeAboveMbps;
		if (h264 && shrinkMbps > 0) {
			const mbps = this.bitrateMbps(file);
			const duration = Number(file.durationSeconds);
			const originalBytes = Number(file.fileSize);
			if (
				mbps > shrinkMbps &&
				Number.isFinite(duration) &&
				duration > 0 &&
				Number.isFinite(originalBytes) &&
				originalBytes > 0
			) {
				// Same estimator as the re-encode path (H.264 reference; AV1
				// lands lower), so both decisions agree on what an encode costs.
				const predictedBytes = this.predictReencodeBytes(file) ?? Number.MAX_SAFE_INTEGER;
				// Only worth the re-encode (and quality cost) when the result is
				// meaningfully smaller — at most shrinkWorthRatio of the original.
				if (predictedBytes <= originalBytes * this.getConfig().shrinkWorthRatio) {
					return { action: 'shrink', reason: 'oversized', predictedBytes };
				}
			}
		}

		if (h264 && isMp4 && browserAudio) {
			return { action: 'skip', reason: 'already-direct-play' };
		}
		if (h264 && browserAudio) {
			return { action: 'remux', reason: 'h264-wrong-container' };
		}
		if (h264 && !browserAudio) {
			return { action: 'reencode-audio', reason: 'h264-incompatible-audio' };
		}

		// HEVC → AV1 (GPU): AV1 is browser-universal and ~as efficient as HEVC, so
		// it doesn't bloat like H.264. Only when the setting is on AND an AV1-
		// capable NVENC encoder is actually usable (else fall through to the
		// would-grow guard, which skips HEVC and lets it transcode to H.264 HLS).
		if (this.isHevc(videoCodec) && this.getConfig().convertHevcToAv1 && this.nvencActive()) {
			return { action: 'reencode-av1', reason: 'hevc-to-av1' };
		}

		// Non-H.264 → full re-encode. Guard against growing the file.
		const originalBytes = Number(file.fileSize);
		const predictedBytes = this.predictReencodeBytes(file);
		if (predictedBytes == null) {
			return { action: 'skip', reason: 'cannot-estimate-size' };
		}
		const threshold = this.getConfig().growthThreshold;
		if (predictedBytes > originalBytes * threshold) {
			return { action: 'skip', reason: 'would-grow', predictedBytes };
		}
		return { action: 'reencode', reason: 'incompatible-codec', predictedBytes };
	}

	/** Pretty codec name for the Jobs UI — 'hevc' → 'HEVC', 'h264' → 'H.264'. */
	codecLabel(codec?: string | null): string {
		const c = (codec || '').toLowerCase();
		if (!c) return '—';
		if (this.isH264(c)) return 'H.264';
		if (this.isHevc(c)) return 'HEVC';
		if (c === 'av1' || c === 'av01') return 'AV1';
		if (c === 'vp9') return 'VP9';
		if (c === 'vp8') return 'VP8';
		if (c.includes('mpeg4') || c === 'mp4v' || c === 'xvid' || c === 'divx') return 'MPEG-4';
		if (c.includes('mpeg2')) return 'MPEG-2';
		if (c === 'vc1' || c === 'vc-1') return 'VC-1';
		return codec!.toUpperCase();
	}

	/** Uppercased container name from a file path — '.mkv' → 'MKV'. */
	containerLabel(filePath?: string | null): string {
		const ext = path
			.extname(String(filePath ?? ''))
			.replace('.', '')
			.toUpperCase();
		return ext || '—';
	}

	/**
	 * Human-readable "input → output (action)" summary for a file's planned
	 * conversion, shown under the job label in the Jobs UI. Pure / no side
	 * effects — pass an already-computed plan to avoid re-evaluating.
	 */
	describePlan(file: any, plan: ConversionPlan = this.planConversion(file)): string {
		const vIn = this.codecLabel(file.codecVideo);
		const cIn = this.containerLabel(file.filePath);
		const aIn = this.codecLabel(file.codecAudio);
		const from = `${vIn}/${cIn}`;
		switch (plan.action) {
			case 'remux':
				return `${from} → ${vIn}/MP4 (remux container, lossless)`;
			case 'reencode-audio':
				return `${from} (${aIn}) → ${vIn}/MP4 (copy video · re-encode audio → AAC)`;
			case 'reencode-av1':
				return `${from} → AV1/MP4 (GPU re-encode, CQ ${this.transcoder.getAv1Cq()})`;
			case 'shrink': {
				const target = this.nvencActive()
					? `AV1/MP4 (GPU, CQ ${this.transcoder.getAv1Cq()})`
					: 'H.264/MP4 (CRF)';
				const mbps = this.bitrateMbps(file);
				return `${from} ${mbps ? `~${mbps.toFixed(0)} Mbps ` : ''}→ ${target} (shrink oversized)`;
			}
			case 'reencode':
				return `${from} → H.264/MP4 (re-encode)`;
			default:
				return plan.reason === 'already-direct-play'
					? `Already direct-play (${from})`
					: `Keep as-is (${from}, ${plan.reason})`;
		}
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
	private verifyOutput(
		probe: NonNullable<Awaited<ReturnType<TranscoderService['probeFile']>>>,
		file: any,
	): boolean {
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
		opts: { inPlace?: boolean; forceCpu?: boolean } = {},
		onProgress?: (pct: number) => void,
	): Promise<ConversionResult> {
		const inPlace = opts.inPlace ?? this.getConfig().convertOriginalFile;
		// CPU+GPU parallel mode: this job encodes on the CPU — AV1 (NVENC-only)
		// plans fall back to H.264 CRF on the CPU.
		const cpu = !!opts.forceCpu;
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

		// Warm the source so ffmpeg reads it from RAM (no-op unless a budget is
		// set). The matching forget()/touch() on replacement happens below.
		this.memoryCache.touch(srcPath);

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
		const finalPath = path.join(dir, `${baseName}.mp4`);
		// The canonical target already exists and isn't our source — a prior
		// conversion (or a duplicate file row) already produced it. Writing a
		// "(converted).mp4" sibling here would be re-indexed by the scanner as a
		// duplicate movie, so skip instead of forking the file.
		if (inPlace && existsSync(finalPath) && path.resolve(finalPath) !== path.resolve(srcPath)) {
			this.logger.warn(
				`Skipping conversion of ${path.basename(srcPath)} — target ${path.basename(finalPath)} already exists`,
			);
			return { ...base, status: 'skipped', reason: 'target-exists' };
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
				await this.transcoder.transcodeToMp4(
					srcPath,
					tempPath,
					{ videoCopy: true },
					onProgress,
				);
			} else if (plan.action === 'reencode-av1') {
				await this.transcoder.transcodeToMp4(
					srcPath,
					tempPath,
					cpu
						? { preserveResolution: true, targetCodec: 'h264', forceCpu: true }
						: { preserveResolution: true, targetCodec: 'av1' },
					onProgress,
				);
			} else if (plan.action === 'shrink') {
				// Re-encode the video to shrink an oversized file. Prefer AV1 (GPU,
				// browser-universal, most efficient); fall back to H.264 CRF when no
				// usable NVENC. Quality-targeted (NOT near-lossless) so it actually
				// gets smaller.
				await this.transcoder.transcodeToMp4(
					srcPath,
					tempPath,
					this.nvencActive() && !cpu
						? { preserveResolution: true, targetCodec: 'av1' }
						: { preserveResolution: true, targetCodec: 'h264', forceCpu: cpu },
					onProgress,
				);
			} else {
				await this.transcoder.transcodeToMp4(
					srcPath,
					tempPath,
					{ preserveResolution: true, nearLossless: true, forceCpu: cpu },
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
				// Release the now-deleted original from the memory cache and warm
				// the replacement so future reads hit the new file.
				this.memoryCache.forget(srcPath);
			}
			this.memoryCache.touch(finalPath);
			this.database.db
				.update(movieFiles)
				.set({
					filePath: finalPath,
					fileName: path.basename(finalPath),
					fileSize: probe.sizeBytes,
					codecVideo:
						probe.codecVideo ??
						(!cpu &&
						(plan.action === 'reencode-av1' ||
							(plan.action === 'shrink' && this.nvencActive()))
							? 'av1'
							: 'h264'),
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
