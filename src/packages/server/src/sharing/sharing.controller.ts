import path from 'node:path';
import type { MovieListQuery, MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import {
	BadRequestException,
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../common/decorators/public.decorator.js';
import { parseJsonArray } from '../common/json-fields.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies } from '../database/schema/index.js';
import { MoviesService } from '../movies/movies.service.js';
import { DirectPlayService } from '../stream/direct-play/direct-play.service.js';
import { StreamService } from '../stream/stream.service.js';
import { SubtitleService } from '../stream/subtitles/subtitle.service.js';
import {
	SUBTITLE_EXTS,
	SubtitleIngestionService,
} from '../stream/subtitles/subtitle-ingestion.service.js';
import { SubtitleSearchService } from '../stream/subtitles/subtitle-search.service.js';
import { HlsGeneratorService } from '../stream/transcoder/hls-generator.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';
import { SharingService } from './sharing.service.js';
import { SharingAuthGuard } from './sharing-auth.guard.js';

@Controller('shared')
@Public()
export class SharingController {
	constructor(
		private readonly sharingService: SharingService,
		private readonly moviesService: MoviesService,
		private readonly streamService: StreamService,
		private readonly hlsGenerator: HlsGeneratorService,
		private readonly transcoderService: TranscoderService,
		private readonly directPlayService: DirectPlayService,
		private readonly subtitleService: SubtitleService,
		private readonly subtitleSearch: SubtitleSearchService,
		private readonly subtitleIngestion: SubtitleIngestionService,
		private readonly db: DatabaseService,
	) {}

	/**
	 * GET /shared/info — Public info endpoint for connectivity testing.
	 */
	@Get('info')
	getInfo() {
		const config = this.sharingService.getConfig();
		if (!config.enabled) {
			throw new NotFoundException('Library sharing is not enabled');
		}
		return {
			serverName: config.serverName,
			movieCount: this.sharingService.getMovieCount(),
			passwordRequired: !!config.password,
		};
	}

	/**
	 * GET /shared/movies — List movies in the shared library.
	 */
	@Get('movies')
	@UseGuards(SharingAuthGuard)
	getMovies(@Query() query: MovieListQuery) {
		const result = this.moviesService.findAll(query);
		return {
			movies: result.movies.map((m: any) => ({
				...m,
				rating: undefined,
				watchPosition: undefined,
				watchCompleted: undefined,
				inWatchlist: undefined,
			})),
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
			totalPages: result.totalPages,
		};
	}

	/**
	 * GET /shared/movies/:id — Get movie detail.
	 */
	@Get('movies/:id')
	@UseGuards(SharingAuthGuard)
	getMovie(@Param('id') id: string) {
		return this.moviesService.findById(id);
	}

	/**
	 * GET /shared/stream/:movieId/start — Start a streaming session.
	 */
	@Get('stream/:movieId/start')
	@UseGuards(SharingAuthGuard)
	async startStream(@Param('movieId') movieId: string, @Query('quality') quality?: string) {
		return this.streamService.startStream(movieId, '__shared__', { quality });
	}

	/**
	 * GET /shared/stream/:sessionId/manifest.m3u8 — Serve HLS manifest.
	 */
	@Get('stream/:sessionId/manifest.m3u8')
	@UseGuards(SharingAuthGuard)
	async getManifest(@Param('sessionId') sessionId: string, @Res() reply: FastifyReply) {
		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const manifest = await this.hlsGenerator.getManifest(sessionId, dir);
		if (!manifest) {
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Manifest not yet available' });
		}

		return reply
			.header('Content-Type', 'application/vnd.apple.mpegurl')
			.header('Cache-Control', 'no-cache')
			.send(manifest);
	}

	/**
	 * GET /shared/stream/:sessionId/:segmentFile — Serve HLS segment.
	 */
	@Get('stream/:sessionId/:segmentFile')
	@UseGuards(SharingAuthGuard)
	async getSegment(
		@Param('sessionId') sessionId: string,
		@Param('segmentFile') segmentFile: string,
		@Res() reply: FastifyReply,
	) {
		const match = segmentFile.match(/^segment_(\d+)\.ts$/);
		if (!match) {
			return reply.status(404).send({ message: 'Invalid segment path' });
		}

		const state = this.transcoderService.getTranscodeState(sessionId);
		if (state?.state === 'failed') {
			return reply.status(500).send({ message: `Transcoding failed: ${state.error}` });
		}

		const dir = this.streamService.getSessionCacheDir(sessionId);
		const segment = await this.hlsGenerator.getSegment(sessionId, parseInt(match[1]!, 10), dir);
		if (!segment) {
			return reply
				.status(503)
				.header('Retry-After', '1')
				.send({ message: 'Segment not ready' });
		}

		return reply
			.header('Content-Type', 'video/mp2t')
			.header('Cache-Control', 'public, max-age=86400')
			.send(segment);
	}

	/**
	 * GET /shared/stream/direct/:fileId — Direct play with range support.
	 */
	@Get('stream/direct/:fileId')
	@UseGuards(SharingAuthGuard)
	async directPlay(
		@Param('fileId') fileId: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const fileRows = this.db.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.id, fileId))
			.all();
		if (fileRows.length === 0) {
			throw new NotFoundException(`File ${fileId} not found`);
		}
		return this.directPlayService.serveFile(fileRows[0]!.filePath, request, reply);
	}

	/**
	 * GET /shared/genres — List available genres.
	 */
	@Get('genres')
	@UseGuards(SharingAuthGuard)
	getGenres() {
		return this.moviesService.getGenres();
	}

	// ── Shared subtitle endpoints ──

	/**
	 * GET /shared/subtitles/:movieId — List subtitle tracks for a shared movie.
	 */
	@Get('subtitles/:movieId')
	@UseGuards(SharingAuthGuard)
	async listSharedSubtitles(
		@Param('movieId') movieId: string,
	): Promise<{ subtitles: MovieSubtitleInfo[] }> {
		const file = this.getMovieFile(movieId);
		const tracks = parseJsonArray<Record<string, unknown>>(file.subtitleTracks);
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
	 * POST /shared/subtitles/:movieId/search — Search for subtitles for a shared movie.
	 */
	@Post('subtitles/:movieId/search')
	@UseGuards(SharingAuthGuard)
	async searchSharedSubtitles(
		@Param('movieId') movieId: string,
		@Body() body: { language?: string },
	): Promise<{ results: SubtitleSearchResult[] }> {
		const movie = this.db.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) throw new NotFoundException(`Movie ${movieId} not found`);
		const file = this.getMovieFile(movieId);

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
	 * POST /shared/subtitles/:movieId/upload — Upload a subtitle to a shared movie.
	 */
	@Post('subtitles/:movieId/upload')
	@UseGuards(SharingAuthGuard)
	async uploadSharedSubtitle(
		@Param('movieId') movieId: string,
		@Req() req: FastifyRequest,
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		const file = this.getMovieFile(movieId);

		const data = await (req as any).file();
		if (!data) throw new BadRequestException('No file uploaded');

		const originalName = data.filename as string;
		const ext = path.extname(originalName).toLowerCase();
		if (!SUBTITLE_EXTS.includes(ext as (typeof SUBTITLE_EXTS)[number])) {
			throw new BadRequestException(`Unsupported subtitle format "${ext}"`);
		}

		const fileBuffer = await this.subtitleIngestion.readMultipart(data.file);
		const parsed = this.subtitleService.parseSubtitleFilename(originalName);
		const lang = parsed.language !== 'und' ? parsed.language : 'en';

		const subFilePath = await this.subtitleIngestion.writeSidecar(
			file.filePath,
			lang,
			ext,
			fileBuffer,
		);
		const newTrack = await this.subtitleIngestion.registerExternal({
			fileId: file.id,
			filePath: file.filePath,
			subFilePath,
			lang,
			labelSuffix: 'Uploaded',
		});
		return {
			subtitle: {
				index: newTrack.index,
				language: lang,
				label: newTrack.title || `${lang.toUpperCase()} (Uploaded)`,
				external: true,
			},
		};
	}

	/**
	 * POST /shared/subtitles/:movieId/download — Download a subtitle for a shared movie.
	 */
	@Post('subtitles/:movieId/download')
	@UseGuards(SharingAuthGuard)
	async downloadSharedSubtitle(
		@Param('movieId') movieId: string,
		@Body() body: { provider: string; fileId: string; language?: string },
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		if (!body.provider || !body.fileId) {
			throw new BadRequestException('provider and fileId are required');
		}

		const file = this.getMovieFile(movieId);
		const { data, format } = await this.subtitleSearch.downloadFromProvider(
			body.provider,
			body.fileId,
		);

		const lang = body.language || 'en';
		const subFilePath = await this.subtitleIngestion.writeSidecar(
			file.filePath,
			lang,
			`.${format}`,
			data,
		);
		const newTrack = await this.subtitleIngestion.registerExternal({
			fileId: file.id,
			filePath: file.filePath,
			subFilePath,
			lang,
			labelSuffix: 'Downloaded',
		});
		return {
			subtitle: {
				index: newTrack.index,
				language: lang,
				label: newTrack.title || `${lang.toUpperCase()} (Downloaded)`,
				external: true,
			},
		};
	}

	/**
	 * GET /shared/subtitles/:movieFileId/:trackIndex.vtt — Serve a subtitle VTT file.
	 */
	@Get('subtitles/:movieFileId/:trackFile')
	@UseGuards(SharingAuthGuard)
	async serveSharedSubtitle(
		@Param('movieFileId') movieFileId: string,
		@Param('trackFile') trackFile: string,
		@Res() reply: FastifyReply,
	) {
		const match = trackFile.match(/^(\d+)\.vtt$/);
		if (!match) throw new NotFoundException('Invalid subtitle track path');

		const trackIdx = parseInt(match[1]!, 10);
		const subtitlePath = this.subtitleService.getSubtitleFile(movieFileId, trackIdx);

		const { stat: statF, readFile: readF } = await import('node:fs/promises');
		try {
			await statF(subtitlePath);
		} catch {
			throw new NotFoundException(`Subtitle track ${trackIdx} not found`);
		}

		const content = await readF(subtitlePath);
		return reply
			.header('Content-Type', 'text/vtt; charset=utf-8')
			.header('Cache-Control', 'public, max-age=3600')
			.send(content);
	}

	private getMovieFile(movieId: string) {
		const file = this.db.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)))
			.get();
		if (!file) throw new NotFoundException(`No available file for movie ${movieId}`);
		return file;
	}
}
