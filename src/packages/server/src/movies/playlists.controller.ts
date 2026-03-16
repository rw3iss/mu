import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PlaylistsService } from './playlists.service.js';

@Controller('playlists')
export class PlaylistsController {
	constructor(private readonly playlistsService: PlaylistsService) {}

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

	@Post()
	create(
		@Body() body: { name: string; description?: string },
		@CurrentUser('id') userId: string,
	) {
		return this.playlistsService.create(userId, body.name, body.description);
	}

	@Get('by-movie/:movieId')
	findByMovie(@Param('movieId') movieId: string, @CurrentUser('id') userId: string) {
		return this.playlistsService.findByMovie(userId, movieId);
	}

	@Get(':id')
	findById(@Param('id') id: string) {
		return this.playlistsService.findById(id);
	}

	@Patch(':id')
	update(
		@Param('id') id: string,
		@Body() body: { name?: string; description?: string; coverUrl?: string },
	) {
		return this.playlistsService.update(id, body);
	}

	@Delete(':id')
	remove(@Param('id') id: string) {
		this.playlistsService.remove(id);
		return { success: true };
	}

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

	@Delete(':id/movies/:movieId')
	removeMovie(@Param('id') playlistId: string, @Param('movieId') movieId: string) {
		this.playlistsService.removeMovie(playlistId, movieId);
		return { success: true };
	}
}
