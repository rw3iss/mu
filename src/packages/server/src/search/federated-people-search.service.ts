import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { PeopleService } from '../people/people.service.js';
import { mergePersonHit, personDedupKey, scorePerson } from './dedup.js';
import { SearchCacheService } from './search-cache.service.js';
import type { PersonSearchHit, SearchEvent, SearchSource } from './search-types.js';

const SOURCE_TIMEOUT_MS = 5000;

@Injectable()
export class FederatedPeopleSearchService {
	private readonly logger = new Logger('FederatedPeopleSearch');

	constructor(
		private readonly people: PeopleService,
		private readonly tmdb: TmdbProvider,
		private readonly cache: SearchCacheService,
	) {}

	search$(query: string): Observable<SearchEvent<PersonSearchHit>> {
		return new Observable((subscriber) => {
			const hits = new Map<string, PersonSearchHit>();
			const sourcesQueried: SearchSource[] = [];
			let cancelled = false;

			const emit = (source: SearchSource, items: PersonSearchHit[]) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				const merged: PersonSearchHit[] = [];
				for (const item of items) {
					const key = personDedupKey(item);
					const prev = hits.get(key);
					const next = prev ? mergePersonHit(prev, item) : item;
					hits.set(key, next);
					merged.push(next);
				}
				subscriber.next({ kind: 'results', source, items: merged });
			};

			const emitError = (source: SearchSource, message: string) => {
				if (cancelled) return;
				if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
				subscriber.next({ kind: 'error', source, message });
			};

			const withTimeout = <T>(p: Promise<T>, source: SearchSource): Promise<T | null> =>
				Promise.race([
					p,
					new Promise<T>((_, reject) =>
						setTimeout(
							() => reject(new Error(`${source} timed out after ${SOURCE_TIMEOUT_MS}ms`)),
							SOURCE_TIMEOUT_MS,
						),
					),
				]).catch((err) => {
					emitError(source, err instanceof Error ? err.message : String(err));
					return null;
				});

			(async () => {
				try {
					const local = await this.people.searchPeopleForFederation(query);
					if (local.length) {
						const scored = local.map((h) => ({ ...h, matchScore: scorePerson(query, h) }));
						emit('local', scored);
					}
				} catch (e: any) {
					emitError('local', e?.message ?? String(e));
				}

				const cached = this.cache.get<PersonSearchHit>('person', query, 'tmdb');
				if (cached) {
					emit('cache', cached);
				} else {
					const raw = await withTimeout(this.tmdb.searchPerson(query), 'tmdb');
					if (raw) {
						const items = raw.map((r: any) => {
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
											.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
									: undefined,
								sources: ['tmdb'],
								isOwned: false,
								matchScore: 0,
							};
							hit.matchScore = scorePerson(query, hit);
							return hit;
						});
						emit('tmdb', items);
						this.cache.set('person', query, 'tmdb', items);
					}
				}

				if (!cancelled) {
					subscriber.next({ kind: 'done', sourcesQueried });
					subscriber.complete();
				}
			})();

			return () => {
				cancelled = true;
			};
		});
	}
}
