import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Logger,
	NotFoundException,
	Param,
	Post,
	Req,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, movies } from '../../database/schema/index.js';
import { SubtitleService } from './subtitle.service.js';
import { SubtitleSearchService } from './subtitle-search.service.js';

@Controller('subtitles')
export class SubtitleManageController {
	private readonly logger = new Logger(SubtitleManageController.name);

	constructor(
		private readonly subtitleSearch: SubtitleSearchService,
		private readonly subtitleService: SubtitleService,
		private readonly database: DatabaseService,
	) {}

	/**
	 * GET /subtitles/:movieId — List existing subtitle tracks for a movie
	 */
	@Get(':movieId')
	async listSubtitles(
		@Param('movieId') movieId: string,
	): Promise<{ subtitles: MovieSubtitleInfo[] }> {
		const file = await this.getMovieFile(movieId);
		const tracks = this.parseSubtitleTracks(file.subtitleTracks);
		return {
			subtitles: tracks.map((t: any) => ({
				index: t.index,
				language: t.language || 'und',
				label: t.title || t.language || `Track ${t.index}`,
				codec: t.codec,
				forced: t.forced ?? false,
				external: t.external ?? false,
			})),
		};
	}

	/**
	 * POST /subtitles/:movieId/search — Search third-party APIs for subtitles
	 */
	@Post(':movieId/search')
	async searchSubtitles(
		@Param('movieId') movieId: string,
		@Body() body: { language?: string },
	): Promise<{ results: SubtitleSearchResult[] }> {
		const movie = await this.getMovie(movieId);
		const file = await this.getMovieFile(movieId);

		const results = await this.subtitleSearch.search({
			title: movie.title,
			imdbId: movie.imdbId ?? undefined,
			tmdbId: movie.tmdbId ?? undefined,
			year: movie.year ?? undefined,
			filePath: file.filePath,
			language: body.language || 'en',
		});

		return { results };
	}

	/**
	 * POST /subtitles/:movieId/download — Download a subtitle from a provider and save it
	 */
	@Post(':movieId/download')
	async downloadSubtitle(
		@Param('movieId') movieId: string,
		@Body() body: { provider: string; fileId: string; language?: string },
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		if (!body.provider || !body.fileId) {
			throw new BadRequestException('provider and fileId are required');
		}

		const file = await this.getMovieFile(movieId);

		// Download from the provider
		const { data, format } = await this.subtitleSearch.downloadFromProvider(
			body.provider,
			body.fileId,
		);

		// Save to movie directory
		const movieDir = path.dirname(file.filePath);
		const baseName = path.basename(file.filePath, path.extname(file.filePath));
		const lang = body.language || 'en';
		const subFileName = `${baseName}.${lang}.${format}`;
		const subFilePath = path.join(movieDir, subFileName);

		await writeFile(subFilePath, data);
		this.logger.log(`Saved subtitle: ${subFilePath} (${data.length} bytes)`);

		// Re-extract subtitles to pick up the new file
		await this.subtitleService.clearCache(file.id);
		const tracks = await this.subtitleService.extractSubtitles(file.filePath, file.id);

		// Update the DB with the new tracks
		await this.updateSubtitleTracks(file.id, tracks);

		// Return info about the newly added subtitle
		const newTrack = tracks[tracks.length - 1];
		return {
			subtitle: {
				index: newTrack?.index ?? tracks.length - 1,
				language: lang,
				label: newTrack?.title || `${lang.toUpperCase()} (Downloaded)`,
				external: true,
			},
		};
	}

	/**
	 * POST /subtitles/:movieId/upload — Upload a subtitle file manually
	 * Expects multipart form with a single file field "subtitle"
	 */
	@Post(':movieId/upload')
	async uploadSubtitle(
		@Param('movieId') movieId: string,
		@Req() req: FastifyRequest,
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		const file = await this.getMovieFile(movieId);

		// Parse multipart data
		const data = await (req as any).file();
		if (!data) {
			throw new BadRequestException('No file uploaded');
		}

		const originalName = data.filename as string;
		const ext = path.extname(originalName).toLowerCase();
		const validExts = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
		if (!validExts.includes(ext)) {
			throw new BadRequestException(
				`Unsupported subtitle format "${ext}". Supported: ${validExts.join(', ')}`,
			);
		}

		// Read file buffer
		const chunks: Buffer[] = [];
		for await (const chunk of data.file) {
			chunks.push(chunk);
		}
		const fileBuffer = Buffer.concat(chunks);

		// Determine language from filename or default to 'en'
		const parsed = this.subtitleService.parseSubtitleFilename(originalName);
		const lang = parsed.language !== 'und' ? parsed.language : 'en';

		// Save next to the movie file
		const movieDir = path.dirname(file.filePath);
		const baseName = path.basename(file.filePath, path.extname(file.filePath));
		const subFileName = `${baseName}.${lang}${ext}`;
		const subFilePath = path.join(movieDir, subFileName);

		await writeFile(subFilePath, fileBuffer);
		this.logger.log(`Uploaded subtitle: ${subFilePath} (${fileBuffer.length} bytes)`);

		// Re-extract subtitles
		await this.subtitleService.clearCache(file.id);
		const tracks = await this.subtitleService.extractSubtitles(file.filePath, file.id);
		await this.updateSubtitleTracks(file.id, tracks);

		const newTrack = tracks[tracks.length - 1];
		return {
			subtitle: {
				index: newTrack?.index ?? tracks.length - 1,
				language: lang,
				label: newTrack?.title || `${lang.toUpperCase()} (Uploaded)`,
				external: true,
			},
		};
	}

	// ── Helpers ──

	private async getMovie(movieId: string) {
		const result = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!result) throw new NotFoundException(`Movie ${movieId} not found`);
		return result;
	}

	private async getMovieFile(movieId: string) {
		const result = this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)))
			.get();
		if (!result) throw new NotFoundException(`No available file for movie ${movieId}`);
		return result;
	}

	private parseSubtitleTracks(json: string | null): any[] {
		if (!json) return [];
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}

	private async updateSubtitleTracks(fileId: string, tracks: any[]) {
		await this.database.db
			.update(movieFiles)
			.set({
				subtitleTracks: JSON.stringify(
					tracks.map((t) => ({
						index: t.index,
						language: t.language,
						title: t.title,
						external: t.external ?? false,
					})),
				),
			})
			.where(eq(movieFiles.id, fileId));
	}
}
