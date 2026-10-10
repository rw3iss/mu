import { randomUUID } from 'node:crypto';
import type { AlbumMatchState, MusicMatchCandidate } from '@mu/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
	albumArtists,
	albumGenres,
	albumMatchCandidates,
	albumReleases,
	albums,
	artistGenres,
	artists,
	lyrics,
	tracks,
} from '../../database/schema/index.js';
import {
	type MbReleaseDetail,
	type MbTag,
	MusicBrainzClient,
} from '../../providers/sources/musicbrainz/musicbrainz.client.js';
import { ArtworkService } from '../catalog/artwork.service.js';
import { MusicCatalogService } from '../catalog/catalog.service.js';
import { normKey } from '../ingest/normalize.js';
import { MusicSettingsService } from '../music-settings.service.js';
import {
	buildReleaseQuery,
	candidateList,
	durationScore,
	type LocalAlbum,
	mapAlbumType,
	pickConfident,
	rankReleases,
	type ScoredRelease,
	scoreRelease,
	similarity,
	withDurations,
	yearOf,
} from './album-match.js';
import { CoverArtClient, LrclibClient, WikiClient } from './clients.js';

/** Re-query LRCLIB for a track it didn't have after this long. */
export const LYRICS_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';
/** How many top search hits get a full release lookup (track durations). */
const DETAIL_LOOKUPS = 2;

export type MatchOutcome =
	| { status: 'matched'; releaseGroupMbid: string | null; releaseMbid: string; score: number }
	| { status: 'candidates'; count: number }
	| { status: 'none' }
	| { status: 'skipped'; reason: string };

/**
 * Music metadata enrichment: MusicBrainz album matching, Cover Art Archive
 * covers, artist bio/image from Wikidata/Wikipedia, and LRCLIB lyrics.
 *
 * Merge rules: tags win for titles and track numbers; providers fill MBIDs,
 * types, genres, art and bios. Provider values never overwrite a user-edited
 * lyric (source='user') and only fill missing art unless forced.
 */
@Injectable()
export class MusicMetadataService {
	private readonly logger = new Logger('MusicMetadata');

	constructor(
		private readonly database: DatabaseService,
		private readonly mb: MusicBrainzClient,
		private readonly coverArt: CoverArtClient,
		private readonly wiki: WikiClient,
		private readonly lrclib: LrclibClient,
		private readonly artworkStore: ArtworkService,
		private readonly catalog: MusicCatalogService,
		private readonly musicSettings: MusicSettingsService,
	) {}

	private get db() {
		return this.database.db;
	}

	private album(albumId: string) {
		const row = this.db.select().from(albums).where(eq(albums.id, albumId)).get();
		if (!row) throw new NotFoundException('Album not found');
		return row;
	}

	/** Album title (404 when the album doesn't exist). */
	albumTitle(albumId: string): string {
		return this.album(albumId).title;
	}

	private localAlbum(albumId: string, override: { title?: string; artist?: string } = {}) {
		const al = this.album(albumId);
		const durations = this.db
			.select({ d: tracks.durationSeconds })
			.from(tracks)
			.where(eq(tracks.albumId, albumId))
			.orderBy(asc(tracks.discNo), asc(tracks.trackNo))
			.all()
			.map((r) => r.d ?? 0);
		const local: LocalAlbum = {
			title: override.title?.trim() || al.title,
			artist: override.artist?.trim() || al.artistCredit,
			year: al.year ?? al.originalYear,
			trackCount: al.trackCount || durations.length,
			durations,
			various: !!al.isCompilation && !override.artist,
		};
		return { al, local };
	}

	// ── Match state / candidates ──────────────────────────────────────────

