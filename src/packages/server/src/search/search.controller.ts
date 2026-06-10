import { BadRequestException, Controller, Get, Logger, Query, Req, Sse } from '@nestjs/common';
import { lastValueFrom, map, type Observable, toArray } from 'rxjs';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { FederatedMovieSearchService } from './federated-movie-search.service.js';
import { FederatedPeopleSearchService } from './federated-people-search.service.js';
import type { SearchEvent } from './search-types.js';

@Controller('search')
export class SearchController {
	private readonly logger = new Logger('SearchController');

	constructor(
		private readonly movies: FederatedMovieSearchService,
		private readonly people: FederatedPeopleSearchService,
	) {}

	private requireQuery(q: string | undefined): string {
		if (!q || q.trim().length < 2) {
			throw new BadRequestException('Query must be at least 2 characters');
		}
		return q.trim();
	}

	@RequireAction('view:library')
	@Sse('movies/stream')
	streamMovies(@Query('q') q: string, @Req() req: any): Observable<MessageEvent> {
		const query = this.requireQuery(q);
		const userId = req.user?.sub ?? req.user?.id ?? 'anonymous';
		return this.movies
			.search$(query, userId)
			.pipe(map((ev) => ({ data: ev }) as unknown as MessageEvent));
	}

	@RequireAction('view:library')
	@Sse('people/stream')
	streamPeople(@Query('q') q: string): Observable<MessageEvent> {
		const query = this.requireQuery(q);
		return this.people
			.search$(query)
			.pipe(map((ev) => ({ data: ev }) as unknown as MessageEvent));
	}

	@RequireAction('view:library')
	@Get('movies')
	async listMovies(@Query('q') q: string, @Req() req: any) {
		const query = this.requireQuery(q);
		const userId = req.user?.sub ?? req.user?.id ?? 'anonymous';
		const events = await lastValueFrom(this.movies.search$(query, userId).pipe(toArray()));
		return this.flatten(events);
	}

	@RequireAction('view:library')
	@Get('people')
	async listPeople(@Query('q') q: string) {
		const query = this.requireQuery(q);
		const events = await lastValueFrom(this.people.search$(query).pipe(toArray()));
		return this.flatten(events);
	}

	private flatten<T>(events: SearchEvent<T>[]) {
		const byIdx = new Map<string, T>();
		const sources: string[] = [];
		const errors: Array<{ source: string; message: string }> = [];
		for (const ev of events) {
			if (ev.kind === 'results') {
				for (const item of ev.items) {
					const id = JSON.stringify(item);
					byIdx.set(id, item);
				}
				if (!sources.includes(ev.source)) sources.push(ev.source);
			} else if (ev.kind === 'error') {
				errors.push({ source: ev.source, message: ev.message });
			}
		}
		return { items: Array.from(byIdx.values()), sources, errors };
	}
}
