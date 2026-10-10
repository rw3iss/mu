import type { MovieSearchHit, MusicSearchHit, PersonSearchHit } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import type { FederatedSearchSource } from './federated-search.orchestrator.js';

export interface SearchDomainHits {
	movie: MovieSearchHit;
	person: PersonSearchHit;
	music: MusicSearchHit;
}
export type SearchDomain = keyof SearchDomainHits;

/**
 * Capability list of federated search sources per domain. Each federated
 * search service registers its built-in sources here on construction; any
 * other module (or plugin) can `register()` an extra source and it joins the
 * stream with the same timeout / cache / dedup handling — no orchestrator edit.
 */
@Injectable()
export class SearchSourceRegistry {
	private readonly sources = new Map<SearchDomain, FederatedSearchSource<unknown>[]>();

	register<D extends SearchDomain>(
		domain: D,
		source: FederatedSearchSource<SearchDomainHits[D]>,
	): void {
		const list = this.sources.get(domain) ?? [];
		const idx = list.findIndex(
			(s) => s.id === source.id && s.cache?.type === source.cache?.type,
		);
		if (idx >= 0) list[idx] = source as FederatedSearchSource<unknown>;
		else list.push(source as FederatedSearchSource<unknown>);
		this.sources.set(domain, list);
	}

	list<D extends SearchDomain>(domain: D): FederatedSearchSource<SearchDomainHits[D]>[] {
		return (this.sources.get(domain) ?? []) as FederatedSearchSource<SearchDomainHits[D]>[];
	}
}
