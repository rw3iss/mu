import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles } from '../database/schema/index.js';

const COLUMNS = 10;
const ROWS = 10;
const FRAMES_PER_SHEET = COLUMNS * ROWS;
const QUALITY = 5; // FFmpeg JPEG quality (2=best, 31=worst)

/**
 * User-pickable thumbnail sizes. Widths in pixels (16:9 height
 * derived). Generated sheets are stored under
 *   data/sprites/{movieId}/{size}/...
 * Legacy sheets (no size subdir) are treated as 'small' at lookup.
 *
 * Each size is a multiple of the small base (120px):
 *   small   = 1x = 120
 *   medium  = 2x = 240
 *   large   = 3x = 360
 *   xlarge  = 4x = 480
 */
export type ThumbnailSize = 'small' | 'medium' | 'large' | 'xlarge';

export const THUMBNAIL_SIZE_WIDTHS: Record<ThumbnailSize, number> = {
	small: 120,
	medium: 240,
	large: 360,
	xlarge: 480,
};

/** Ordered smallest → largest. Resolver walks this to find a stored
 *  sheet of the requested size OR larger (cheap downscale via CSS). */
const SIZE_ORDER: ThumbnailSize[] = ['small', 'medium', 'large', 'xlarge'];

function isThumbnailSize(s: unknown): s is ThumbnailSize {
	return s === 'small' || s === 'medium' || s === 'large' || s === 'xlarge';
}

export function parseThumbnailSize(value: unknown, fallback: ThumbnailSize = 'large'): ThumbnailSize {
	return isThumbnailSize(value) ? value : fallback;
}

export interface SpriteMeta {
	interval: number;
	frameWidth: number;
	frameHeight: number;
	columns: number;
	rows: number;
	sheetCount: number;
	totalFrames: number;
	/** The size the served sheet was actually generated at. */
	size?: ThumbnailSize;
}

@Injectable()
export class SpriteService {
	private readonly logger = new Logger('SpriteService');
	private readonly spriteDir: string;

	constructor(
		private readonly database: DatabaseService,
		private readonly config: ConfigService,
	) {
		this.spriteDir = resolve(this.config.get<string>('media.spriteDir', './data/sprites'));
		if (!existsSync(this.spriteDir)) {
			mkdirSync(this.spriteDir, { recursive: true });
		}
	}

	/** Directory for a movie's sheets at a specific size. When size is
	 *  omitted, returns the legacy (unsized) directory. */
	getMovieDir(movieId: string, size?: ThumbnailSize): string {
		return size ? join(this.spriteDir, movieId, size) : join(this.spriteDir, movieId);
	}

	/** Metadata JSON path for the given size (or legacy if no size). */
	getMetaPath(movieId: string, size?: ThumbnailSize): string {
		return join(this.getMovieDir(movieId, size), 'meta.json');
	}

	/** Sheet image path for the given size (or legacy if no size). */
	getSheetPath(movieId: string, index: number, size?: ThumbnailSize): string {
		return join(this.getMovieDir(movieId, size), `${index}.jpg`);
	}

	/**
	 * True when ANY sprite sheets exist for this movie — sized or
	 * legacy. Used by the bulk "Generate missing" endpoint.
	 */
	hasSprites(movieId: string): boolean {
		if (existsSync(this.getMetaPath(movieId))) return true;
		return SIZE_ORDER.some((s) => existsSync(this.getMetaPath(movieId, s)));
	}

	/** True iff sheets exist at this exact size (sized dir OR — for
	 *  size='small' only — the legacy unsized dir). */
	hasSpritesAtSize(movieId: string, size: ThumbnailSize): boolean {
		if (existsSync(this.getMetaPath(movieId, size))) return true;
		// Legacy sheets are 120px wide ≡ small. Treat the legacy dir
		// as a small-size cache hit so we don't regenerate when
		// someone has the 'small' preference.
		if (size === 'small' && existsSync(this.getMetaPath(movieId))) return true;
		return false;
	}

	/**
	 * Resolve which stored size to serve for a requested size.
	 *
	 * Returns:
	 *   - the requested size if available
	 *   - otherwise the smallest stored size LARGER than requested
	 *     (acceptable: client downscales the bitmap via CSS)
	 *   - otherwise null, even if smaller sizes exist (caller should
	 *     queue generation at the requested size — upscaling small
	 *     bitmaps would be blurry)
	 *
	 * Falls back to 'small' for the legacy unsized directory layout.
	 */
	resolveServingSize(movieId: string, requested: ThumbnailSize): ThumbnailSize | null {
		const startIdx = SIZE_ORDER.indexOf(requested);
		for (let i = startIdx; i < SIZE_ORDER.length; i++) {
			if (this.hasSpritesAtSize(movieId, SIZE_ORDER[i]!)) return SIZE_ORDER[i]!;
		}
		return null;
	}

