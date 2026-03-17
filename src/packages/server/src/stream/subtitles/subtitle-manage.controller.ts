import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import {
	BadGatewayException,
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
import { RemoteService } from '../../remote/remote.service.js';
import { SubtitleService } from './subtitle.service.js';
import { SubtitleSearchService } from './subtitle-search.service.js';

@Controller('subtitles')
export class SubtitleManageController {
	private readonly logger = new Logger(SubtitleManageController.name);

	constructor(
		private readonly subtitleSearch: SubtitleSearchService,
		private readonly subtitleService: SubtitleService,
		private readonly database: DatabaseService,
		private readonly remoteService: RemoteService,
	) {}

	/**
	 * GET /subtitles/:movieId — List existing subtitle tracks for a movie
	 */
	@Get(':movieId')
	async listSubtitles(
		@Param('movieId') movieId: string,
	): Promise<{ subtitles: MovieSubtitleInfo[] }> {
		const remote = this.parseRemoteId(movieId);
		if (remote) {
			return this.proxyRemoteGet(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}`,
			);
		}

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
		const remote = this.parseRemoteId(movieId);
		if (remote) {
			return this.proxyRemotePost(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/search`,
				body,
			);
		}

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

		const remote = this.parseRemoteId(movieId);
		if (remote) {
			return this.proxyRemotePost(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/download`,
				body,
			);
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
		if (tracks.length > 0) {
			await this.updateSubtitleTracks(file.id, tracks);
		} else {
			// extractSubtitles returned empty (ffprobe/ffmpeg unavailable) —
			// manually register the downloaded file in the DB
			const existing = this.parseSubtitleTracks(
				this.database.db.select().from(movieFiles).where(eq(movieFiles.id, file.id)).get()
					?.subtitleTracks ?? null,
			);
			const newIdx = existing.length;
			existing.push({
				index: newIdx,
				language: lang,
				title: `${lang.toUpperCase()} (Downloaded)`,
				external: true,
			});
			await this.updateSubtitleTracks(file.id, existing);
			tracks.push({
				index: newIdx,
				language: lang,
				title: `${lang.toUpperCase()} (Downloaded)`,
				external: true,
			});

			// Also convert to VTT manually so it's serveable
			const outputDir = path.join('data', 'cache', 'subtitles', file.id);
			const { mkdir: mkdirP } = await import('node:fs/promises');
			await mkdirP(outputDir, { recursive: true });
			await this.subtitleService.convertToVtt(
				subFilePath,
				path.join(outputDir, `${newIdx}.vtt`),
			);
		}

		const newTrack = tracks[tracks.length - 1];
		return {
			subtitle: {
				index: newTrack?.index ?? 0,
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
		const remote = this.parseRemoteId(movieId);
		if (remote) {
			// Parse the multipart upload, then proxy it to the remote server
			const data = await (req as any).file();
			if (!data) throw new BadRequestException('No file uploaded');

			const chunks: Buffer[] = [];
			for await (const chunk of data.file) {
				chunks.push(chunk);
			}
			const fileBuffer = Buffer.concat(chunks);

			return this.proxyRemoteUpload(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/upload`,
				fileBuffer,
				data.filename as string,
			);
		}

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

		if (tracks.length > 0) {
			await this.updateSubtitleTracks(file.id, tracks);
		} else {
			// Fallback: manually register the uploaded file
			const existing = this.parseSubtitleTracks(
				this.database.db.select().from(movieFiles).where(eq(movieFiles.id, file.id)).get()
					?.subtitleTracks ?? null,
			);
			const newIdx = existing.length;
			existing.push({
				index: newIdx,
				language: lang,
				title: `${lang.toUpperCase()} (Uploaded)`,
				external: true,
			});
			await this.updateSubtitleTracks(file.id, existing);
			tracks.push({
				index: newIdx,
				language: lang,
				title: `${lang.toUpperCase()} (Uploaded)`,
				external: true,
			});

			const outputDir = path.join('data', 'cache', 'subtitles', file.id);
			const { mkdir: mkdirP } = await import('node:fs/promises');
			await mkdirP(outputDir, { recursive: true });
			await this.subtitleService.convertToVtt(
				subFilePath,
				path.join(outputDir, `${newIdx}.vtt`),
			);
		}

		const newTrack = tracks[tracks.length - 1];
		return {
			subtitle: {
				index: newTrack?.index ?? 0,
				language: lang,
				label: newTrack?.title || `${lang.toUpperCase()} (Uploaded)`,
				external: true,
			},
		};
	}

	// ── Remote helpers ──

	private parseRemoteId(movieId: string): { serverId: string; remoteMovieId: string } | null {
		const match = movieId.match(/^remote:([^:]+):(.+)$/);
		if (!match) return null;
		return { serverId: match[1]!, remoteMovieId: match[2]! };
	}

	private getRemoteAuth(serverId: string): { baseUrl: string; headers: Record<string, string> } {
		const auth = this.remoteService.getServerAuth(serverId);
		if (!auth) throw new NotFoundException(`Remote server ${serverId} not found`);
		return auth;
	}

	private async proxyRemoteGet<T>(serverId: string, path: string): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const response = await fetch(`${baseUrl}/api/v1${path}`, {
			headers,
			signal: AbortSignal.timeout(15000),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${body}`);
		}
		return (await response.json()) as T;
	}

	private async proxyRemotePost<T>(serverId: string, path: string, body: unknown): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const response = await fetch(`${baseUrl}/api/v1${path}`, {
			method: 'POST',
			headers: { ...headers, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${text}`);
		}
		return (await response.json()) as T;
	}

	private async proxyRemoteUpload<T>(
		serverId: string,
		path: string,
		fileBuffer: Buffer,
		fileName: string,
	): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const boundary = `----CineHostBoundary${Date.now()}`;
		const parts = [
			`--${boundary}\r\n`,
			`Content-Disposition: form-data; name="subtitle"; filename="${fileName}"\r\n`,
			'Content-Type: application/octet-stream\r\n\r\n',
		];
		const header = Buffer.from(parts.join(''));
		const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
		const body = Buffer.concat([header, fileBuffer, footer]);

		const response = await fetch(`${baseUrl}/api/v1${path}`, {
			method: 'POST',
			headers: {
				...headers,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body,
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${text}`);
		}
		return (await response.json()) as T;
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
