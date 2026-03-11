import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';

interface SubtitleTrack {
	index: number;
	language: string;
	title: string;
	external?: boolean;
}

@Injectable()
export class SubtitleService {
	private readonly logger = new Logger(SubtitleService.name);
	private readonly cacheDir: string;

	constructor() {
		this.cacheDir = path.resolve('data/cache/subtitles');
	}

	/**
	 * Extract embedded subtitle tracks from a video file using ffprobe,
	 * then extract each subtitle stream to WebVTT format.
	 * Returns metadata about the discovered subtitle tracks.
	 */
	async extractSubtitles(filePath: string, movieFileId: string): Promise<SubtitleTrack[]> {
		const outputDir = this.getSubtitleDir(movieFileId);
		await mkdir(outputDir, { recursive: true });

		// Use ffprobe to discover subtitle streams
		const probeData = await this.probe(filePath);
		const subtitleStreams = (probeData.streams || []).filter(
			(stream: any) => stream.codec_type === 'subtitle',
		);

		const tracks: SubtitleTrack[] = [];

		// Extract embedded subtitles
		for (let i = 0; i < subtitleStreams.length; i++) {
			const stream = subtitleStreams[i];
			const language = stream.tags?.language || 'und';
			const title = stream.tags?.title || `Track ${i}`;
			const outputPath = path.join(outputDir, `${i}.vtt`);

			try {
				await this.extractTrack(filePath, stream.index, outputPath);
				tracks.push({ index: i, language, title });
				this.logger.debug(
					`Extracted subtitle track ${i} (${language}) from ${path.basename(filePath)}`,
				);
			} catch (err) {
				this.logger.warn(
					`Failed to extract subtitle track ${i} from ${path.basename(filePath)}: ${err}`,
				);
			}
		}

		// Discover and convert external subtitle files
		try {
			const externalFiles = await this.findExternalSubtitles(filePath);
			for (const extFile of externalFiles) {
				const idx = tracks.length;
				const parsed = this.parseSubtitleFilename(extFile);
				const outputPath = path.join(outputDir, `${idx}.vtt`);

				try {
					await this.convertToVtt(extFile, outputPath);
					tracks.push({
						index: idx,
						language: parsed.language,
						title: parsed.title,
						external: true,
					});
					this.logger.debug(`Converted external subtitle: ${path.basename(extFile)}`);
				} catch (err) {
					this.logger.warn(`Failed to convert external subtitle ${extFile}: ${err}`);
				}
			}
		} catch (err) {
			this.logger.warn(`Failed to find external subtitles: ${err}`);
		}

		if (tracks.length === 0) {
			this.logger.debug(`No subtitles found for ${path.basename(filePath)}`);
		}

		return tracks;
	}

	/**
	 * Get the file path for a specific extracted subtitle track in WebVTT format.
	 */
	getSubtitleFile(movieFileId: string, trackIndex: number): string {
		return path.join(this.getSubtitleDir(movieFileId), `${trackIndex}.vtt`);
	}

	/**
	 * Search for external subtitle files (.srt, .vtt, .ass) located alongside
	 * the video file and in common subtitle subdirectories.
	 * Returns an array of absolute paths to discovered subtitle files.
	 */
	async findExternalSubtitles(videoFilePath: string): Promise<string[]> {
		const dir = path.dirname(videoFilePath);
		const baseName = path.basename(videoFilePath, path.extname(videoFilePath));
		const subtitleExtensions = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
		const subtitleFiles: string[] = [];

		// Search in the same directory as the video
		try {
			const files = await readdir(dir);
			for (const file of files) {
				const ext = path.extname(file).toLowerCase();
				if (!subtitleExtensions.includes(ext)) continue;
				if (file.startsWith(baseName)) {
					subtitleFiles.push(path.join(dir, file));
				}
			}
		} catch {
			// directory not readable
		}

		// Also search in common subtitle subdirectories
		const subDirs = ['Subs', 'Subtitles', 'subs', 'subtitles'];
		for (const subDir of subDirs) {
			const subDirPath = path.join(dir, subDir);
			let subFiles: string[];
			try {
				subFiles = await readdir(subDirPath);
			} catch {
				continue;
			}
			for (const file of subFiles) {
				const ext = path.extname(file).toLowerCase();
				if (!subtitleExtensions.includes(ext)) continue;
				// Accept all subtitle files in dedicated subtitle directories
				subtitleFiles.push(path.join(subDirPath, file));
			}
		}

		return subtitleFiles;
	}

