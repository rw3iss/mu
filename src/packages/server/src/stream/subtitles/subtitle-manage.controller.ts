import path from 'node:path';
import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Logger,
	NotFoundException,
	Param,
	Post,
	Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SubtitleService } from './subtitle.service.js';
import {
	SUBTITLE_EXTS,
	SubtitleIngestionService,
} from './subtitle-ingestion.service.js';
import { SubtitleRemoteProxyService } from './subtitle-remote-proxy.service.js';
import { SubtitleSearchService } from './subtitle-search.service.js';
import { SubtitleTracksRepository } from './subtitle-tracks.repository.js';

@Controller('subtitles')
export class SubtitleManageController {
	private readonly logger = new Logger(SubtitleManageController.name);

	constructor(
		private readonly subtitleSearch: SubtitleSearchService,
		private readonly subtitleService: SubtitleService,
		private readonly tracksRepo: SubtitleTracksRepository,
		private readonly remoteProxy: SubtitleRemoteProxyService,
		private readonly ingestion: SubtitleIngestionService,
	) {}

	/** GET /subtitles/:movieId — List existing subtitle tracks for a movie */
	@Get(':movieId')
	async listSubtitles(
		@Param('movieId') movieId: string,
	): Promise<{ subtitles: MovieSubtitleInfo[] }> {
		const remote = this.remoteProxy.parseRemoteId(movieId);
		if (remote) {
			return this.remoteProxy.get(remote.serverId, `/shared/subtitles/${remote.remoteMovieId}`);
		}

		const file = await this.tracksRepo.getAvailableMovieFile(movieId);
		const tracks = this.tracksRepo.parseTracks(file.subtitleTracks);
		return {
			subtitles: tracks.map((t) => ({
				index: t.index,
				language: t.language || 'und',
				label: t.title || t.language || `Track ${t.index}`,
				codec: t.codec,
				forced: t.forced ?? false,
				external: t.external ?? false,
			})),
		};
	}

