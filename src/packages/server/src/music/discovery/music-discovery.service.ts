import type {
	AlbumSummary,
	ArtistSummary,
	MusicDiscoverFilters,
	MusicDiscoverItem,
	MusicDiscoverRequest,
	MusicDiscoverResponse,
	MusicDiscoverSeed,
	MusicDiscoverSeedSuggestion,
	MusicDiscoverStrategyStatus,
	TrackSummary,
} from '@mu/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
	albumArtists,
	albumGenres,
	albums,
	artistGenres,
	artists,
	musicGenres,
	trackArtists,
	tracks,
} from '../../database/schema/index.js';
import {
	type MbArtistCredit,
	type MbTag,
	MusicBrainzClient,
} from '../../providers/sources/musicbrainz/musicbrainz.client.js';
import { normMusic } from '../../search/dedup.js';
import { artUrl, MusicQueryService } from '../library/music-query.service.js';
import {
	type AlbumCandidate,
	addGenres,
	blendScores,
	emptyProfile,
	normaliseByMax,
	type SeedProfile,
	scoreAlbum,
} from './discovery-scoring.js';
import { ListenBrainzClient, type SimilarArtist } from './listenbrainz.client.js';
import { MbPreviewService } from './mb-preview.service.js';

const MAX_SEEDS = 10;
const DEFAULT_LIMIT = 24;
const MIN_SCORE = 0.05;
/** Strategy weights in the noisy-OR blend. */
const W = { local: 1, listenbrainz: 0.9, lbAlbumBoost: 0.6 } as const;

interface Catalogue {
	albums: Map<
		string,
		{
			id: string;
			title: string;
			artistCredit: string | null;
			year: number | null;
			artId: string | null;
			mbid: string | null;
			genres: string[];
			artistIds: string[];
		}
	>;
	artists: Map<string, { id: string; name: string; mbid: string | null; imageId: string | null }>;
	artistByMbid: Map<string, string>;
	artistByName: Map<string, string>;
	albumsByArtist: Map<string, string[]>;
}

/**
 * Music Discover: seeds (artists / albums / tracks — local ids or `mb:<mbid>`)
 * → grouped recommendations with in-library flags.
 *
 * Strategies:
 *  - `local-content` — content vector over genres / era / artist overlap,
 *    computed from the local catalogue ({@link scoreAlbum}).
 *  - `listenbrainz` — keyless ListenBrainz Labs similar-artists for seed artist
 *    MBIDs; library artists are matched by MBID or name, the rest link to
 *    `mb:` stubs. Fails soft.
 * The recommendations module's LLM rerank is NOT used: its prompt and
 * `AnthropicClient.rerank` contract are movie-shaped (MovieSeed).
 */
@Injectable()
export class MusicDiscoveryService {
	private readonly logger = new Logger('MusicDiscovery');

	constructor(
		private readonly database: DatabaseService,
		private readonly music: MusicQueryService,
		private readonly mb: MusicBrainzClient,
		private readonly previews: MbPreviewService,
		private readonly listenbrainz: ListenBrainzClient,
	) {}

	private get db() {
		return this.database.db;
	}

	private loadCatalogue(): Catalogue {
		const albumRows = this.db
			.select({
				id: albums.id,
				title: albums.title,
				artistCredit: albums.artistCredit,
				year: albums.year,
				artId: albums.artId,
				mbid: albums.mbidReleaseGroup,
			})
			.from(albums)
			.all();
		const cat: Catalogue = {
			albums: new Map(albumRows.map((a) => [a.id, { ...a, genres: [], artistIds: [] }])),
			artists: new Map(),
			artistByMbid: new Map(),
			artistByName: new Map(),
			albumsByArtist: new Map(),
		};
		for (const g of this.db
			.select({ albumId: albumGenres.albumId, name: musicGenres.name })
			.from(albumGenres)
			.innerJoin(musicGenres, eq(musicGenres.id, albumGenres.genreId))
			.all()) {
			cat.albums.get(g.albumId)?.genres.push(g.name);
		}
		for (const r of this.db
			.select({ albumId: albumArtists.albumId, artistId: albumArtists.artistId })
			.from(albumArtists)
			.all()) {
			cat.albums.get(r.albumId)?.artistIds.push(r.artistId);
			const list = cat.albumsByArtist.get(r.artistId) ?? [];
			list.push(r.albumId);
			cat.albumsByArtist.set(r.artistId, list);
		}
		for (const a of this.db
			.select({
				id: artists.id,
				name: artists.name,
				mbid: artists.mbid,
				imageId: artists.imageId,
			})
			.from(artists)
			.all()) {
			cat.artists.set(a.id, a);
			if (a.mbid) cat.artistByMbid.set(a.mbid, a.id);
			cat.artistByName.set(normMusic(a.name), a.id);
		}
		return cat;
	}

