import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import type { MovieListQuery } from '@mu/shared';
import { MoviesService } from './movies.service.js';
import { RatingsService } from './ratings.service.js';
import { HistoryService } from './history.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('movies')
export class MoviesController {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly ratingsService: RatingsService,
    private readonly historyService: HistoryService,
  ) {}

  @Get()
  findAll(@Query() query: MovieListQuery) {
    return this.moviesService.findAll(query);
  }

  @Get('search')
  search(@Query('q') q: string) {
    const movies = this.moviesService.search(q ?? '');
    return { movies, total: movies.length, page: 1, pageSize: movies.length };
  }

  @Get('recent')
  findRecent(@Query('limit') limit?: string) {
    const movies = this.moviesService.findRecent(limit ? parseInt(limit, 10) : 20);
    return { movies, total: movies.length, page: 1, pageSize: movies.length };
  }

  @Get('genres')
  getGenres() {
    return this.moviesService.getGenres();
  }

  @Get('continue-watching')
  getContinueWatching(@CurrentUser('id') userId: string) {
    const movies = this.historyService.getContinueWatching(userId);
    return { movies, total: movies.length, page: 1, pageSize: movies.length };
  }

  @Get('trending')
  getTrending(@Query('limit') limit?: string) {
    const movies = this.moviesService.findRecent(limit ? parseInt(limit, 10) : 20);
    return { movies, total: movies.length, page: 1, pageSize: movies.length };
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.moviesService.findById(id, userId);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.moviesService.update(id, body as any);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    this.moviesService.remove(id);
    return { success: true };
  }

  @Post(':id/rate')
  rate(
    @Param('id') movieId: string,
    @Body() body: { rating: number },
    @CurrentUser('id') userId: string,
  ) {
    return this.ratingsService.rate(userId, movieId, body.rating);
  }

  @Delete(':id/rate')
  removeRating(
    @Param('id') movieId: string,
    @CurrentUser('id') userId: string,
  ) {
    this.ratingsService.removeRating(userId, movieId);
    return { success: true };
  }

  @Post(':id/watched')
  markWatched(
    @Param('id') movieId: string,
    @CurrentUser('id') userId: string,
  ) {
    this.historyService.markWatched(userId, movieId);
    return { success: true };
  }

  @Delete(':id/watched')
  markUnwatched(
    @Param('id') movieId: string,
    @CurrentUser('id') userId: string,
  ) {
    this.historyService.markUnwatched(userId, movieId);
    return { success: true };
  }

  @Post('bulk')
  bulkAction(
    @Body() body: { action: string; movieIds: string[]; playlistId?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.moviesService.bulkAction(body.action, body.movieIds, userId, {
      playlistId: body.playlistId,
    });
  }
}
