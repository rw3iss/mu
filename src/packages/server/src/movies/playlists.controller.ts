import { isEntityType, type MediaKind } from '@mu/shared';
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { PlaylistsService } from './playlists.service.js';

@Controller('playlists')
export class PlaylistsController {
	constructor(private readonly playlistsService: PlaylistsService) {}

	@RequireAction('view:own-data')
	@Get()
	findAll(
		@CurrentUser('id') userId: string,
		@Query('includeMovies') includeMovies?: string,
		@Query('sortBy') sortBy?: string,
		@Query('sortOrder') sortOrder?: string,
		@Query('kind') kind?: string,
	) {
		return this.playlistsService.findAll(userId, {
			includeMovies: includeMovies === 'true',
			sortBy: sortBy as any,
			sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
			kind: asKind(kind),
		});
	}

	@RequireAction('view:own-data')
	@Post()
	create(
		@Body()
		body: {
			name: string;
			description?: string;
			isPublic?: boolean;
			publicEdit?: boolean;
			kind?: string;
		},
		@CurrentUser('id') userId: string,
	) {
		return this.playlistsService.create(userId, body.name, body.description, {
			isPublic: body.isPublic,
			publicEdit: body.publicEdit,
			kind: asKind(body.kind),
		});
	}

	@RequireAction('view:own-data')
	@Get('by-movie/:movieId')
	findByMovie(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return this.playlistsService.findByMovie(userId, movieId);
	}

	@RequireAction('view:own-data')
	@Get('by-item/:itemType/:itemId')
	findByItem(
		@Param('itemType') itemType: string,
		@Param('itemId') itemId: string,
		@CurrentUser('id') userId: string,
	) {
		if (!isEntityType(itemType)) throw new BadRequestException('Unknown item type');
		return this.playlistsService.findByItem(userId, { type: itemType, id: itemId });
	}

	/** Public playlists across all users (read-only). */
	@RequireAction('view:own-data')
	@Get('public')
	findPublic(@Query('includeMovies') includeMovies?: string, @Query('kind') kind?: string) {
		return this.playlistsService.findPublic({
			includeMovies: includeMovies === 'true',
			kind: asKind(kind),
		});
	}

	@RequireAction('view:own-data')
	@Get(':id')
	async findById(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@CurrentUser('role') role: string,
	) {
		const playlist = this.playlistsService.findById(id) as any;
		// Private playlists are only visible to their owner (and admins).
		// 404 rather than 403 so non-owners can't probe which ids exist.
		if (!playlist.isPublic && playlist.userId !== userId && role !== 'admin') {
			throw new NotFoundException(`Playlist ${id} not found`);
		}
		return this.playlistsService.withTrackCards(playlist, userId);
	}

	@RequireAction('view:own-data')
	@Patch(':id')
	update(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body()
		body: {
			name?: string;
			description?: string;
			coverUrl?: string;
			isPublic?: boolean;
			publicEdit?: boolean;
		},
	) {
		return this.playlistsService.update(id, userId, body);
	}

	@RequireAction('view:own-data')
	@Delete(':id')
	remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
		this.playlistsService.remove(id, userId);
		return { success: true };
	}

	@RequireAction('view:own-data')
	@Post(':id/movies')
	addMovie(
		@Param('id') playlistId: string,
		@CurrentUser('id') userId: string,
		@Body()
		body: {
			movieId: string;
			remoteTitle?: string;
			remotePosterUrl?: string;
			remoteServerId?: string;
		},
	) {
		const remoteInfo = body.remoteServerId
			? {
					title: body.remoteTitle ?? 'Unknown',
					posterUrl: body.remotePosterUrl,
					serverId: body.remoteServerId,
				}
			: undefined;
		this.playlistsService.addMovie(playlistId, body.movieId, remoteInfo, userId);
		return { success: true };
	}

	@RequireAction('view:own-data')
	@Delete(':id/movies/:movieId')
	removeMovie(
		@Param('id') playlistId: string,
		@Param('movieId') movieId: string,
		@CurrentUser('id') userId: string,
	) {
		this.playlistsService.removeMovie(playlistId, movieId, userId);
		return { success: true };
	}

	/** Add any entity (movie or track) to a playlist of the matching kind. */
	@RequireAction('view:own-data')
	@Post(':id/items')
	async addItem(
		@Param('id') playlistId: string,
		@CurrentUser('id') userId: string,
		@Body() body: { itemType: string; itemId: string },
	) {
		if (!isEntityType(body?.itemType) || !body.itemId) {
			throw new BadRequestException('itemType and itemId are required');
		}
		await this.playlistsService.addItem(
			playlistId,
			{ type: body.itemType, id: body.itemId },
			userId,
		);
		return { success: true };
	}

	@RequireAction('view:own-data')
	@Delete(':id/items/:itemType/:itemId')
	removeItem(
		@Param('id') playlistId: string,
		@Param('itemType') itemType: string,
		@Param('itemId') itemId: string,
		@CurrentUser('id') userId: string,
	) {
		if (!isEntityType(itemType)) throw new BadRequestException('Unknown item type');
		this.playlistsService.removeItem(playlistId, { type: itemType, id: itemId }, userId);
		return { success: true };
	}
}

function asKind(v: string | undefined): MediaKind | undefined {
	return v === 'audio' || v === 'video' ? v : undefined;
}