	matchState(albumId: string): AlbumMatchState {
		const al = this.album(albumId);
		const row = this.db
			.select()
			.from(albumMatchCandidates)
			.where(eq(albumMatchCandidates.albumId, albumId))
			.get();
		const release = this.db
			.select({ mbid: albumReleases.mbidRelease })
			.from(albumReleases)
			.where(eq(albumReleases.albumId, albumId))
			.get();
		let candidates: MusicMatchCandidate[] = [];
		try {
			candidates = row ? (JSON.parse(row.candidates) as MusicMatchCandidate[]) : [];
		} catch {
			candidates = [];
		}
		const status = al.mbidReleaseGroup
			? 'matched'
			: !row
				? 'unsearched'
				: candidates.length
					? 'candidates'
					: 'none';
		return {
			albumId,
			status,
			releaseGroupMbid: al.mbidReleaseGroup ?? null,
			releaseMbid: release?.mbid ?? null,
			candidates,
			searchedAt: row?.searchedAt ?? null,
		};
	}

	private saveCandidates(
		albumId: string,
		candidates: MusicMatchCandidate[],
		matchedBy?: 'auto' | 'manual',
	) {
		const values = {
			candidates: JSON.stringify(candidates),
			searchedAt: new Date().toISOString(),
			...(matchedBy ? { matchedBy } : {}),
		};
		this.db
			.insert(albumMatchCandidates)
			.values({ albumId, ...values })
			.onConflictDoUpdate({ target: albumMatchCandidates.albumId, set: values })
			.run();
	}

	private async search(local: LocalAlbum): Promise<ScoredRelease[]> {
		let hits = await this.mb.searchReleases(buildReleaseQuery(local));
		if (!hits.length && local.artist && !local.various) {
			// The artist spelling may differ on MB — retry by title alone.
			hits = await this.mb.searchReleases(buildReleaseQuery({ ...local, artist: null }));
		}
		return rankReleases(local, hits);
	}

	/** Live search (manual "search again"), storing the candidates. Never auto-applies. */
	async searchCandidates(
		albumId: string,
		override: { title?: string; artist?: string } = {},
	): Promise<AlbumMatchState> {
		const { local } = this.localAlbum(albumId, override);
		const ranked = await this.search(local);
		this.saveCandidates(albumId, candidateList(ranked));
		return this.matchState(albumId);
	}

	/**
	 * Search MusicBrainz and auto-apply a confident match, else store the
	 * candidates. A manual match is never replaced; an auto match is
	 * re-evaluated only with `force`.
	 */
	async matchAlbum(albumId: string, opts: { force?: boolean } = {}): Promise<MatchOutcome> {
		const { al, local } = this.localAlbum(albumId);
		if (al.mbidReleaseGroup) {
			const by = this.db
				.select({ by: albumMatchCandidates.matchedBy })
				.from(albumMatchCandidates)
				.where(eq(albumMatchCandidates.albumId, albumId))
				.get()?.by;
			if (!opts.force || by === 'manual') return { status: 'skipped', reason: 'matched' };
		}
		if (normKey(local.title) === normKey('(Unknown Album)')) {
			this.saveCandidates(albumId, []);
			return { status: 'skipped', reason: 'untitled' };
		}
		const ranked = await this.search(local);
		if (!ranked.length) {
			this.saveCandidates(albumId, []);
			return { status: 'none' };
		}
		// Fold per-track duration agreement into the top few scores.
		const details = new Map<string, MbReleaseDetail>();
		for (const r of ranked.slice(0, DETAIL_LOOKUPS)) {
			const detail = await this.mb.lookupRelease(r.hit.id);
			if (!detail) continue;
			details.set(r.hit.id, detail);
			r.score = withDurations(r.score, durationScore(local.durations, detail));
		}
		ranked.sort((a, b) => b.score - a.score);
		const candidates = candidateList(ranked);
		const winner = pickConfident(ranked);
		const detail = winner ? details.get(winner.hit.id) : undefined;
		if (!winner || !detail) {
			this.saveCandidates(albumId, candidates);
			return candidates.length
				? { status: 'candidates', count: candidates.length }
				: { status: 'none' };
		}
		await this.applyRelease(albumId, detail, 'auto', candidates);
		return {
			status: 'matched',
			releaseGroupMbid: detail['release-group']?.id ?? null,
			releaseMbid: detail.id,
			score: winner.score,
		};
	}

