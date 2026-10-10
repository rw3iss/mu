import type { MbArtistPreview, MbReleaseGroupPreview } from '@mu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { albums, artists } from '../../database/schema/index.js';
import {
	creditName,
	type MbReleaseDetail,
	type MbTag,
	MusicBrainzClient,
} from '../../providers/sources/musicbrainz/musicbrainz.client.js';
import { SearchCacheService } from '../../search/search-cache.service.js';
import { caaReleaseGroupFront } from '../../search/sources/musicbrainz-search.js';

const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertMbid(mbid: string): string {
	const id = mbid.trim().toLowerCase();
	if (!MBID_RE.test(id)) throw new NotFoundException('Invalid MusicBrainz id');
	return id;
}

const yearOf = (date?: string | null): number | null => {
	const y = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
	return Number.isFinite(y) ? y : null;
};

const topTags = (genres?: MbTag[], tags?: MbTag[]): string[] => {
	const list = genres?.length ? genres : (tags ?? []);
	return [...list]
		.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
		.slice(0, 8)
		.map((t) => t.name);
};

interface MbBrowseReleaseGroups {
	'release-groups'?: Array<{
		id: string;
		title: string;
		'primary-type'?: string;
		'secondary-types'?: string[];
		'first-release-date'?: string;
	}>;
}

/**
 * MusicBrainz-backed previews for non-library `mb:` stub pages. Payloads are
 * cached 7d in `search_cache` (query `mbid:<id>`); the "already in library"
 * pointer is resolved fresh on every call (cheap indexed lookup).
 */
@Injectable()
export class MbPreviewService {
	private inFlight = new Map<string, Promise<unknown>>();

	constructor(
		private readonly database: DatabaseService,
		private readonly mb: MusicBrainzClient,
		private readonly cache: SearchCacheService,
	) {}

	private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const existing = this.inFlight.get(key) as Promise<T> | undefined;
		if (existing) return existing;
		const p = fn().finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, p);
		return p;
	}

	async releaseGroup(rawMbid: string): Promise<MbReleaseGroupPreview> {
		const mbid = assertMbid(rawMbid);
		const cached = this.cache.get<MbReleaseGroupPreview>(
			'album',
			`mbid:${mbid}`,
			'musicbrainz',
		);
		const base =
			cached?.[0] ??
			(await this.once(`rg:${mbid}`, async () => {
				const rg = await this.mb.lookupReleaseGroup(mbid);
				if (!rg) throw new NotFoundException('Release group not found on MusicBrainz');
				const credit = rg['artist-credit'];
				const preview: MbReleaseGroupPreview = {
					mbid,
					title: rg.title ?? 'Unknown album',
					primaryType: rg['primary-type'] ?? null,
					secondaryTypes: rg['secondary-types'] ?? [],
					year: yearOf(rg['first-release-date']),
					artist: creditName(credit),
					artistMbid: credit?.[0]?.artist?.id ?? null,
					genres: topTags(rg.genres, rg.tags),
					coverUrl: caaReleaseGroupFront(mbid, 500),
					url: `https://musicbrainz.org/release-group/${mbid}`,
					tracks: await this.tracklist(mbid),
					localAlbumId: null,
				};
				this.cache.set('album', `mbid:${mbid}`, 'musicbrainz', [preview]);
				return preview;
			}));
		const local = this.database.db
			.select({ id: albums.id })
			.from(albums)
			.where(eq(albums.mbidReleaseGroup, mbid))
			.get();
		return { ...base, localAlbumId: local?.id ?? null };
	}

	/** Tracklist of the earliest Official release in the group (2 MB calls). */
	private async tracklist(rgMbid: string): Promise<MbReleaseGroupPreview['tracks']> {
		const releases = await this.mb.releasesOfGroup(rgMbid);
		if (!releases.length) return [];
		const pick = [...releases].sort((a, b) => {
			const off = Number(b.status === 'Official') - Number(a.status === 'Official');
			return off || (a.date ?? '9999').localeCompare(b.date ?? '9999');
		})[0]!;
		const detail = await this.mb.get<MbReleaseDetail>(
			`/release/${pick.id}?inc=recordings+artist-credits`,
		);
		const out: MbReleaseGroupPreview['tracks'] = [];
		for (const medium of detail?.media ?? []) {
			for (const t of medium.tracks ?? []) {
				const title = t.title || t.recording?.title;
				if (!title) continue;
				out.push({
					position: t.position ?? null,
					title,
					lengthMs: t.length ?? t.recording?.length ?? null,
					artist: creditName(t['artist-credit']),
				});
			}
		}
		return out;
	}

	async artist(rawMbid: string): Promise<MbArtistPreview> {
		const mbid = assertMbid(rawMbid);
		const cached = this.cache.get<MbArtistPreview>('artist', `mbid:${mbid}`, 'musicbrainz');
		const base =
			cached?.[0] ??
			(await this.once(`ar:${mbid}`, async () => {
				const a = await this.mb.lookupArtist(mbid);
				if (!a) throw new NotFoundException('Artist not found on MusicBrainz');
				const browse = await this.mb.get<MbBrowseReleaseGroups>(
					`/release-group?artist=${mbid}&type=album|ep&limit=100`,
				);
				const preview: MbArtistPreview = {
					mbid,
					name: a.name,
					type: a.type ?? null,
					country: a.country ?? null,
					beginYear: yearOf(a['life-span']?.begin),
					endYear: yearOf(a['life-span']?.end),
					disambiguation: a.disambiguation || null,
					genres: topTags(a.genres),
					url: `https://musicbrainz.org/artist/${mbid}`,
					releaseGroups: (browse?.['release-groups'] ?? [])
						// Studio albums/EPs only — live/compilation/etc. clutter a preview.
						.filter((g) => !(g['secondary-types'] ?? []).length)
						.map((g) => ({
							mbid: g.id,
							title: g.title,
							year: yearOf(g['first-release-date']),
							primaryType: g['primary-type'] ?? null,
							coverUrl: caaReleaseGroupFront(g.id),
							localAlbumId: null,
						}))
						.sort((x, y) => (y.year ?? 0) - (x.year ?? 0)),
					localArtistId: null,
				};
				this.cache.set('artist', `mbid:${mbid}`, 'musicbrainz', [preview]);
				return preview;
			}));
		const db = this.database.db;
		const local = db
			.select({ id: artists.id })
			.from(artists)
			.where(eq(artists.mbid, mbid))
			.get();
		const rgIds = base.releaseGroups.map((g) => g.mbid);
		const owned = new Map(
			rgIds.length
				? db
						.select({ id: albums.id, rg: albums.mbidReleaseGroup })
						.from(albums)
						.where(inArray(albums.mbidReleaseGroup, rgIds))
						.all()
						.map((r) => [r.rg as string, r.id])
				: [],
		);
		return {
			...base,
			localArtistId: local?.id ?? null,
			releaseGroups: base.releaseGroups.map((g) => ({
				...g,
				localAlbumId: owned.get(g.mbid) ?? null,
			})),
		};
	}
}
