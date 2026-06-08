import { existsSync } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import { GuidResolverService } from '../../common/guid-resolver.service.js';
import { ConfigService } from '../../config/config.service.js';

interface SubtitleTrack {
	index: number;
	language: string;
	title: string;
	external?: boolean;
	forced?: boolean;
	codec?: string;
	/** Source sidecar filename (external tracks) — distinguishes multiple
	 * downloads of the same language and drives precise deletion. */
	fileName?: string;
}

@Injectable()
export class SubtitleService {
	private readonly logger = new Logger(SubtitleService.name);
	private readonly cacheDir: string;

	constructor(
		private readonly guidResolver: GuidResolverService,
		private readonly config: ConfigService,
	) {
		// Anchor under the configurable cache root (cache.subtitleDir is resolved
		// from cache.dir at load time); fall back to the legacy relative path.
		const configured = this.config.get<string>('cache.subtitleDir', '');
		this.cacheDir = configured
			? path.resolve(configured)
			: path.resolve('data/cache/subtitles');
	}

	/**
	 * Extract embedded subtitle tracks from a video file using ffprobe,
	 * then extract each subtitle stream to WebVTT format.
	 * Returns metadata about the discovered subtitle tracks.
	 */
	async extractSubtitles(
		filePath: string,
		movieFileId: string,
		/** Pre-loaded subtitle track info from DB (skips FFprobe if provided) */
		storedTracks?: {
			index: number;
			language?: string;
			title?: string;
			codec?: string;
			forced?: boolean;
			external?: boolean;
			fileName?: string;
		}[],
	): Promise<SubtitleTrack[]> {
		const outputDir = this.getSubtitleDir(movieFileId);
		await mkdir(outputDir, { recursive: true });

		const tracks: SubtitleTrack[] = [];

		// Use stored track info if available (avoids FFprobe)
		if (storedTracks && storedTracks.length > 0) {
			for (let i = 0; i < storedTracks.length; i++) {
				const track = storedTracks[i]!;
				const outputPath = path.join(outputDir, `${i}.vtt`);
				const pushStored = () =>
					tracks.push({
						index: i,
						language: track.language || 'und',
						title: track.title || `Track ${i}`,
						forced: track.forced,
						codec: track.codec,
						external: track.external,
						fileName: track.fileName,
					});

				// Skip extraction if VTT already exists from a previous session
				try {
					await access(outputPath);
					pushStored();
					continue;
				} catch {
					// Not yet extracted
				}

				try {
					if (track.external) {
						// External tracks live in a sidecar file, not an embedded
						// stream — convert that, don't ffmpeg-extract from the video.
						const sidecar = this.resolveSidecarPath(filePath, track);
						if (!sidecar) {
							this.logger.warn(
								`External subtitle sidecar missing for stored track ${i} (${track.fileName || track.language})`,
							);
							continue;
						}
						await this.convertToVtt(sidecar, outputPath);
					} else {
						await this.extractTrack(filePath, track.index, outputPath);
					}
					pushStored();
				} catch (err) {
					this.logger.warn(
						`Failed to prepare subtitle track ${i} from ${path.basename(filePath)}: ${err}`,
					);
				}
			}
		} else {
			// Fallback: probe the file for embedded subtitles
			try {
				const probeData = await this.probe(filePath);
				const subtitleStreams = (probeData.streams || []).filter(
					(stream: any) => stream.codec_type === 'subtitle',
				);

				for (let i = 0; i < subtitleStreams.length; i++) {
					const stream = subtitleStreams[i];
					const language = stream.tags?.language || 'und';
					const title = stream.tags?.title || `Track ${i}`;
					const outputPath = path.join(outputDir, `${i}.vtt`);

					// Skip if already extracted
					try {
						await access(outputPath);
						tracks.push({ index: i, language, title });
						continue;
					} catch {}

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
			} catch (err) {
				this.logger.warn(
					`ffprobe unavailable, skipping embedded subtitle extraction: ${err}`,
				);
			}
		}

		// Discover and convert external subtitle files — but skip any sidecar
		// already represented by a stored track, otherwise external subs get
		// duplicated (the stored list already includes them, which then renders
		// a phantom second entry whose index doesn't exist in the DB).
		const knownSidecars = new Set<string>();
		for (const t of storedTracks ?? []) {
			if (!t.external) continue;
			const p = this.resolveSidecarPath(filePath, t);
			if (p) knownSidecars.add(path.basename(p).toLowerCase());
		}
		try {
			const externalFiles = await this.findExternalSubtitles(filePath);
			for (const extFile of externalFiles) {
				if (knownSidecars.has(path.basename(extFile).toLowerCase())) continue;
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
						fileName: path.basename(extFile),
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
		let langIdx = -1;
		for (let i = parts.length - 1; i >= 1; i--) {
			const part = parts[i]!.toLowerCase();
			if (part === 'forced') continue;
			if (langCodes.has(part)) {
				language = part;
				langIdx = i;
				break;
			}
		}

		// Any segments AFTER the language code are a distinguishing tag (e.g. the
		// release name we attach on download), so multiple same-language
		// subtitles don't all collapse to a bare "EN".
		const extras =
			langIdx >= 0
				? parts.slice(langIdx + 1).filter((p) => p && p.toLowerCase() !== 'forced')
				: [];
		let title = language.toUpperCase();
		if (forced) title += ' (Forced)';
		if (extras.length) title += ` · ${extras.join('.')}`;
		return { language, title, forced };
	}

	/**
	 * Locate the sidecar file for a stored external track: the exact `fileName`
	 * when present, else the legacy `<base>.<lang>.<ext>` convention.
	 */
	private resolveSidecarPath(
		videoFilePath: string,
		track: { language?: string; fileName?: string },
	): string | null {
		const dir = path.dirname(videoFilePath);
		if (track.fileName) {
			const p = path.join(dir, track.fileName);
			return existsSync(p) ? p : null;
		}
		const base = path.basename(videoFilePath, path.extname(videoFilePath));
		const lang = track.language || 'en';
		for (const ext of ['.srt', '.vtt', '.ass', '.ssa', '.sub']) {
			const p = path.join(dir, `${base}.${lang}${ext}`);
			if (existsSync(p)) return p;
		}
		return null;
	}

	/**
	 * Convert an external subtitle file to WebVTT format.
	 * If already VTT, copies it directly.
	 */
	async convertToVtt(inputPath: string, outputPath: string): Promise<void> {
		const ext = path.extname(inputPath).toLowerCase();
		const { copyFile, readFile: readF, writeFile: writeF } = await import('node:fs/promises');

		if (ext === '.vtt') {
			await copyFile(inputPath, outputPath);
			return;
		}

		// Pure-JS SRT → VTT conversion (no ffmpeg needed for the most common case)
		if (ext === '.srt') {
			try {
				let content = await readF(inputPath, 'utf-8');
				// Remove BOM if present
				if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
				// Replace SRT timestamps (comma separator) with VTT (dot separator)
				const vtt = content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
				await writeF(outputPath, `WEBVTT\n\n${vtt}`, 'utf-8');
				return;
			} catch {
				// Fall through to ffmpeg
			}
		}

		// Fallback to ffmpeg for other formats (ASS, SSA, SUB, etc.)
		return new Promise((resolve, reject) => {
			const command = ffmpeg(inputPath);
			if (process.platform === 'win32') {
				command.inputOptions(['-hwaccel', 'none']);
			}
			command
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
			this.logger.debug(
				`Cleared subtitle cache for file ${this.guidResolver.resolve(movieFileId)}`,
			);
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
			const command = ffmpeg(inputPath);
			if (process.platform === 'win32') {
				command.inputOptions(['-hwaccel', 'none']);
			}
			command
				.outputOptions(['-map', `0:${streamIndex}`, '-c:s', 'webvtt'])
				.output(outputPath)
				.on('error', (err: Error) => reject(err))
				.on('end', () => resolve())
				.run();
		});
	}
}
