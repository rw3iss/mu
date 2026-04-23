import type { MovieListQuery } from '@mu/shared';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { RemoteService } from '../remote/remote.service.js';
import { HistoryService } from './history.service.js';
import { MoviesService } from './movies.service.js';
import { RatingsService } from './ratings.service.js';

@Controller('movies')
export class MoviesController {
	constructor(
		private readonly moviesService: MoviesService,
		private readonly ratingsService: RatingsService,
		private readonly historyService: HistoryService,
		private readonly remoteService: RemoteService,
		private readonly metadataService: MetadataService,
	) {}

	@Get()
	async findAll(@Query() query: MovieListQuery, @CurrentUser('id') userId: string) {
		const serverFilter = query.server;

		// If filtering to a specific remote server only, skip local
		if (serverFilter && serverFilter !== 'local' && serverFilter !== 'all') {
			try {
				const remote = await this.remoteService.fetchAllRemoteMovies({
					...this.queryToParams(query),
					// Only from this server
				});
				const filtered = remote.movies.filter(
					(m: any) => m.remoteOrigin?.serverId === serverFilter,
				);
				return {
					movies: filtered,
					total: filtered.length,
					hiddenCount: 0,
					page: 1,
					pageSize: filtered.length,
					totalPages: 1,
					remoteServers: remote.servers,
				};
			} catch {
				return {
					movies: [],
					total: 0,
					hiddenCount: 0,
					page: 1,
					pageSize: 40,
					totalPages: 0,
				};
			}
		}

		const local = this.moviesService.findAll(query, userId);

		// If 'local' filter or no remote servers configured, return local only
		if (serverFilter === 'local') {
			return { ...local, remoteServers: [] };
		}

		// Try to include remote movies (non-blocking)
		const enabledServers = this.remoteService.getEnabledServers();
		if (enabledServers.length === 0) {
			return { ...local, remoteServers: [] };
		}

		try {
			const remote = await this.remoteService.fetchAllRemoteMovies(this.queryToParams(query));

			// Merge and re-sort
			const merged = [...local.movies, ...remote.movies];
			this.sortMovies(merged, query.sortBy, query.sortOrder);

			return {
				movies: merged,
				total: local.total + remote.total,
				hiddenCount: local.hiddenCount,
				page: local.page,
				pageSize: local.pageSize,
				totalPages: Math.ceil((local.total + remote.total) / local.pageSize),
				remoteServers: remote.servers,
			};
		} catch {
			// If remote fetch fails, still return local results
			return { ...local, remoteServers: [] };
		}
	}

	private queryToParams(query: MovieListQuery): Record<string, string> {
		const params: Record<string, string> = {};
		if (query.search) params.search = query.search;
		if (query.genre) params.genre = query.genre;
		if (query.sortBy) params.sortBy = query.sortBy;
		if (query.sortOrder) params.sortOrder = query.sortOrder;
		if (query.page) params.page = String(query.page);
		if (query.pageSize) params.pageSize = String(query.pageSize);
		return params;
	}

	private sortMovies(movies: any[], sortBy?: string, sortOrder?: string): void {
		const dir = sortOrder === 'asc' ? 1 : -1;
		movies.sort((a, b) => {
			let va: any;
			let vb: any;
			switch (sortBy) {
				case 'title':
					va = a.title?.toLowerCase() ?? '';
					vb = b.title?.toLowerCase() ?? '';
					return va < vb ? -dir : va > vb ? dir : 0;
				case 'year':
					return ((a.year ?? 0) - (b.year ?? 0)) * dir;
				case 'rating':
					return ((a.rating ?? 0) - (b.rating ?? 0)) * dir;
				case 'runtime':
					return (
						((a.runtime ?? a.runtimeMinutes ?? 0) -
							(b.runtime ?? b.runtimeMinutes ?? 0)) *
						dir
					);
				default:
					// addedAt (desc by default)
					va = a.addedAt ?? '';
					vb = b.addedAt ?? '';
					return va < vb ? -dir : va > vb ? dir : 0;
			}
		});
	}

	@Get('search')
	search(@Query('q') q: string, @CurrentUser('id') userId: string) {
		const results = this.moviesService.search(q ?? '', userId);
		return { movies: results, total: results.length, page: 1, pageSize: results.length };
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

	@Post(':id/delete-files')
	@Roles('admin')
	async deleteFromDisk(
		@Param('id') id: string,
		@Body() body: { deleteEnclosingFolder?: boolean },
	) {
		await this.moviesService.deleteFromDisk(id, body.deleteEnclosingFolder ?? false);
		return { success: true };
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
	removeRating(@Param('id') movieId: string, @CurrentUser('id') userId: string) {
		this.ratingsService.removeRating(userId, movieId);
		return { success: true };
	}

	@Post(':id/watched')
	markWatched(@Param('id') movieId: string, @CurrentUser('id') userId: string) {
		this.historyService.markWatched(userId, movieId);
		this.moviesService.invalidateListCache();
		return { success: true };
	}

	@Delete(':id/watched')
	markUnwatched(@Param('id') movieId: string, @CurrentUser('id') userId: string) {
		this.historyService.markUnwatched(userId, movieId);
		this.moviesService.invalidateListCache();
		return { success: true };
	}

	@Post('bulk')
	@Roles('admin')
	async bulkAction(
		@Body()
		body: {
			action: string;
			movieIds: string[];
			options?: { deleteEnclosingFolder?: boolean };
		},
		@CurrentUser('id') userId: string,
	) {
		const { action, movieIds, options } = body;
		const results: { movieId: string; success: boolean; error?: string }[] = [];

		for (const movieId of movieIds) {
			try {
				switch (action) {
					case 'rescan':
						await this.metadataService.rescanMovie(movieId);
						break;
					case 'refresh_metadata':
						await this.metadataService.refreshMetadata(movieId);
						break;
					case 'clear_metadata':
						await this.metadataService.clearMetadata(movieId);
						break;
					case 'hide':
						await this.moviesService.update(movieId, { hidden: true });
						break;
					case 'unhide':
						await this.moviesService.update(movieId, { hidden: false });
						break;
					case 'mark_watched':
						this.historyService.markWatched(userId, movieId);
						break;
					case 'mark_unwatched':
						this.historyService.markUnwatched(userId, movieId);
						break;
					case 'remove':
						this.moviesService.remove(movieId);
						break;
					case 'delete_from_disk':
						await this.moviesService.deleteFromDisk(
							movieId,
							options?.deleteEnclosingFolder ?? false,
						);
						break;
					default:
						throw new Error(`Unknown bulk action: ${action}`);
				}
				results.push({ movieId, success: true });
			} catch (err: any) {
				results.push({ movieId, success: false, error: err?.message ?? 'Unknown error' });
			}
		}

		this.moviesService.invalidateListCache();

		const processed = results.filter((r) => r.success).length;
		const errors = results.filter((r) => !r.success);
		return { processed, total: movieIds.length, errors, results };
	}
}
