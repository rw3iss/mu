import { execSync, spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles } from '../database/schema/index.js';

const COLUMNS = 10;
const ROWS = 10;
const FRAMES_PER_SHEET = COLUMNS * ROWS;
const FRAME_WIDTH = 120;
const QUALITY = 5; // FFmpeg JPEG quality (2=best, 31=worst)

export interface SpriteMeta {
	interval: number;
	frameWidth: number;
	frameHeight: number;
	columns: number;
	rows: number;
	sheetCount: number;
	totalFrames: number;
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

	/** Directory for a specific movie's sprite sheets */
	getMovieDir(movieId: string): string {
		return join(this.spriteDir, movieId);
	}

	/** Path to the metadata JSON for a movie */
	getMetaPath(movieId: string): string {
		return join(this.getMovieDir(movieId), 'meta.json');
	}

	/** Path to a specific sprite sheet image */
	getSheetPath(movieId: string, index: number): string {
		return join(this.getMovieDir(movieId), `${index}.jpg`);
	}

	/** Check if sprite sheets already exist for a movie */
	hasSprites(movieId: string): boolean {
		return existsSync(this.getMetaPath(movieId));
	}

	/** Read sprite metadata (returns null if not generated) */
	getMeta(movieId: string): SpriteMeta | null {
		const metaPath = this.getMetaPath(movieId);
		if (!existsSync(metaPath)) return null;
		try {
			const raw = readFileSync(metaPath, 'utf-8');
			return JSON.parse(raw) as SpriteMeta;
		} catch {
			return null;
		}
	}

	/**
	 * Generate sprite sheets for a movie.
	 * Uses FFmpeg fps + scale + tile filters in a single pass per sheet.
	 */
	async generateForMovie(
		movieId: string,
		onProgress?: (percent: number) => void,
	): Promise<SpriteMeta | null> {
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

		// Prepare output directory
		const movieDir = this.getMovieDir(movieId);
		if (existsSync(movieDir)) rmSync(movieDir, { recursive: true });
		mkdirSync(movieDir, { recursive: true });

		this.logger.log(
			`Generating ${sheetCount} sprite sheets for movie ${movieId} ` +
				`(${totalFrames} frames, ${interval}s interval)`,
		);

		// Detect FFmpeg path (same logic as transcoder)
		const ffmpegPath = this.detectFfmpeg();

		// Generate all sheets in a single FFmpeg command.
		// FFmpeg's tile filter with fps outputs sequentially numbered files.
		// We use: fps=1/interval -> scale -> tile=10x10
		const fps = 1 / interval;
		const outputPattern = join(movieDir, '%03d.jpg');

		try {
			const args = [
				'-y',
				'-threads',
				'2',
				'-i',
				file.filePath.replace(/\\/g, '/'),
				'-vf',
				`fps=${fps},scale=${FRAME_WIDTH}:-2,tile=${COLUMNS}x${ROWS}`,
				'-q:v',
				String(QUALITY),
				'-threads',
				'2',
				'-an',
				outputPattern,
			];

			await this.runFfmpeg(ffmpegPath, args);
		} catch (err: any) {
			this.logger.error(`FFmpeg sprite generation failed for ${movieId}: ${err.message}`);
			// Clean up partial output
			if (existsSync(movieDir)) rmSync(movieDir, { recursive: true });
			return null;
		}

		// Rename files from 001.jpg, 002.jpg to 0.jpg, 1.jpg (0-indexed)
		const files = readdirSync(movieDir)
			.filter((f) => f.endsWith('.jpg'))
			.sort();
		for (let i = 0; i < files.length; i++) {
			const src = join(movieDir, files[i]!);
			const dst = join(movieDir, `${i}.jpg`);
			if (src !== dst) {
				renameSync(src, dst);
			}
		}

		// Determine actual frame height from the first sheet
		const frameHeight = Math.round((FRAME_WIDTH / 16) * 9); // 68 for 16:9 at 120px wide
		// Note: FFmpeg scale=-2 preserves aspect ratio, height auto-calculated

		const actualSheetCount = files.length;

		const meta: SpriteMeta = {
			interval,
			frameWidth: FRAME_WIDTH,
			frameHeight,
			columns: COLUMNS,
			rows: ROWS,
			sheetCount: actualSheetCount,
			totalFrames,
		};

		writeFileSync(this.getMetaPath(movieId), JSON.stringify(meta));
		onProgress?.(100);

		this.logger.log(
			`Sprite sheets complete for ${movieId}: ${actualSheetCount} sheets, ${totalFrames} frames`,
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
