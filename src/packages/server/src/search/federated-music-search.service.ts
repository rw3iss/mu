import type { AlbumSummary, ArtistSummary, TrackSummary } from '@mu/shared';
import { Injectable, Optional } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { Observable } from 'rxjs';
import { DatabaseService } from '../database/database.service.js';
import { albums, artists, tracks } from '../database/schema/index.js';
import { MusicQueryService } from '../music/library/music-query.service.js';
import { ProviderCredentialsService } from '../providers/provider-credentials.service.js';
import { MusicBrainzClient } from '../providers/sources/musicbrainz/musicbrainz.client.js';
import { mergeMusicHit, musicDedupKeys, scoreMusic } from './dedup.js';
import { type FederatedSearchSource, runFederatedSearch } from './federated-search.orchestrator.js';
import { SearchCacheService } from './search-cache.service.js';
import { SearchSourceRegistry } from './search-source.registry.js';
import type { MusicSearchHit, SearchEvent } from './search-types.js';
import {
	mbSearchArtists,
	mbSearchRecordings,
	mbSearchReleaseGroups,
} from './sources/musicbrainz-search.js';
import { discogsSearch, lastfmSearch } from './sources/optional-music-search.js';

const LOCAL_LIMIT = 8;

/**
 * Federated music search (artists / albums / tracks). Local FTS5 first (never
 * cached), then MusicBrainz artist / release-group / recording searches — three
 * sources sharing the app-wide MB 1 req/s throttle, each cached 7d under its own
 * `search_cache` type — plus Last.fm / Discogs when credentialed.
 */
@Injectable()
export class FederatedMusicSearchService {
	private readonly registry: SearchSourceRegistry;

	constructor(
		private readonly music: MusicQueryService,
		private readonly database: DatabaseService,
		private readonly mb: MusicBrainzClient,
		private readonly cache: SearchCacheService,
		private readonly credentials: ProviderCredentialsService,
		@Optional() registry?: SearchSourceRegistry,
	) {
		this.registry = registry ?? new SearchSourceRegistry();
		for (const src of this.builtinSources()) this.registry.register('music', src);
	}

	search$(query: string, userId?: string): Observable<SearchEvent<MusicSearchHit>> {
		return runFederatedSearch(query, { userId }, this.registry.list('music'), {
			dedupKeys: musicDedupKeys,
			merge: mergeMusicHit,
			cache: this.cache,
		});
	}

	private credential(provider: string, key: string): string | null {
		const v = this.credentials.getRaw(provider)?.[key];
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	}

	private builtinSources(): FederatedSearchSource<MusicSearchHit>[] {
		return [
			{ id: 'local', phase: 'local', run: (query) => this.localHits(query) },
			{
				id: 'musicbrainz',
				phase: 'external',
				cache: { type: 'artist', source: 'musicbrainz' },
				run: (query) => mbSearchArtists(this.mb, query),
			},
			{
				id: 'musicbrainz',
				phase: 'external',
				cache: { type: 'album', source: 'musicbrainz' },
				run: (query) => mbSearchReleaseGroups(this.mb, query),
			},
			{
				id: 'musicbrainz',
				phase: 'external',
				cache: { type: 'track', source: 'musicbrainz' },
				run: (query) => mbSearchRecordings(this.mb, query),
			},
			{
				id: 'lastfm',
				phase: 'external',
				// Grouped payload (all three kinds) cached under 'artist'.
				cache: { type: 'artist', source: 'lastfm' },
				enabled: () => !!this.credential('lastfm', 'apiKey'),
				run: (query) => lastfmSearch(this.credential('lastfm', 'apiKey') ?? '', query),
			},
			{
				id: 'discogs',
				phase: 'external',
				cache: { type: 'album', source: 'discogs' },
				enabled: () => !!this.credential('discogs', 'token'),
				run: (query) => discogsSearch(this.credential('discogs', 'token') ?? '', query),
			},
		];
	}

	/** Local FTS5 hits, annotated with MBIDs so they merge with MusicBrainz results. */
	localHits(query: string): MusicSearchHit[] {
		const r = this.music.search(query, LOCAL_LIMIT);
		const mbids = this.localMbids(r);
		const hits: MusicSearchHit[] = [
			...r.artists.map((a) => artistHit(a, mbids.artists.get(a.id))),
			...r.albums.map((a) => albumHit(a, mbids.albums.get(a.id))),
			...r.tracks.map((t) =>
				trackHit(t, mbids.tracks.get(t.id), mbids.albums.get(t.albumId)),
			),
		];
		for (const h of hits) h.matchScore = scoreMusic(query, h);
		return hits;
	}

	private localMbids(r: {
		artists: ArtistSummary[];
		albums: AlbumSummary[];
		tracks: TrackSummary[];
	}) {
		const db = this.database.db;
		const albumIds = [
			...new Set([...r.albums.map((a) => a.id), ...r.tracks.map((t) => t.albumId)]),
		];
		const map = <K extends string>(rows: { id: string; mbid: string | null }[]) =>
			new Map(rows.filter((x) => x.mbid).map((x) => [x.id, x.mbid as K]));
		return {
			artists: r.artists.length
				? map(
						db
							.select({ id: artists.id, mbid: artists.mbid })
							.from(artists)
							.where(
								inArray(
									artists.id,
									r.artists.map((a) => a.id),
								),
							)
							.all(),
					)
				: new Map<string, string>(),
			albums: albumIds.length
				? map(
						db
							.select({ id: albums.id, mbid: albums.mbidReleaseGroup })
							.from(albums)
							.where(inArray(albums.id, albumIds))
							.all(),
					)
				: new Map<string, string>(),
			tracks: r.tracks.length
				? map(
						db
							.select({ id: tracks.id, mbid: tracks.mbidRecording })
							.from(tracks)
							.where(
								inArray(
									tracks.id,
									r.tracks.map((t) => t.id),
								),
							)
							.all(),
					)
				: new Map<string, string>(),
		};
	}
}

function artistHit(a: ArtistSummary, mbid?: string): MusicSearchHit {
	return {
		kind: 'artist',
		localId: a.id,
		mbid,
		title: a.name,
		artUrl: a.imageUrl ?? undefined,
		detail: a.albumCount != null ? `${a.albumCount} albums` : undefined,
		sources: ['local'],
		isOwned: true,
		matchScore: 0,
	};
}

function albumHit(a: AlbumSummary, mbid?: string): MusicSearchHit {
	return {
		kind: 'album',
		localId: a.id,
		mbid,
		title: a.title,
		artist: a.artistCredit ?? undefined,
		year: a.year ?? undefined,
		artUrl: a.artUrl ?? undefined,
		primaryType: a.primaryType ?? undefined,
		sources: ['local'],
		isOwned: true,
		matchScore: 0,
	};
}

function trackHit(t: TrackSummary, mbid?: string, albumMbid?: string): MusicSearchHit {
	return {
		kind: 'track',
		localId: t.id,
		mbid,
		title: t.title,
		artist: t.artistCredit ?? undefined,
		album: t.albumTitle,
		albumId: t.albumId,
		albumMbid,
		artUrl: t.artUrl ?? undefined,
		durationSeconds: t.durationSeconds ?? undefined,
		sources: ['local'],
		isOwned: true,
		matchScore: 0,
	};
}