	/** Manual match by release (exact) or release group (best release picked for us). */
	async applyManualMatch(
		albumId: string,
		body: { releaseMbid?: string; releaseGroupMbid?: string },
	): Promise<AlbumMatchState> {
		const { local } = this.localAlbum(albumId);
		let releaseMbid = body.releaseMbid?.trim();
		if (!releaseMbid && body.releaseGroupMbid) {
			const releases = await this.mb.releasesOfGroup(body.releaseGroupMbid.trim());
			const best = releases
				.map((hit) => ({ hit, score: scoreRelease(local, hit) }))
				.sort((a, b) => b.score - a.score)[0];
			releaseMbid = best?.hit.id;
		}
		if (!releaseMbid) throw new NotFoundException('No MusicBrainz release found');
		const detail = await this.mb.lookupRelease(releaseMbid);
		if (!detail) throw new NotFoundException('MusicBrainz release not found');
		const prev = this.matchState(albumId).candidates;
		await this.applyRelease(albumId, detail, 'manual', prev);
		return this.matchState(albumId);
	}

	/** Write a chosen release into the catalogue (album, release row, artist MBIDs, genres). */
	private async applyRelease(
		albumId: string,
		detail: MbReleaseDetail,
		matchedBy: 'auto' | 'manual',
		candidates: MusicMatchCandidate[],
	): Promise<void> {
		const rgRef = detail['release-group'];
		const rg = rgRef?.id ? await this.mb.lookupReleaseGroup(rgRef.id) : null;
		const secondary = rg?.['secondary-types'] ?? rgRef?.['secondary-types'] ?? [];
		const primary = rg?.['primary-type'] ?? rgRef?.['primary-type'];
		const firstYear = yearOf(rg?.['first-release-date'] ?? rgRef?.['first-release-date']);
		const db = this.db;
		const now = new Date().toISOString();
		const al = this.album(albumId);

		db.transaction(() => {
			const compilation =
				secondary.some((s) => s.toLowerCase() === 'compilation') ||
				detail['artist-credit']?.[0]?.artist?.id === VARIOUS_ARTISTS_MBID;
			db.update(albums)
				.set({
					mbidReleaseGroup: rgRef?.id ?? null,
					primaryType: mapAlbumType(primary, secondary),
					secondaryTypes: JSON.stringify(secondary.map((s) => s.toLowerCase())),
					isCompilation: compilation || !!al.isCompilation,
					year: al.year ?? yearOf(detail.date) ?? firstYear,
					originalYear: al.originalYear ?? firstYear,
					updatedAt: now,
				})
				.where(eq(albums.id, albumId))
				.run();

			db.delete(albumReleases).where(eq(albumReleases.albumId, albumId)).run();
			const labelInfo = detail['label-info']?.[0];
			db.insert(albumReleases)
				.values({
					id: randomUUID(),
					albumId,
					mbidRelease: detail.id,
					label: labelInfo?.label?.name ?? null,
					catalogNo: labelInfo?.['catalog-number'] ?? null,
					country: detail.country ?? null,
					mediaFormat: detail.media?.[0]?.format ?? null,
					discCount: detail.media?.length || 1,
					releaseDate: detail.date ?? null,
				})
				.run();

			this.applyArtistMbids(albumId, detail);
			this.applyRecordingMbids(albumId, detail);
			for (const g of topGenres(rg?.genres, rg?.tags)) {
				db.insert(albumGenres)
					.values({ albumId, genreId: this.catalog.findOrCreateGenre(g) })
					.onConflictDoNothing()
					.run();
			}
			this.saveCandidates(albumId, candidates, matchedBy);
		});
	}

	/** Give album artists the MBIDs from the release credit (never steal another row's MBID). */
	private applyArtistMbids(albumId: string, detail: MbReleaseDetail) {
		const local = this.db
			.select({ id: artists.id, name: artists.name, mbid: artists.mbid })
			.from(albumArtists)
			.innerJoin(artists, eq(artists.id, albumArtists.artistId))
			.where(eq(albumArtists.albumId, albumId))
			.all();
		for (const credit of detail['artist-credit'] ?? []) {
			const mbid = credit.artist?.id;
			if (!mbid || mbid === VARIOUS_ARTISTS_MBID) continue;
			const target = local.find(
				(a) =>
					!a.mbid &&
					(similarity(normKey(a.name), normKey(credit.name)) >= 0.85 ||
						similarity(normKey(a.name), normKey(credit.artist?.name ?? '')) >= 0.85),
			);
			if (!target) continue;
			const taken = this.db
				.select({ id: artists.id })
				.from(artists)
				.where(eq(artists.mbid, mbid))
				.get();
			if (taken) continue;
			this.db.update(artists).set({ mbid }).where(eq(artists.id, target.id)).run();
			target.mbid = mbid;
		}
	}