	/** True iff some size is stored that's SMALLER than requested.
	 *  Used to decide whether to enqueue regen at the requested size
	 *  even though the resolver returned null. */
	hasSmallerThan(movieId: string, requested: ThumbnailSize): boolean {
		const startIdx = SIZE_ORDER.indexOf(requested);
		for (let i = 0; i < startIdx; i++) {
			if (this.hasSpritesAtSize(movieId, SIZE_ORDER[i]!)) return true;
		}
		return false;
	}

	/** Read meta for the given size (or legacy if no size). */
	getMeta(movieId: string, size?: ThumbnailSize): SpriteMeta | null {
		// Prefer the sized meta when size is requested; fall back to
		// the legacy unsized one only when size === 'small' (legacy
		// sheets are 120px wide ≡ small).
		const candidates: string[] = [];
		if (size) {
			candidates.push(this.getMetaPath(movieId, size));
			if (size === 'small') candidates.push(this.getMetaPath(movieId));
		} else {
			candidates.push(this.getMetaPath(movieId));
		}
		for (const p of candidates) {
			if (!existsSync(p)) continue;
			try {
				const raw = readFileSync(p, 'utf-8');
				const meta = JSON.parse(raw) as SpriteMeta;
				if (size && !meta.size) meta.size = size;
				return meta;
			} catch {
				// keep looking
			}
		}
		return null;
	}