	/** POST /subtitles/:movieId/search — Search third-party APIs for subtitles */
	@Post(':movieId/search')
	async searchSubtitles(
		@Param('movieId') movieId: string,
		@Body() body: { language?: string },
	): Promise<{ results: SubtitleSearchResult[] }> {
		const remote = this.remoteProxy.parseRemoteId(movieId);
		if (remote) {
			return this.remoteProxy.post(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/search`,
				body,
			);
		}

		const movie = await this.tracksRepo.getMovie(movieId);
		const file = await this.tracksRepo.getAvailableMovieFile(movieId);

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

	/** POST /subtitles/:movieId/download — Download from a provider and save it */
	@Post(':movieId/download')
	async downloadSubtitle(
		@Param('movieId') movieId: string,
		@Body() body: { provider: string; fileId: string; language?: string },
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		if (!body.provider || !body.fileId) {
			throw new BadRequestException('provider and fileId are required');
		}

		const remote = this.remoteProxy.parseRemoteId(movieId);
		if (remote) {
			return this.remoteProxy.post(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/download`,
				body,
			);
		}

		const file = await this.tracksRepo.getAvailableMovieFile(movieId);
		const { data, format } = await this.subtitleSearch.downloadFromProvider(
			body.provider,
			body.fileId,
		);

		const lang = body.language || 'en';
		const subFilePath = await this.ingestion.writeSidecar(
			file.filePath,
			lang,
			`.${format}`,
			data,
		);
		this.logger.log(`Saved subtitle: ${subFilePath} (${data.length} bytes)`);

		const newTrack = await this.ingestion.registerExternal({
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
	 * POST /subtitles/:movieId/upload — Upload a subtitle file manually
	 * Expects multipart form with a single file field "subtitle"
	 */
	@Post(':movieId/upload')
	async uploadSubtitle(
		@Param('movieId') movieId: string,
		@Req() req: FastifyRequest,
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		const remote = this.remoteProxy.parseRemoteId(movieId);
		if (remote) {
			const data = await (req as any).file();
			if (!data) throw new BadRequestException('No file uploaded');

			const fileBuffer = await this.ingestion.readMultipart(data.file);
			return this.remoteProxy.upload(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/upload`,
				fileBuffer,
				data.filename as string,
			);
		}

		const file = await this.tracksRepo.getAvailableMovieFile(movieId);
		const data = await (req as any).file();
		if (!data) throw new BadRequestException('No file uploaded');

		const originalName = data.filename as string;
		const ext = path.extname(originalName).toLowerCase();
		if (!SUBTITLE_EXTS.includes(ext as (typeof SUBTITLE_EXTS)[number])) {
			throw new BadRequestException(
				`Unsupported subtitle format "${ext}". Supported: ${SUBTITLE_EXTS.join(', ')}`,
			);
		}

		const fileBuffer = await this.ingestion.readMultipart(data.file);
		const parsed = this.subtitleService.parseSubtitleFilename(originalName);
		const lang = parsed.language !== 'und' ? parsed.language : 'en';

		const subFilePath = await this.ingestion.writeSidecar(file.filePath, lang, ext, fileBuffer);
		this.logger.log(`Uploaded subtitle: ${subFilePath} (${fileBuffer.length} bytes)`);

		const newTrack = await this.ingestion.registerExternal({
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

	/** DELETE /subtitles/:movieId/:trackIndex — Delete a subtitle track */
	@Delete(':movieId/:trackIndex')
	async deleteSubtitle(
		@Param('movieId') movieId: string,
		@Param('trackIndex') trackIndex: string,
	): Promise<{ success: boolean }> {
		const idx = parseInt(trackIndex, 10);
		if (Number.isNaN(idx) || idx < 0) {
			throw new BadRequestException('Invalid track index');
		}

		const remote = this.remoteProxy.parseRemoteId(movieId);
		if (remote) {
			return this.remoteProxy.delete(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}/${trackIndex}`,
			);
		}

		const file = this.tracksRepo.getAnyMovieFile(movieId);
		if (!file) throw new NotFoundException(`No file found for movie ${movieId}`);

		const tracks = this.tracksRepo.parseTracks(file.subtitleTracks);
		const track = tracks.find((t) => t.index === idx);
		if (!track) throw new NotFoundException(`Track ${idx} not found`);

		// Delete the cached VTT file
		const vttPath = this.subtitleService.getSubtitleFile(file.id, idx);
		await this.unlinkQuietly(vttPath);

		// External tracks own a sidecar file on disk — clean it up too
		if (track.external) {
			await this.deleteExternalSidecars(file.filePath, track.language || 'en');
		}

		// Remove the row and re-index remaining tracks contiguously
		const remaining = tracks
			.filter((t) => t.index !== idx)
			.map((t, i) => ({ ...t, index: i }));
		await this.tracksRepo.setTracks(file.id, remaining);

		// Re-extract to rebuild VTT cache with correct indices
		await this.subtitleService.clearCache(file.id);
		await this.subtitleService.extractSubtitles(file.filePath, file.id).catch(() => {
			// If ffprobe unavailable, keep the DB state we already set
		});

		return { success: true };
	}

	// ── Private helpers ──────────────────────────────────────────────

	private async deleteExternalSidecars(moviePath: string, lang: string): Promise<void> {
		const dir = path.dirname(moviePath);
		const base = path.basename(moviePath, path.extname(moviePath));
		for (const ext of SUBTITLE_EXTS) {
			for (const pattern of [`${base}.${lang}${ext}`, `${base}.${lang}.${ext}`]) {
				if (await this.unlinkQuietly(path.join(dir, pattern))) {
					this.logger.log(`Deleted subtitle file: ${pattern}`);
				}
			}
		}
	}

	private async unlinkQuietly(filePath: string): Promise<boolean> {
		try {
			const { unlink } = await import('node:fs/promises');
			await unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}
}