	/** Recording MBIDs by position, only when the track lists line up exactly. */
	private applyRecordingMbids(albumId: string, detail: MbReleaseDetail) {
		const remote = (detail.media ?? []).flatMap((m, discIdx) =>
			(m.tracks ?? []).map((t, i) => ({
				disc: m.position ?? discIdx + 1,
				no: t.position ?? i + 1,
				title: t.title ?? t.recording?.title ?? '',
				rec: t.recording?.id ?? null,
			})),
		);
		const local = this.db
			.select({
				id: tracks.id,
				disc: tracks.discNo,
				no: tracks.trackNo,
				title: tracks.title,
				rec: tracks.mbidRecording,
			})
			.from(tracks)
			.where(eq(tracks.albumId, albumId))
			.all();
		if (local.length !== remote.length) return;
		for (const t of local) {
			if (t.rec) continue;
			const r = remote.find((x) => x.disc === (t.disc ?? 1) && x.no === t.no);
			if (!r?.rec || similarity(normKey(r.title), normKey(t.title)) < 0.6) continue;
			this.db.update(tracks).set({ mbidRecording: r.rec }).where(eq(tracks.id, t.id)).run();
		}
	}

	/** Refresh genres/types from the release group of an already-matched album. */
	async refreshReleaseGroup(albumId: string): Promise<void> {
		const al = this.album(albumId);
		if (!al.mbidReleaseGroup) return;
		const rg = await this.mb.lookupReleaseGroup(al.mbidReleaseGroup);
		if (!rg) return;
		this.db.transaction(() => {
			this.db
				.update(albums)
				.set({
					primaryType: mapAlbumType(rg['primary-type'], rg['secondary-types']),
					secondaryTypes: JSON.stringify(
						(rg['secondary-types'] ?? []).map((s) => s.toLowerCase()),
					),
					originalYear: al.originalYear ?? yearOf(rg['first-release-date']),
				})
				.where(eq(albums.id, albumId))
				.run();
			for (const g of topGenres(rg.genres, rg.tags)) {
				this.db
					.insert(albumGenres)
					.values({ albumId, genreId: this.catalog.findOrCreateGenre(g) })
					.onConflictDoNothing()
					.run();
			}
		});
	}

	// ── Cover art ─────────────────────────────────────────────────────────

	/**
	 * Front cover from the Cover Art Archive. Fills missing art only; `force`
	 * replaces existing art. Skipped when the admin removed 'coverartarchive'
	 * from the art preference (unless forced).
	 */
	async fetchAlbumArt(
		albumId: string,
		opts: { force?: boolean } = {},
	): Promise<{ artId: string } | { skipped: string }> {
		const al = this.album(albumId);
		if (al.artId && !opts.force) return { skipped: 'has-art' };
		if (!opts.force && !this.musicSettings.get().artPreference.includes('coverartarchive')) {
			return { skipped: 'disabled' };
		}
		const release = this.db
			.select({ mbid: albumReleases.mbidRelease })
			.from(albumReleases)
			.where(eq(albumReleases.albumId, albumId))
			.get()?.mbid;
		if (!release && !al.mbidReleaseGroup) return { skipped: 'unmatched' };
		const img =
			(release ? await this.coverArt.front('release', release) : null) ??
			(al.mbidReleaseGroup
				? await this.coverArt.front('release-group', al.mbidReleaseGroup)
				: null);
		if (!img) return { skipped: 'not-found' };
		const artId = await this.artworkStore.store(
			img.bytes,
			img.mime,
			'album',
			'coverartarchive',
		);
		this.db
			.update(albums)
			.set({ artId, updatedAt: new Date().toISOString() })
			.where(
				opts.force
					? eq(albums.id, albumId)
					: and(eq(albums.id, albumId), isNull(albums.artId)),
			)
			.run();
		return { artId };
	}