	// ── Seeds → profile ─────────────────────────────────────────────────

	private async buildProfile(
		seeds: MusicDiscoverSeed[],
		cat: Catalogue,
	): Promise<{ profile: SeedProfile; artistMbids: Set<string> }> {
		const profile = emptyProfile();
		const artistMbids = new Set<string>();
		const addLocalArtist = (id: string) => {
			profile.artistIds.add(id);
			const mbid = cat.artists.get(id)?.mbid;
			if (mbid) artistMbids.add(mbid);
		};
		const addLocalAlbum = (id: string, weight = 1) => {
			const a = cat.albums.get(id);
			if (!a) return;
			addGenres(profile, a.genres, weight);
			if (a.year != null) profile.years.push(a.year);
			for (const ar of a.artistIds) addLocalArtist(ar);
		};

		for (const seed of seeds) {
			let id = seed.id;
			if (id.startsWith('mb:')) {
				const mbid = id.slice(3).toLowerCase();
				const local = this.localIdForMbid(seed.type, mbid, cat);
				if (local) id = local;
				else {
					await this.addMbSeed(seed.type, mbid, profile, artistMbids, cat).catch((e) =>
						this.logger.warn(`mb seed ${mbid}: ${(e as Error).message}`),
					);
					continue;
				}
			}
			if (seed.type === 'artist') {
				profile.excludeArtistIds.add(id);
				addLocalArtist(id);
				const own = cat.albumsByArtist.get(id) ?? [];
				for (const al of own) addLocalAlbum(al, 1 / Math.max(1, own.length));
				addGenres(
					profile,
					this.db
						.select({ name: musicGenres.name })
						.from(artistGenres)
						.innerJoin(musicGenres, eq(musicGenres.id, artistGenres.genreId))
						.where(eq(artistGenres.artistId, id))
						.all()
						.map((g) => g.name),
				);
			} else if (seed.type === 'album') {
				profile.excludeAlbumIds.add(id);
				addLocalAlbum(id);
			} else {
				const t = this.db
					.select({ albumId: tracks.albumId })
					.from(tracks)
					.where(eq(tracks.id, id))
					.get();
				if (!t) continue;
				profile.excludeTrackIds.add(id);
				addLocalAlbum(t.albumId);
				for (const ta of this.db
					.select({ artistId: trackArtists.artistId })
					.from(trackArtists)
					.where(eq(trackArtists.trackId, id))
					.all())
					addLocalArtist(ta.artistId);
			}
		}
		return { profile, artistMbids };
	}

	private localIdForMbid(type: MusicDiscoverSeed['type'], mbid: string, cat: Catalogue) {
		if (type === 'artist') return cat.artistByMbid.get(mbid) ?? null;
		if (type === 'album') {
			for (const a of cat.albums.values()) if (a.mbid === mbid) return a.id;
			return null;
		}
		return (
			this.db
				.select({ id: tracks.id })
				.from(tracks)
				.where(eq(tracks.mbidRecording, mbid))
				.get()?.id ?? null
		);
	}

