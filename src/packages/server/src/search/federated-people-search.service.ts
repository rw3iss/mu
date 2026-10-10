import { Injectable, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { PeopleService } from '../people/people.service.js';
import { TraktSearchProvider } from '../providers/sources/trakt/trakt-search.provider.js';
import { mergePersonHit, personDedupKey, scorePerson } from './dedup.js';
import { type FederatedSearchSource, runFederatedSearch } from './federated-search.orchestrator.js';
import { SearchCacheService } from './search-cache.service.js';
import { SearchSourceRegistry } from './search-source.registry.js';
import type { PersonSearchHit, SearchEvent } from './search-types.js';

/** Federated people search — sources declared below, run by the shared orchestrator. */
@Injectable()
export class FederatedPeopleSearchService {
	private readonly registry: SearchSourceRegistry;

	constructor(
		private readonly people: PeopleService,
		private readonly tmdb: TmdbProvider,
		private readonly cache: SearchCacheService,
		private readonly trakt: TraktSearchProvider,
		@Optional() registry?: SearchSourceRegistry,
	) {
		this.registry = registry ?? new SearchSourceRegistry();
		for (const src of this.builtinSources()) this.registry.register('person', src);
	}

	search$(query: string): Observable<SearchEvent<PersonSearchHit>> {
		return runFederatedSearch(query, {}, this.registry.list('person'), {
			dedupKeys: (h) => [personDedupKey(h)],
			merge: mergePersonHit,
			cache: this.cache,
		});
	}

	private builtinSources(): FederatedSearchSource<PersonSearchHit>[] {
		return [
			{
				id: 'local',
				phase: 'local',
				run: async (query) =>
					(await this.people.searchPeopleForFederation(query)).map((h) => ({
						...h,
						matchScore: scorePerson(query, h),
					})),
			},
			{
				id: 'tmdb',
				phase: 'external',
				cache: { type: 'person', source: 'tmdb' },
				keepEmpty: true,
				run: async (query) =>
					(await this.tmdb.searchPerson(query))?.map((r: any) => {
						const hit: PersonSearchHit = {
							personKey: `tmdb:${r.id}`,
							tmdbId: r.id,
							name: r.name,
							profileUrl: r.profile_path
								? `https://image.tmdb.org/t/p/w185${r.profile_path}`
								: undefined,
							role: r.known_for_department,
							knownFor: Array.isArray(r.known_for)
								? r.known_for
										.map((k: any) => k.title || k.name)
										.filter(
											(x: unknown): x is string =>
												typeof x === 'string' && x.length > 0,
										)
								: undefined,
							sources: ['tmdb'],
							isOwned: false,
							matchScore: 0,
						};
						hit.matchScore = scorePerson(query, hit);
						return hit;
					}),
			},
			{
				id: 'trakt',
				phase: 'external',
				cache: { type: 'person', source: 'trakt' },
				run: async (query) =>
					((await this.trakt.searchPeople(query)) ?? []).map((r) => {
						const personKey = r.tmdbId
							? `tmdb:${r.tmdbId}`
							: r.traktId
								? `trakt:${r.traktId}`
								: `name:${r.name.toLowerCase().replace(/\s+/g, '-')}`;
						const hit: PersonSearchHit = {
							personKey,
							tmdbId: r.tmdbId,
							traktId: r.traktId,
							name: r.name,
							sources: ['trakt'],
							isOwned: false,
							matchScore: 0,
						};
						hit.matchScore = scorePerson(query, hit);
						return hit;
					}),
			},
		];
	}
}
