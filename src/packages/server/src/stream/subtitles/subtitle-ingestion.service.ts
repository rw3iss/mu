import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { SubtitleService } from './subtitle.service.js';
import {
	SubtitleTrackRow,
	SubtitleTracksRepository,
} from './subtitle-tracks.repository.js';

export const SUBTITLE_EXTS = ['.srt', '.vtt', '.ass', '.ssa', '.sub'] as const;

/**
 * Orchestrates the "an external subtitle just landed on disk, register it
 * in the DB and serve it as VTT" flow. The happy path delegates to
 * `SubtitleService.extractSubtitles` (ffprobe finds the new sidecar
 * automatically); the fallback path handles boxes where ffmpeg/ffprobe
 * isn't available by manually appending a track row and converting the
 * file to VTT directly.
 *
 * Shared by `SubtitleManageController` (owner library) and
 * `SharingController` (federated library upload/download proxies).
 */
@Injectable()
export class SubtitleIngestionService {
	private readonly logger = new Logger(SubtitleIngestionService.name);

	constructor(
		private readonly subtitleService: SubtitleService,
		private readonly tracksRepo: SubtitleTracksRepository,
	) {}

	/** Compose `<dir>/<base>.<lang><ext>` next to the movie file. */
	sidecarPath(moviePath: string, lang: string, ext: string): string {
		const dir = path.dirname(moviePath);
		const base = path.basename(moviePath, path.extname(moviePath));
		return path.join(dir, `${base}.${lang}${ext}`);
	}

	/** Write a subtitle sidecar next to the movie file, returns the absolute path. */
	async writeSidecar(
		moviePath: string,
		lang: string,
		ext: string,
		buf: Buffer,
	): Promise<string> {
		const out = this.sidecarPath(moviePath, lang, ext);
		await writeFile(out, buf);
		return out;
	}

	/** Read all chunks from a Fastify multipart file stream into one Buffer. */
	async readMultipart(stream: AsyncIterable<Buffer>): Promise<Buffer> {
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk);
		return Buffer.concat(chunks);
	}

	/**
	 * After writing an external subtitle to disk, persist it in the DB
	 * and ensure a VTT cache entry exists. Returns the new track row.
	 */
	async registerExternal(args: {
		fileId: string;
		filePath: string;
		subFilePath: string;
		lang: string;
		labelSuffix: 'Downloaded' | 'Uploaded';
	}): Promise<SubtitleTrackRow> {
		const { fileId, filePath, subFilePath, lang, labelSuffix } = args;

		await this.subtitleService.clearCache(fileId);
		const tracks = await this.subtitleService.extractSubtitles(filePath, fileId);

		if (tracks.length > 0) {
			await this.tracksRepo.setTracks(fileId, tracks);
			return tracks[tracks.length - 1]!;
		}

		// Fallback path — manually register + convert
		const existing = this.tracksRepo.getPersistedTracks(fileId);
		const newIdx = existing.length;
		const label = `${lang.toUpperCase()} (${labelSuffix})`;
		const newTrack: SubtitleTrackRow = {
			index: newIdx,
			language: lang,
			title: label,
			external: true,
		};
		existing.push(newTrack);
		await this.tracksRepo.setTracks(fileId, existing);

		const outputDir = path.join('data', 'cache', 'subtitles', fileId);
		const { mkdir } = await import('node:fs/promises');
		await mkdir(outputDir, { recursive: true });
		await this.subtitleService.convertToVtt(subFilePath, path.join(outputDir, `${newIdx}.vtt`));

		this.logger.log(`Registered external subtitle (fallback): ${subFilePath}`);
		return newTrack;
	}
}
