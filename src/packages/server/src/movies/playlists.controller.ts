import {
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
	) {
		return this.playlistsService.findAll(userId, {
			includeMovies: includeMovies === 'true',
			sortBy: sortBy as any,
			sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
		});
	}

	@RequireAction('view:own-data')
	@Post()
	create(
		@Body()
		body: { name: string; description?: string; isPublic?: boolean; publicEdit?: boolean },
		@CurrentUser('id') userId: string,
	) {
		return this.playlistsService.create(userId, body.name, body.description, {
			isPublic: body.isPublic,
			publicEdit: body.publicEdit,
		});
	}

	@RequireAction('view:own-data')
	@Get('by-movie/:movieId')
	findByMovie(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return this.playlistsService.findByMovie(userId, movieId);
	}

	/** Public playlists across all users (read-only). */
	@RequireAction('view:own-data')
	@Get('public')
	findPublic(@Query('includeMovies') includeMovies?: string) {
		return this.playlistsService.findPublic({ includeMovies: includeMovies === 'true' });
	}

	@RequireAction('view:own-data')
	@Get(':id')
	findById(
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
		return playlist;
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
}
