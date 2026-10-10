import type {
	AlbumFilmLink,
	MbArtistPreview,
	MbReleaseGroupPreview,
	MusicDiscoverRequest,
	MusicDiscoverResponse,
	MusicDiscoverSeedSuggestion,
} from '@mu/shared';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { RequireFeature } from '../../features/require-feature.decorator.js';
import { AlbumFilmsService } from './album-films.service.js';
import { MbPreviewService } from './mb-preview.service.js';
import { MusicDiscoveryService } from './music-discovery.service.js';

/** Music discovery, MusicBrainz stub previews and album→film cross-links. 404 while Music is off. */
@RequireFeature('music')
@Controller('music')
export class MusicDiscoveryController {
	constructor(
		private readonly discovery: MusicDiscoveryService,
		private readonly previews: MbPreviewService,
		private readonly films: AlbumFilmsService,
	) {}

	@RequireAction('view:library')
	@Post('discover')
	@HttpCode(200)
	discover(@Body() body: MusicDiscoverRequest): Promise<MusicDiscoverResponse> {
		return this.discovery.discover(body ?? { seeds: [] });
	}

	@RequireAction('view:library')
	@Get('discover/seeds')
	seeds(@CurrentUser('id') userId: string | undefined): MusicDiscoverSeedSuggestion[] {
		return userId ? this.discovery.seedSuggestions(userId) : [];
	}

	@RequireAction('view:library')
	@Get('mb/release-group/:mbid')
	releaseGroup(@Param('mbid') mbid: string): Promise<MbReleaseGroupPreview> {
		return this.previews.releaseGroup(mbid);
	}

	@RequireAction('view:library')
	@Get('mb/artist/:mbid')
	artist(@Param('mbid') mbid: string): Promise<MbArtistPreview> {
		return this.previews.artist(mbid);
	}

	@RequireAction('view:library')
	@Get('albums/:id/films')
	albumFilms(@Param('id') id: string): AlbumFilmLink[] {
		return this.films.filmsForAlbum(id);
	}
}