	/**
	 * Generate sprite sheets for a movie.
	 * Uses FFmpeg fps + scale + tile filters in a single pass per sheet.
	 */
	async generateForMovie(
		movieId: string,
		sizeOrOpts: ThumbnailSize | { size?: ThumbnailSize; onProgress?: (p: number) => void } = 'large',
		legacyOnProgress?: (percent: number) => void,
	): Promise<SpriteMeta | null> {
		// Backwards-compat: old signature was (movieId, onProgress?).
		// If sizeOrOpts is a function it's actually the progress callback.
		const size: ThumbnailSize =
			typeof sizeOrOpts === 'string'
				? sizeOrOpts
				: (sizeOrOpts.size ?? 'large');
		const onProgress: ((p: number) => void) | undefined =
			typeof sizeOrOpts === 'function'
				? (sizeOrOpts as (p: number) => void)
				: (legacyOnProgress ?? (typeof sizeOrOpts === 'object' ? sizeOrOpts.onProgress : undefined));
		const frameWidth = THUMBNAIL_SIZE_WIDTHS[size];
		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();

		if (!file?.filePath || !existsSync(file.filePath)) {
			this.logger.warn(`No file found for movie ${movieId}`);
			return null;
		}

		const durationSeconds = file.durationSeconds ?? 0;
		if (durationSeconds < 5) {
			this.logger.warn(`Movie ${movieId} too short for sprites (${durationSeconds}s)`);
			return null;
		}

		// Calculate interval: target ~2400 frames at 3s default, clamp 3-10s
		const rawInterval = durationSeconds / 2400;
		const interval = Math.max(3, Math.min(10, Math.round(rawInterval * 10) / 10));
		const totalFrames = Math.floor(durationSeconds / interval);
		const sheetCount = Math.ceil(totalFrames / FRAMES_PER_SHEET);

		// Prepare output directory — scoped to the requested size so
		// multiple sizes can coexist for the same movie.
		const movieDir = this.getMovieDir(movieId, size);
		if (existsSync(movieDir)) rmSync(movieDir, { recursive: true });
		mkdirSync(movieDir, { recursive: true });

		this.logger.log(
			`Generating ${sheetCount} ${size} sprite sheets for movie ${movieId} ` +
				`(${totalFrames} frames, ${interval}s interval, ${frameWidth}px wide)`,
		);

		const ffmpegPath = this.detectFfmpeg();
		// Use the native file path — spawn passes args individually so special chars are safe
		const filePath = file.filePath;
		const framesDir = join(movieDir, '_frames');
		mkdirSync(framesDir, { recursive: true });

		// Extract individual frames using -ss input seeking (near-instant per frame).
		// This is MUCH faster than fps filter which decodes every frame sequentially.
		try {
			for (let i = 0; i < totalFrames; i++) {
				const timestamp = i * interval;
				const framePath = join(framesDir, `${String(i).padStart(5, '0')}.jpg`);
				await this.runFfmpeg(ffmpegPath, [
					'-ss',
					String(timestamp),
					'-i',
					filePath,
					'-vf',
					`scale=${frameWidth}:-2`,
					'-frames:v',
					'1',
					'-q:v',
					String(QUALITY),
					'-y',
					framePath,
				]);

				if (i % 50 === 0) {
					onProgress?.(Math.round((i / totalFrames) * 90));
				}
			}
		} catch (err: any) {
			this.logger.error(`Frame extraction failed for ${movieId}: ${err.message}`);
			if (existsSync(movieDir)) rmSync(movieDir, { recursive: true });
			return null;
		}

		// Stitch frames into sprite sheets using tile filter
		const extractedFrames = readdirSync(framesDir)
			.filter((f) => f.endsWith('.jpg'))
			.sort();
		const actualTotalFrames = extractedFrames.length;
		const actualSheetCount = Math.ceil(actualTotalFrames / FRAMES_PER_SHEET);

		try {
			for (let s = 0; s < actualSheetCount; s++) {
				const startIdx = s * FRAMES_PER_SHEET;
				const endIdx = Math.min(startIdx + FRAMES_PER_SHEET, actualTotalFrames);
				const chunkFrames = extractedFrames.slice(startIdx, endIdx);

				// Create a temporary concat file listing the frames for this sheet
				const concatPath = join(movieDir, `_concat_${s}.txt`);
				const concatContent = chunkFrames
					.map((f) => `file '${join(framesDir, f).replace(/\\/g, '/')}'`)
					.join('\n');
				writeFileSync(concatPath, concatContent);

				// Use concat demuxer + tile to stitch into a grid
				const rows = Math.ceil(chunkFrames.length / COLUMNS);
				await this.runFfmpeg(ffmpegPath, [
					'-f',
					'concat',
					'-safe',
					'0',
					'-i',
					concatPath,
					'-vf',
					`tile=${COLUMNS}x${rows}`,
					'-q:v',
					String(QUALITY),
					'-y',
					join(movieDir, `${s}.jpg`),
				]);

				// Clean up concat file
				rmSync(concatPath, { force: true });
			}
		} catch (err: any) {
			this.logger.error(`Sheet stitching failed for ${movieId}: ${err.message}`);
			if (existsSync(movieDir)) rmSync(movieDir, { recursive: true });
			return null;
		}

		// Clean up individual frames
		rmSync(framesDir, { recursive: true, force: true });

		const frameHeight = Math.round((frameWidth / 16) * 9);

		const meta: SpriteMeta = {
			interval,
			frameWidth,
			frameHeight,
			columns: COLUMNS,
			rows: ROWS,
			sheetCount: actualSheetCount,
			totalFrames,
			size,
		};

		writeFileSync(this.getMetaPath(movieId, size), JSON.stringify(meta));
		onProgress?.(100);

		this.logger.log(
			`Sprite sheets complete for ${movieId} (${size}): ${actualSheetCount} sheets, ${totalFrames} frames`,
		);
		return meta;
	}

	/** Run FFmpeg asynchronously with low priority so it doesn't block the server */
	private runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn(ffmpegPath, args, {
				stdio: 'pipe',
				// On Windows, BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
				...(process.platform === 'win32' ? { windowsHide: true } : {}),
			});

			let stderr = '';
			proc.stderr?.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const timeout = setTimeout(() => {
				proc.kill('SIGKILL');
				reject(new Error('FFmpeg timed out after 10 minutes'));
			}, 600_000);

			proc.on('close', (code) => {
				clearTimeout(timeout);
				if (code === 0) resolve();
				else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
			});

			proc.on('error', (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	}

	private detectFfmpeg(): string {
		// Check common locations
		const candidates = [
			'ffmpeg',
			'C:/ffmpeg/ffmpeg.exe',
			'/usr/bin/ffmpeg',
			'/usr/local/bin/ffmpeg',
		];
		for (const candidate of candidates) {
			try {
				execSync(`"${candidate}" -version`, { stdio: 'pipe', timeout: 5000 });
				return candidate;
			} catch {}
		}
		throw new Error('FFmpeg not found');
	}
}