	/**
	 * Parse language and forced flag from a subtitle filename.
	 * Handles: movie.en.srt, movie.English.srt, movie.forced.en.srt
	 */
	parseSubtitleFilename(filePath: string): { language: string; title: string; forced: boolean } {
		const fileName = path.basename(filePath, path.extname(filePath));
		const parts = fileName.split('.');
		const forced = parts.some((p) => p.toLowerCase() === 'forced');

		// Common ISO 639-1 and 639-2 codes
		const langCodes = new Set([
			'en',
			'eng',
			'es',
			'spa',
			'fr',
			'fra',
			'de',
			'deu',
			'ger',
			'it',
			'ita',
			'pt',
			'por',
			'ru',
			'rus',
			'ja',
			'jpn',
			'ko',
			'kor',
			'zh',
			'zho',
			'chi',
			'ar',
			'ara',
			'hi',
			'hin',
			'nl',
			'nld',
			'dut',
			'sv',
			'swe',
			'da',
			'dan',
			'no',
			'nor',
			'fi',
			'fin',
			'pl',
			'pol',
			'tr',
			'tur',
			'cs',
			'ces',
			'cze',
			'hu',
			'hun',
			'ro',
			'ron',
			'rum',
			'el',
			'ell',
			'gre',
			'he',
			'heb',
			'th',
			'tha',
			'vi',
			'vie',
			'uk',
			'ukr',
			'bg',
			'bul',
			'hr',
			'hrv',
			'sr',
			'srp',
		]);

		let language = 'und';
		for (let i = parts.length - 1; i >= 1; i--) {
			const part = parts[i]!.toLowerCase();
			if (part === 'forced') continue;
			if (langCodes.has(part)) {
				language = part;
				break;
			}
		}

		const title = forced ? `${language.toUpperCase()} (Forced)` : language.toUpperCase();
		return { language, title, forced };
	}

	/**
	 * Convert an external subtitle file to WebVTT format.
	 * If already VTT, copies it directly.
	 */
	async convertToVtt(inputPath: string, outputPath: string): Promise<void> {
		const ext = path.extname(inputPath).toLowerCase();
		if (ext === '.vtt') {
			const { copyFile } = await import('node:fs/promises');
			await copyFile(inputPath, outputPath);
			return;
		}

		return new Promise((resolve, reject) => {
			ffmpeg(inputPath)
				.outputOptions(['-c:s', 'webvtt'])
				.output(outputPath)
				.on('error', (err: Error) => reject(err))
				.on('end', () => resolve())
				.run();
		});
	}

	/**
	 * Delete cached subtitles for a movie file.
	 */
	async clearCache(movieFileId: string): Promise<void> {
		const dir = this.getSubtitleDir(movieFileId);
		if (existsSync(dir)) {
			await rm(dir, { recursive: true, force: true });
			this.logger.debug(`Cleared subtitle cache for file ${movieFileId}`);
		}
	}

	/**
	 * Get the cache directory for a specific movie file's subtitles.
	 */
	private getSubtitleDir(movieFileId: string): string {
		return path.join(this.cacheDir, movieFileId);
	}

	/**
	 * Run ffprobe on a file and return the parsed metadata.
	 */
	private probe(filePath: string): Promise<any> {
		return new Promise((resolve, reject) => {
			ffmpeg.ffprobe(filePath, (err: Error | null, data: any) => {
				if (err) return reject(err);
				resolve(data);
			});
		});
	}

	/**
	 * Extract a single subtitle track to WebVTT format using FFmpeg.
	 */
	private extractTrack(
		inputPath: string,
		streamIndex: number,
		outputPath: string,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			ffmpeg(inputPath)
				.outputOptions(['-map', `0:${streamIndex}`, '-c:s', 'webvtt'])
				.output(outputPath)
				.on('error', (err: Error) => reject(err))
				.on('end', () => resolve())
				.run();
		});
	}
}
