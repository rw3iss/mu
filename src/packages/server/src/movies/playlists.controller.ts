import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { PlaylistsService } from './playlists.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Get()
  findAll(@CurrentUser('id') userId: string) {
    return this.playlistsService.findAll(userId);
  }

  @Post()
  create(
    @Body() body: { name: string; description?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.playlistsService.create(userId, body.name, body.description);
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
    @Body() body: { movieId: string },
  ) {
    this.playlistsService.addMovie(playlistId, body.movieId);
    return { success: true };
  }

  @Delete(':id/movies/:movieId')
  removeMovie(
    @Param('id') playlistId: string,
    @Param('movieId') movieId: string,
  ) {
    this.playlistsService.removeMovie(playlistId, movieId);
    return { success: true };
  }
}
