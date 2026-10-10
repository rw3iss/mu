import type { AlbumMatchState, MusicAdminActionResult } from '@mu/shared';
import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { RequireFeature } from '../../features/require-feature.decorator.js';
import { MusicAdminService } from '../admin/music-admin.service.js';
import { MusicJobsService } from '../jobs/music-jobs.service.js';
import { MusicQueryService } from '../library/music-query.service.js';
import { MusicMetadataService } from '../metadata/music-metadata.service.js';
import { MusicSettingsService } from '../music-settings.service.js';

/**
 * Music metadata (album matching, lyrics fetch) and admin quick actions.
 * Separate from MusicController to keep browse/playback routes small.
 */
@RequireFeature('music')
@Controller('music')
export class MusicMetadataController {
	constructor(
		private readonly metadata: MusicMetadataService,
		private readonly musicJobs: MusicJobsService,
		private readonly admin: MusicAdminService,
		private readonly query: MusicQueryService,
		private readonly musicSettings: MusicSettingsService,
	) {}

	/**
	 * Stored match state + candidates. `?refresh=1` runs a live MusicBrainz
	 * search first (optionally with `title` / `artist` overrides); a live
	 * search never auto-applies.
	 */
	@RequireAction('view:library')
	@Get('albums/:id/match-candidates')
	async matchCandidates(
		@Param('id') id: string,
		@Query('refresh') refresh: string | undefined,
		@Query('title') title: string | undefined,
		@Query('artist') artist: string | undefined,
	): Promise<AlbumMatchState> {
		if (refresh === '1' || refresh === 'true' || title || artist) {
			return this.metadata.searchCandidates(id, {
				title: title?.slice(0, 300),
				artist: artist?.slice(0, 300),
			});
		}
		return this.metadata.matchState(id);
	}

	/** Apply a chosen release (exact) or release group (best release picked). */
	@RequireAction('edit:media')
	@Post('albums/:id/match')
	async match(
		@Param('id') id: string,
		@Body() body: { releaseGroupMbid?: string; releaseMbid?: string },
	): Promise<AlbumMatchState> {
		const releaseMbid = mbid(body?.releaseMbid);
		const releaseGroupMbid = mbid(body?.releaseGroupMbid);
		if (!releaseMbid && !releaseGroupMbid) {
			throw new BadRequestException('releaseMbid or releaseGroupMbid (UUID) is required');
		}
		const state = await this.metadata.applyManualMatch(id, { releaseMbid, releaseGroupMbid });
		// Art + artist info for the new match run in the background.
		this.musicJobs.enqueueMetadata(id, this.metadata.albumTitle(id));
		return state;
	}

	/** Re-run the full metadata pass for one album (forced). */
	@RequireAction('edit:media')
	@Post('albums/:id/refresh-metadata')
	refreshMetadata(@Param('id') id: string): { started: boolean } {
		this.musicJobs.enqueueMetadata(id, this.metadata.albumTitle(id), { force: true });
		return { started: true };
	}

	/** Fetch lyrics from LRCLIB now (replaces fetched lyrics; never user-edited ones). */
	@RequireAction('edit:lyrics')
	@Post('tracks/:id/lyrics/fetch')
	async fetchLyrics(@Param('id') id: string) {
		if (!this.musicSettings.get().fetchLyrics) {
			throw new BadRequestException('Lyrics fetching is turned off in Music settings');
		}
		const result = await this.metadata.fetchLyrics(id, { force: true });
		return { result, lyrics: this.query.getLyrics(id) };
	}

	// ── Admin quick actions ───────────────────────────────────────────────

	@RequireAction('admin:server')
	@Post('admin/scan')
	scan(): MusicAdminActionResult {
		return this.admin.scanLibrary();
	}

	/** `?scope=all` re-runs every album (forced); default only unmatched albums. */
	@RequireAction('admin:server')
	@Post('admin/refresh-metadata')
	refreshAll(@Query('scope') scope: string | undefined): MusicAdminActionResult {
		return this.admin.refreshMetadata(scope === 'all' ? 'all' : 'unmatched');
	}

	@RequireAction('admin:server')
	@Post('admin/fetch-art')
	fetchArt(): MusicAdminActionResult {
		return this.admin.fetchMissingArt();
	}

	@RequireAction('admin:server')
	@Post('admin/fetch-lyrics')
	fetchAllLyrics(): MusicAdminActionResult {
		return this.admin.fetchMissingLyrics();
	}

	@RequireAction('admin:server')
	@Post('admin/reencode-unplayable')
	reencode(): MusicAdminActionResult {
		return this.admin.reencodeUnplayable();
	}

	@RequireAction('admin:server')
	@Post('admin/clear-cache')
	clearCache(): Promise<MusicAdminActionResult> {
		return this.admin.clearTranscodeCache();
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mbid(v: unknown): string | undefined {
	return typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : undefined;
}
