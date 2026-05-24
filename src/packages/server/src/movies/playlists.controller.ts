import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
		@Body() body: { name: string; description?: string },
		@CurrentUser('id') userId: string,
	) {
		return this.playlistsService.create(userId, body.name, body.description);
	}

	@RequireAction('view:own-data')
	@Get('by-movie/:movieId')
	findByMovie(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return this.playlistsService.findByMovie(userId, movieId);
	}

	@RequireAction('view:own-data')
	@Get(':id')
	findById(@Param('id') id: string) {
		return this.playlistsService.findById(id);
	}

	@RequireAction('view:own-data')
	@Patch(':id')
	update(
		@Param('id') id: string,
		@Body() body: { name?: string; description?: string; coverUrl?: string },
	) {
		return this.playlistsService.update(id, body);
	}

	@RequireAction('view:own-data')
	@Delete(':id')
	remove(@Param('id') id: string) {
		this.playlistsService.remove(id);
		return { success: true };
	}

	@RequireAction('view:own-data')
	@Post(':id/movies')
	addMovie(
		@Param('id') playlistId: string,
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
		this.playlistsService.addMovie(playlistId, body.movieId, remoteInfo);
		return { success: true };
	}

	@RequireAction('view:own-data')
	@Delete(':id/movies/:movieId')
	removeMovie(@Param('id') playlistId: string, @Param('movieId') movieId: string) {
		this.playlistsService.removeMovie(playlistId, movieId);
		return { success: true };
	}
}