	// ── Artists ───────────────────────────────────────────────────────────

	/** MBID (search when missing), facts, bio and image for one artist. */
	async enrichArtist(
		artistId: string,
		opts: { force?: boolean } = {},
	): Promise<{ ok: true; bio: boolean; image: boolean } | { skipped: string }> {
		const a = this.db.select().from(artists).where(eq(artists.id, artistId)).get();
		if (!a) return { skipped: 'missing' };
		if (a.metadataFetchedAt && !opts.force) return { skipped: 'fetched' };
		const now = new Date().toISOString();
		const markFetched = () =>
			this.db
				.update(artists)
				.set({ metadataFetchedAt: now })
				.where(eq(artists.id, artistId))
				.run();
		if (
			a.mbid === VARIOUS_ARTISTS_MBID ||
			['various artists', 'various'].includes(a.normName)
		) {
			markFetched();
			return { skipped: 'various' };
		}
		let mbid = a.mbid;
		if (!mbid) {
			const hits = await this.mb.searchArtists(a.name);
			const hit = hits.find((h) => (h.score ?? 0) >= 95 && normKey(h.name) === a.normName);
			const taken = hit
				? this.db
						.select({ id: artists.id })
						.from(artists)
						.where(eq(artists.mbid, hit.id))
						.get()
				: null;
			if (hit && !taken) {
				mbid = hit.id;
				this.db.update(artists).set({ mbid }).where(eq(artists.id, artistId)).run();
			}
		}
		if (!mbid) {
			markFetched();
			return { skipped: 'no-mbid' };
		}
		const detail = await this.mb.lookupArtist(mbid);
		if (!detail) {
			markFetched();
			return { skipped: 'not-found' };
		}
		const rel = (type: string) =>
			detail.relations?.find((r) => r.type === type)?.url?.resource ?? null;
		const info =
			!a.bio || !a.imageId || opts.force
				? await this.wiki.artistInfo({
						wikipedia: rel('wikipedia'),
						wikidata: rel('wikidata'),
					})
				: { bio: null, image: null };
		const imageId =
			info.image && (!a.imageId || opts.force)
				? await this.artworkStore.store(
						info.image.bytes,
						info.image.mime,
						'artist',
						'wikidata',
					)
				: null;
		this.db.transaction(() => {
			this.db
				.update(artists)
				.set({
					type: a.type ?? detail.type?.toLowerCase() ?? null,
					country: a.country ?? detail.country ?? null,
					beginYear: a.beginYear ?? yearOf(detail['life-span']?.begin),
					endYear: a.endYear ?? yearOf(detail['life-span']?.end),
					disambiguation: a.disambiguation ?? (detail.disambiguation || null),
					bio: info.bio && (!a.bio || opts.force) ? info.bio : a.bio,
					imageId: imageId ?? a.imageId,
					metadataFetchedAt: now,
					updatedAt: now,
				})
				.where(eq(artists.id, artistId))
				.run();
			for (const g of topGenres(detail.genres)) {
				this.db
					.insert(artistGenres)
					.values({ artistId, genreId: this.catalog.findOrCreateGenre(g) })
					.onConflictDoNothing()
					.run();
			}
		});
		return { ok: true, bio: !!info.bio, image: !!imageId };
	}

	/**
	 * Full per-album pass (the `music-metadata` job): match → release-group
	 * refresh → cover art (if missing) → album artists' info.
	 */
	async enrichAlbum(albumId: string, opts: { force?: boolean } = {}) {
		const match = await this.matchAlbum(albumId, opts);
		const al = this.album(albumId);
		if (match.status === 'skipped' && al.mbidReleaseGroup && opts.force) {
			await this.refreshReleaseGroup(albumId);
		}
		let art: unknown = { skipped: 'unmatched' };
		if (al.mbidReleaseGroup) {
			try {
				art = await this.fetchAlbumArt(albumId);
			} catch (err) {
				art = { error: (err as Error).message };
			}
		}
		const artistIds = this.db
			.select({ id: albumArtists.artistId })
			.from(albumArtists)
			.where(eq(albumArtists.albumId, albumId))
			.all()
			.map((r) => r.id);
		let artistsEnriched = 0;
		for (const id of artistIds) {
			try {
				const r = await this.enrichArtist(id, opts);
				if ('ok' in r) artistsEnriched++;
			} catch (err) {
				this.logger.warn(`Artist enrich failed for ${id}: ${(err as Error).message}`);
			}
		}
		this.db
			.update(albums)
			.set({ metadataFetchedAt: new Date().toISOString() })
			.where(eq(albums.id, albumId))
			.run();
		return { match, art, artistsEnriched };
	}