	private async addMbSeed(
		type: MusicDiscoverSeed['type'],
		mbid: string,
		profile: SeedProfile,
		artistMbids: Set<string>,
		cat: Catalogue,
	): Promise<void> {
		const linkArtist = (artistMbid: string | null | undefined) => {
			if (!artistMbid) return;
			artistMbids.add(artistMbid);
			const local = cat.artistByMbid.get(artistMbid);
			if (local) profile.artistIds.add(local);
		};
		if (type === 'artist') {
			const p = await this.previews.artist(mbid);
			addGenres(profile, p.genres);
			linkArtist(mbid);
			const years = p.releaseGroups.map((g) => g.year).filter((y): y is number => y != null);
			if (years.length) profile.years.push(years[Math.floor(years.length / 2)]!);
		} else if (type === 'album') {
			const p = await this.previews.releaseGroup(mbid);
			addGenres(profile, p.genres);
			linkArtist(p.artistMbid);
			if (p.year != null) profile.years.push(p.year);
		} else {
			const rec = await this.mb.get<{
				'artist-credit'?: MbArtistCredit[];
				genres?: MbTag[];
				tags?: MbTag[];
				'first-release-date'?: string;
			}>(`/recording/${mbid}?inc=artist-credits+genres+tags`);
			if (!rec) return;
			addGenres(
				profile,
				(rec.genres?.length ? rec.genres : (rec.tags ?? [])).map((g) => g.name),
			);
			linkArtist(rec['artist-credit']?.[0]?.artist?.id);
			const y = Number.parseInt(rec['first-release-date']?.slice(0, 4) ?? '', 10);
			if (Number.isFinite(y)) profile.years.push(y);
		}
	}

	// ── Discover ────────────────────────────────────────────────────────

