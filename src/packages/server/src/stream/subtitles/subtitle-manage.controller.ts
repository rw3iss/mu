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
	Put,
	Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SubtitleService } from './subtitle.service.js';
import { SUBTITLE_EXTS, SubtitleIngestionService } from './subtitle-ingestion.service.js';
import { SubtitleRemoteProxyService } from './subtitle-remote-proxy.service.js';
import { SubtitleSearchService } from './subtitle-search.service.js';
import { SubtitleTrackRow, SubtitleTracksRepository } from './subtitle-tracks.repository.js';

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
	@RequireAction('view:library')
	@Get(':movieId')
	async listSubtitles(
		@Param('movieId') movieId: string,
	): Promise<{ subtitles: MovieSubtitleInfo[] }> {
		const remote = this.remoteProxy.parseRemoteId(movieId);
		if (remote) {
			return this.remoteProxy.get(
				remote.serverId,
				`/shared/subtitles/${remote.remoteMovieId}`,
			);
		}

		const file = await this.tracksRepo.getAvailableMovieFile(movieId);
		let tracks = this.tracksRepo.parseTracks(file.subtitleTracks);

		// Self-heal: the persisted list is empty for movies whose sidecar /
		// embedded subtitles were never written at scan time — yet the player
		// live-probes every session (stream.service extractSubtitles) and shows
		// them, so the Manage panel would look empty while playback has tracks.
		// Probe once and persist so both agree (mirrors setDefault below, and
		// stabilises indices for delete / set-default).
		if (tracks.length === 0) {
			try {
				const live = await this.subtitleService.extractSubtitles(file.filePath, file.id);
				if (live.length > 0) {
					await this.tracksRepo.setTracks(file.id, live);
					tracks = this.tracksRepo.getPersistedTracks(file.id);
				}
			} catch {
				// Fall through with the (empty) persisted list.
			}
		}

		return {
			subtitles: tracks.map((t) => ({
				index: t.index,
				language: t.language || 'und',
				label: t.title || t.language || `Track ${t.index}`,
				codec: t.codec,
				forced: t.forced ?? false,
				external: t.external ?? false,
				default: t.default ?? false,
				fileName: t.fileName,
			})),
		};
	}

	/**
	 * PUT /subtitles/:movieId/:trackIndex/default — mark a track as the movie's
	 * default subtitle (persisted server-side; used to auto-select on play and
	 * by the admin "clean up unused subtitles" action).
	 */
	@RequireAction('edit:movie')
	@Put(':movieId/:trackIndex/default')
	async setDefaultSubtitle(
		@Param('movieId') movieId: string,
		@Param('trackIndex') trackIndex: string,
	): Promise<{ success: boolean }> {
		const idx = parseInt(trackIndex, 10);
		if (Number.isNaN(idx) || idx < 0) throw new BadRequestException('Invalid track index');

		if (this.remoteProxy.parseRemoteId(movieId)) {
			throw new BadRequestException('Default subtitle is not supported for remote movies');
		}

		const file = await this.tracksRepo.getAvailableMovieFile(movieId);
		// If the requested index isn't in the persisted list, re-sync from the
		// live file first (covers a stale DB vs. embedded/sidecar tracks the
		// player surfaced) before failing.
		if (!this.tracksRepo.getPersistedTracks(file.id).some((t) => t.index === idx)) {
			try {
				const live = await this.subtitleService.extractSubtitles(file.filePath, file.id);
				if (live.length > 0) await this.tracksRepo.setTracks(file.id, live);
			} catch {
				// fall through — setDefault throws a clean 404 if still missing
			}
		}
		await this.tracksRepo.setDefault(file.id, idx);
		return { success: true };
	}

	/** POST /subtitles/:movieId/search — Search third-party APIs for subtitles */
	@RequireAction('view:library')
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
	@RequireAction('edit:movie')
	@Post(':movieId/download')
	async downloadSubtitle(
		@Param('movieId') movieId: string,
		@Body()
		body: { provider: string; fileId: string; language?: string; releaseName?: string },
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
		// Tag the file with a slug of the release name so multiple same-language
		// downloads coexist as distinct files instead of overwriting one another.
		const tag = this.ingestion.slugTag(body.releaseName);
		const subFilePath = await this.ingestion.writeSidecar(
			file.filePath,
			lang,
			`.${format}`,
			data,
			tag,
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
				fileName: newTrack.fileName,
			},
		};
	}

	/**
	 * POST /subtitles/:movieId/upload — Upload a subtitle file manually
	 * Expects multipart form with a single file field "subtitle"
	 */
	@RequireAction('edit:movie')
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

		// Tag with the uploaded file's base name so multiple same-language
		// uploads don't overwrite one another.
		const tag = this.ingestion.slugTag(path.basename(originalName, ext));
		const subFilePath = await this.ingestion.writeSidecar(
			file.filePath,
			lang,
			ext,
			fileBuffer,
			tag,
		);
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
				fileName: newTrack.fileName,
			},
		};
	}

	/** DELETE /subtitles/:movieId/:trackIndex — Delete a subtitle track */
	@RequireAction('edit:movie')
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

		// External tracks own a sidecar file on disk — clean it up too. Prefer the
		// exact stored filename (multiple same-language sidecars now coexist);
		// fall back to the legacy language-pattern sweep for older rows.
		if (track.external) {
			if (track.fileName) {
				await this.unlinkQuietly(path.join(path.dirname(file.filePath), track.fileName));
			} else {
				await this.deleteExternalSidecars(file.filePath, track.language || 'en');
			}
		}

		// Remove the row and re-index remaining tracks contiguously
		const remaining = tracks.filter((t) => t.index !== idx).map((t, i) => ({ ...t, index: i }));
		await this.tracksRepo.setTracks(file.id, remaining);

		// Re-extract to rebuild VTT cache with correct indices
		await this.subtitleService.clearCache(file.id);
		await this.subtitleService.extractSubtitles(file.filePath, file.id).catch(() => {
			// If ffprobe unavailable, keep the DB state we already set
		});

		return { success: true };
	}

	/**
	 * POST /subtitles/admin/cleanup-unused — admin maintenance. For every movie
	 * that has a default subtitle set, delete any OTHER downloaded (external)
	 * subtitle files — the leftover candidates from search-online testing.
	 * Embedded tracks and the chosen default are kept.
	 */
	@Roles('admin')
	@RequireAction('edit:app-settings')
	@Post('admin/cleanup-unused')
	async cleanupUnused(): Promise<{ moviesTouched: number; filesRemoved: number }> {
		const files = this.tracksRepo.getAllFilesWithSubtitles();
		let moviesTouched = 0;
		let filesRemoved = 0;

		for (const file of files) {
			const tracks = this.tracksRepo.parseTracks(file.subtitleTracks);
			const def = tracks.find((t) => t.default);
			if (!def) continue; // only movies the user has set a default on

			const defLang = def.language || '';
			const defExternal = def.external ?? false;
			// Every downloaded (external) track that isn't the default — including
			// same-language duplicates, which we can now delete precisely by their
			// own filename without touching the default.
			const toRemove = tracks.filter((t) => (t.external ?? false) && t.index !== def.index);
			if (toRemove.length === 0) continue;

			const dir = path.dirname(file.filePath);
			for (const t of toRemove) {
				if (t.fileName) {
					await this.unlinkQuietly(path.join(dir, t.fileName));
				} else if (!(defExternal && (t.language || '') === defLang)) {
					// Legacy row without a stored filename — fall back to the
					// language sweep, but never when it shares the default's language.
					await this.deleteExternalSidecars(file.filePath, t.language || 'en');
				}
			}

			// Rebuild tracks + VTT cache from what's left on disk, then re-apply
			// the default flag (matched by external-flag + language).
			await this.subtitleService.clearCache(file.id);
			let rebuilt: SubtitleTrackRow[] | null = null;
			try {
				rebuilt = (await this.subtitleService.extractSubtitles(
					file.filePath,
					file.id,
				)) as SubtitleTrackRow[];
			} catch {
				rebuilt = null;
			}

			if (rebuilt && rebuilt.length > 0) {
				const match =
					rebuilt.find(
						(t) =>
							(t.external ?? false) === defExternal && (t.language || '') === defLang,
					) ?? null;
				await this.tracksRepo.setTracks(
					file.id,
					rebuilt.map((t) => ({
						...t,
						default: match ? t.index === match.index : false,
					})),
				);
			} else {
				const removeIdx = new Set(toRemove.map((t) => t.index));
				const remaining = tracks
					.filter((t) => !removeIdx.has(t.index))
					.map((t, i) => ({ ...t, index: i }));
				await this.tracksRepo.setTracks(file.id, remaining);
			}

			moviesTouched++;
			filesRemoved += toRemove.length;
		}

		this.logger.log(
			`Subtitle cleanup: removed ${filesRemoved} unused file(s) across ${moviesTouched} movie(s)`,
		);
		return { moviesTouched, filesRemoved };
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