	// ── Lyrics ────────────────────────────────────────────────────────────

	/**
	 * LRCLIB lyrics for one track. Never touches a user-edited row. A miss is
	 * stored (empty row + fetchedAt) and not re-queried for LYRICS_MISS_TTL_MS
	 * unless `force`. Existing fetched lyrics are only replaced with `force`.
	 */
	async fetchLyrics(
		trackId: string,
		opts: { force?: boolean; ignoreSetting?: boolean } = {},
	): Promise<{ status: 'found' | 'miss' } | { skipped: string }> {
		if (!opts.ignoreSetting && !this.musicSettings.get().fetchLyrics) {
			return { skipped: 'disabled' };
		}
		const check = this.lyricsBlocker(trackId, opts.force);
		if (check) return { skipped: check };
		const t = this.db
			.select({
				title: tracks.title,
				credit: tracks.artistCredit,
				duration: tracks.durationSeconds,
				album: albums.title,
				albumCredit: albums.artistCredit,
			})
			.from(tracks)
			.innerJoin(albums, eq(albums.id, tracks.albumId))
			.where(eq(tracks.id, trackId))
			.get();
		if (!t) return { skipped: 'missing' };
		const artist = t.credit ?? t.albumCredit;
		if (!artist) return { skipped: 'no-artist' };
		const found = await this.lrclib.find({
			artist,
			track: t.title,
			album: t.album === '(Unknown Album)' ? null : t.album,
			durationSeconds: t.duration,
		});
		// Re-check after the await: a user may have saved lyrics meanwhile.
		const recheck = this.lyricsBlocker(trackId, opts.force);
		if (recheck) return { skipped: recheck };
		const now = new Date().toISOString();
		const hasText = !!(found?.plain || found?.syncedLrc);
		const values = {
			plain: hasText ? (found?.plain ?? null) : null,
			syncedLrc: hasText ? (found?.syncedLrc ?? null) : null,
			source: 'lrclib',
			editedBy: null,
			fetchedAt: now,
			updatedAt: now,
		};
		this.db
			.insert(lyrics)
			.values({ trackId, ...values })
			.onConflictDoUpdate({
				target: lyrics.trackId,
				set: values,
				setWhere: ne(lyrics.source, 'user'),
			})
			.run();
		return { status: hasText ? 'found' : 'miss' };
	}

	/** Why a lyrics fetch must not run now, or null. */
	private lyricsBlocker(trackId: string, force?: boolean): string | null {
		const row = this.db.select().from(lyrics).where(eq(lyrics.trackId, trackId)).get();
		if (!row) return null;
		if (row.source === 'user') return 'user-edited';
		if (force) return null;
		if (row.plain || row.syncedLrc) return 'has-lyrics';
		const age = row.fetchedAt ? Date.now() - new Date(row.fetchedAt).getTime() : Infinity;
		return age < LYRICS_MISS_TTL_MS ? 'recent-miss' : null;
	}
}

/** Up to five genre names: MB genres by vote, else tags with ≥1 vote. */
export function topGenres(genres?: MbTag[], tags?: MbTag[]): string[] {
	const pick = (list: MbTag[] | undefined) =>
		(list ?? [])
			.filter((g) => g.name && (g.count ?? 1) > 0)
			.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
			.slice(0, 5)
			.map((g) => g.name.replace(/\b\w/g, (c) => c.toUpperCase()));
	const fromGenres = pick(genres);
	return fromGenres.length ? fromGenres : pick(tags);
}