	async discover(req: MusicDiscoverRequest): Promise<MusicDiscoverResponse> {
		const seeds = (req.seeds ?? [])
			.filter(
				(s) =>
					s && typeof s.id === 'string' && ['artist', 'album', 'track'].includes(s.type),
			)
			.slice(0, MAX_SEEDS);
		if (!seeds.length) throw new BadRequestException('At least one seed is required');
		const limit = Math.min(Math.max(req.limit ?? DEFAULT_LIMIT, 1), 60);
		const filters = req.filters ?? {};
		const statuses: MusicDiscoverStrategyStatus[] = [];

		const cat = this.loadCatalogue();
		const { profile, artistMbids } = await this.buildProfile(seeds, cat);

		// Strategy 1: local content vector.
		const local = new Map<string, { score: number; reasons: string[] }>();
		for (const a of cat.albums.values()) {
			if (profile.excludeAlbumIds.has(a.id)) continue;
			const cand: AlbumCandidate = {
				id: a.id,
				genres: a.genres,
				artistIds: a.artistIds,
				year: a.year,
			};
			const s = scoreAlbum(profile, cand);
			if (s.score > 0) local.set(a.id, s);
		}
		statuses.push({ name: 'local-content', ok: true, count: local.size });

		// Strategy 2: ListenBrainz similar artists.
		let similar: SimilarArtist[] = [];
		if (artistMbids.size) {
			try {
				const raw = await this.listenbrainz.similarArtists([...artistMbids]);
				similar = normaliseByMax(raw).filter((r) => !artistMbids.has(r.mbid));
				statuses.push({ name: 'listenbrainz', ok: true, count: similar.length });
			} catch (e) {
				statuses.push({
					name: 'listenbrainz',
					ok: false,
					count: 0,
					error: (e as Error).message,
				});
			}
		} else {
			statuses.push({
				name: 'listenbrainz',
				ok: false,
				count: 0,
				error: 'No seed artist MBIDs',
			});
		}
		const lbByLocalArtist = new Map<string, SimilarArtist>();
		for (const s of similar) {
			const localId = cat.artistByMbid.get(s.mbid) ?? cat.artistByName.get(normMusic(s.name));
			if (localId && !lbByLocalArtist.has(localId)) lbByLocalArtist.set(localId, s);
		}

		// Albums: local score + boost when the album's artist is LB-similar.
		const albumItems: MusicDiscoverItem[] = [];
		for (const a of cat.albums.values()) {
			if (profile.excludeAlbumIds.has(a.id)) continue;
			const l = local.get(a.id);
			const lb = a.artistIds.map((x) => lbByLocalArtist.get(x)).find(Boolean);
			if (!l && !lb) continue;
			const score = blendScores([
				{ weight: W.local, score: l?.score ?? 0 },
				{ weight: W.lbAlbumBoost, score: lb?.score ?? 0 },
			]);
			albumItems.push({
				kind: 'album',
				localId: a.id,
				mbid: a.mbid ?? undefined,
				title: a.title,
				artist: a.artistCredit ?? undefined,
				year: a.year ?? undefined,
				artUrl: artUrl(a.artId, 256) ?? undefined,
				inLibrary: true,
				score,
				reasons: [
					...(l?.reasons ?? []),
					...(lb ? [`Similar to artists you picked (${lb.name})`] : []),
				],
				strategies: [...(l ? ['local-content'] : []), ...(lb ? ['listenbrainz'] : [])],
			});
		}

		// Artists: best album score per local artist, blended with LB; plus non-library LB artists.
		const artistItems = new Map<string, MusicDiscoverItem>();
		const bestAlbum = new Map<string, MusicDiscoverItem>();
		for (const item of albumItems) {
			for (const ar of cat.albums.get(item.localId!)?.artistIds ?? []) {
				const prev = bestAlbum.get(ar);
				if (!prev || prev.score < item.score) bestAlbum.set(ar, item);
			}
		}
		for (const [artistId, best] of bestAlbum) {
			if (profile.excludeArtistIds.has(artistId)) continue;
			const a = cat.artists.get(artistId);
			if (!a) continue;
			const lb = lbByLocalArtist.get(artistId);
			const localScore = local.get(best.localId!)?.score ?? 0;
			artistItems.set(`local:${artistId}`, {
				kind: 'artist',
				localId: artistId,
				mbid: a.mbid ?? undefined,
				title: a.name,
				artUrl: artUrl(a.imageId, 256) ?? undefined,
				inLibrary: true,
				score: blendScores([
					{ weight: W.local, score: localScore },
					{ weight: W.listenbrainz, score: lb?.score ?? 0 },
				]),
				reasons: lb
					? ['Listeners of your seeds also play them', ...best.reasons.slice(0, 1)]
					: best.reasons.slice(0, 2),
				strategies: [
					...(localScore ? ['local-content'] : []),
					...(lb ? ['listenbrainz'] : []),
				],
			});
		}
		for (const s of similar) {
			const localId = cat.artistByMbid.get(s.mbid) ?? cat.artistByName.get(normMusic(s.name));
			if (localId) {
				if (profile.excludeArtistIds.has(localId) || artistItems.has(`local:${localId}`))
					continue;
				const a = cat.artists.get(localId)!;
				artistItems.set(`local:${localId}`, {
					kind: 'artist',
					localId,
					mbid: s.mbid,
					title: a.name,
					artUrl: artUrl(a.imageId, 256) ?? undefined,
					inLibrary: true,
					score: blendScores([{ weight: W.listenbrainz, score: s.score }]),
					reasons: ['Listeners of your seeds also play them'],
					strategies: ['listenbrainz'],
				});
				continue;
			}
			artistItems.set(`mb:${s.mbid}`, {
				kind: 'artist',
				mbid: s.mbid,
				title: s.name,
				inLibrary: false,
				score: blendScores([{ weight: W.listenbrainz, score: s.score }]),
				reasons: [s.comment ? `Similar artist · ${s.comment}` : 'Similar artist'],
				strategies: ['listenbrainz'],
			});
		}

		// Filters.
		const filteredAlbums = albumItems.filter((i) => this.passAlbum(i.localId!, filters, cat));
		const filteredArtists = [...artistItems.values()].filter((i) => {
			if (!i.inLibrary)
				return (
					!filters.inLibraryOnly && !filters.genre && !filters.yearFrom && !filters.yearTo
				);
			const own = cat.albumsByArtist.get(i.localId!) ?? [];
			return (
				!(filters.genre || filters.yearFrom || filters.yearTo) ||
				own.some((al) => this.passAlbum(al, filters, cat))
			);
		});

		const top = (list: MusicDiscoverItem[]) =>
			list
				.filter((i) => i.score >= MIN_SCORE)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit);
		const topAlbums = top(filteredAlbums);

