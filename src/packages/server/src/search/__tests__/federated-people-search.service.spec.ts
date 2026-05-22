import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { FederatedPeopleSearchService } from '../federated-people-search.service.js';
import type { PersonSearchHit, SearchEvent } from '../search-types.js';

async function collect(
	svc: FederatedPeopleSearchService,
	q: string,
): Promise<SearchEvent<PersonSearchHit>[]> {
	return (await lastValueFrom(svc.search$(q).pipe(toArray()))) as SearchEvent<PersonSearchHit>[];
}

describe('FederatedPeopleSearchService', () => {
	let people: any;
	let tmdb: any;
	let cache: any;
	let svc: FederatedPeopleSearchService;

	beforeEach(() => {
		people = { searchPeopleForFederation: vi.fn().mockResolvedValue([]) };
		tmdb = { searchPerson: vi.fn().mockResolvedValue([]) };
		cache = { get: vi.fn().mockReturnValue(null), set: vi.fn() };
		svc = new FederatedPeopleSearchService(people, tmdb, cache);
	});

	it('emits local first then tmdb then done', async () => {
		people.searchPeopleForFederation.mockResolvedValue([
			{
				personKey: 'tmdb:1',
				tmdbId: 1,
				name: 'Alice',
				isOwned: true,
				sources: ['local'],
				matchScore: 0,
			},
		]);
		tmdb.searchPerson.mockResolvedValue([{ id: 2, name: 'Bob', profile_path: '/x.jpg' }]);
		const evs = await collect(svc, 'alice');
		const ordered = evs.map((e) => (e.kind === 'results' ? e.source : e.kind));
		expect(ordered[0]).toBe('local');
		expect(ordered).toContain('tmdb');
		expect(ordered[ordered.length - 1]).toBe('done');
	});

	it('uses cached tmdb when present', async () => {
		cache.get.mockReturnValue([
			{
				personKey: 'tmdb:2',
				tmdbId: 2,
				name: 'Bob',
				sources: ['tmdb'],
				isOwned: false,
				matchScore: 0.6,
			},
		]);
		await collect(svc, 'bob');
		expect(tmdb.searchPerson).not.toHaveBeenCalled();
		expect(cache.set).not.toHaveBeenCalled();
	});

	it('continues when tmdb errors', async () => {
		tmdb.searchPerson.mockRejectedValue(new Error('rate limited'));
		const evs = await collect(svc, 'cleese');
		const errored = evs.find((e) => e.kind === 'error');
		const done = evs.find((e) => e.kind === 'done');
		expect(errored).toBeTruthy();
		expect(done).toBeTruthy();
	});

	it('normalizes tmdb person results with profile URL', async () => {
		tmdb.searchPerson.mockResolvedValue([
			{ id: 5, name: 'John Cleese', profile_path: '/john.jpg', known_for_department: 'Acting' },
		]);
		const evs = await collect(svc, 'cleese');
		const tmdbEvent = evs.find(
			(e) => e.kind === 'results' && e.source === 'tmdb',
		) as any;
		expect(tmdbEvent.items[0]).toMatchObject({
			personKey: 'tmdb:5',
			tmdbId: 5,
			name: 'John Cleese',
			profileUrl: 'https://image.tmdb.org/t/p/w185/john.jpg',
			role: 'Acting',
			sources: ['tmdb'],
		});
	});
});