		return {
			artists: top(filteredArtists),
			albums: topAlbums,
			tracks: this.tracksFromAlbums(topAlbums, profile, limit),
			strategies: statuses,
		};
	}

	private passAlbum(albumId: string, f: MusicDiscoverFilters, cat: Catalogue): boolean {
		const a = cat.albums.get(albumId);
		if (!a) return false;
		if (f.genre) {
			const g = f.genre.toLowerCase();
			if (!a.genres.some((x) => x.toLowerCase() === g)) return false;
		}
		if (f.yearFrom && (a.year == null || a.year < f.yearFrom)) return false;
		if (f.yearTo && (a.year == null || a.year > f.yearTo)) return false;
		return true;
	}

	/** Top two tracks (plays, rating, order) of each of the best albums. */
	private tracksFromAlbums(
		top: MusicDiscoverItem[],
		profile: SeedProfile,
		limit: number,
	): MusicDiscoverItem[] {
		const albumIds = top.slice(0, 15).map((a) => a.localId!);
		if (!albumIds.length) return [];
		const rows = this.db
			.select({
				id: tracks.id,
				albumId: tracks.albumId,
				title: tracks.title,
				artistCredit: tracks.artistCredit,
				mbid: tracks.mbidRecording,
				plays: tracks.playCount,
				rating: tracks.ratingAvg,
				trackNo: tracks.trackNo,
			})
			.from(tracks)
			.where(inArray(tracks.albumId, albumIds))
			.orderBy(
				sql`coalesce(${tracks.playCount}, 0) DESC`,
				sql`coalesce(${tracks.ratingAvg}, 0) DESC`,
				sql`coalesce(${tracks.trackNo}, 999) ASC`,
			)
			.all();
		const byAlbum = new Map(top.map((a) => [a.localId!, a]));
		const taken = new Map<string, number>();
		const out: MusicDiscoverItem[] = [];
		for (const t of rows) {
			if (profile.excludeTrackIds.has(t.id)) continue;
			const n = taken.get(t.albumId) ?? 0;
			if (n >= 2) continue;
			taken.set(t.albumId, n + 1);
			const album = byAlbum.get(t.albumId)!;
			out.push({
				kind: 'track',
				localId: t.id,
				mbid: t.mbid ?? undefined,
				title: t.title,
				artist: t.artistCredit ?? album.artist,
				year: album.year,
				artUrl: album.artUrl,
				inLibrary: true,
				score: album.score * (n === 0 ? 0.95 : 0.9),
				reasons: [`From ${album.title}`, ...album.reasons.slice(0, 1)],
				strategies: album.strategies,
			});
		}
		return out.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	// ── Seed suggestions ────────────────────────────────────────────────

	seedSuggestions(userId: string): MusicDiscoverSeedSuggestion[] {
		const out: MusicDiscoverSeedSuggestion[] = [];
		const seen = new Set<string>();
		const push = (s: MusicDiscoverSeedSuggestion) => {
			const k = `${s.type}:${s.id}`;
			if (seen.has(k)) return;
			seen.add(k);
			out.push(s);
		};
		const favRows = this.db.all<{ type: string; id: string }>(sql`
			SELECT entity_type AS type, entity_id AS id FROM favorites
			WHERE user_id = ${userId} AND entity_type IN ('artist','album','track')
			ORDER BY created_at DESC LIMIT 30`);
		const byType = (t: 'artist' | 'album' | 'track') =>
			favRows.filter((r) => r.type === t).map((r) => r.id);
		for (const t of ['artist', 'album', 'track'] as const) {
			const map = this.music.summariesById(t, byType(t));
			for (const id of byType(t)) {
				const s = map.get(id);
				if (s) push({ ...this.suggestion(t, s), origin: 'favorite' });
			}
		}
		for (const a of this.music.continueListening(userId, 12)) {
			push({ ...this.suggestion('album', a), origin: 'history' });
		}
		return out.slice(0, 30);
	}

	private suggestion(
		type: 'artist' | 'album' | 'track',
		s: ArtistSummary | AlbumSummary | TrackSummary,
	): Omit<MusicDiscoverSeedSuggestion, 'origin'> {
		if (type === 'artist') {
			const a = s as ArtistSummary;
			return { type, id: a.id, label: a.name, artUrl: a.imageUrl };
		}
		if (type === 'album') {
			const a = s as AlbumSummary;
			return {
				type,
				id: a.id,
				label: a.title,
				subtitle: a.artistCredit ?? undefined,
				artUrl: a.artUrl,
			};
		}
		const t = s as TrackSummary;
		return {
			type,
			id: t.id,
			label: t.title,
			subtitle: t.artistCredit ?? undefined,
			artUrl: t.artUrl,
		};
	}
}
