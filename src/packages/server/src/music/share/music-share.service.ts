import { randomBytes } from 'node:crypto';
import {
	type AudioStreamSession,
	type MusicShareInfo,
	type MusicShareKind,
	type MusicSharePayload,
	type TrackDetail,
	type TrackSummary,
} from '@mu/shared';
import {
	BadRequestException,
	ForbiddenException,
	GoneException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { albums, musicShares, playlists, trackFiles, tracks } from '../../database/schema/index.js';
import { SettingsService } from '../../settings/settings.service.js';
import { MusicQueryService } from '../library/music-query.service.js';
import { MusicStreamService } from '../playback/music-stream.service.js';

/** Same expiry setting as movie share links (`share.tokenExpiryDays`, default 30). */
const EXPIRY_SETTING = 'share.tokenExpiryDays';
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_QUEUE_TRACKS = 500;
const KINDS: readonly MusicShareKind[] = ['track', 'album', 'playlist', 'queue'];

type ShareRow = typeof musicShares.$inferSelect;

export interface CreateShareInput {
	kind: MusicShareKind;
	id?: string;
	trackIds?: string[];
}

/**
 * Public music share links. A share is a DB row whose id is the opaque
 * token; `/listen/<token>` plays it with no account. Every public request is
 * checked against the share's own track set — a token can never reach a track,
 * file, waveform or cover outside what was shared.
 */
@Injectable()
export class MusicShareService {
	constructor(
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly query: MusicQueryService,
		private readonly stream: MusicStreamService,
	) {}

	private get db() {
		return this.database.db;
	}

	// ── Owner side ─────────────────────────────────────────────────────

	create(user: { id: string; role: string }, input: CreateShareInput): MusicShareInfo {
		if (!KINDS.includes(input?.kind)) throw new BadRequestException('Unknown share kind');
		let entityId: string | null = input.id ?? null;
		let trackIds: string[] | null = null;
		let title: string;
		let artId: string | null = null;

		if (input.kind === 'track') {
			const t = this.trackRow(entityId);
			title = t.artistCredit ? `${t.title} — ${t.artistCredit}` : t.title;
			artId = this.albumArt(t.albumId);
		} else if (input.kind === 'album') {
			const a = this.db
				.select()
				.from(albums)
				.where(eq(albums.id, entityId ?? ''))
				.get();
			if (!a) throw new NotFoundException('Album not found');
			title = a.artistCredit ? `${a.title} — ${a.artistCredit}` : a.title;
			artId = a.artId;
		} else if (input.kind === 'playlist') {
			const p = this.db
				.select()
				.from(playlists)
				.where(eq(playlists.id, entityId ?? ''))
				.get();
			if (!p) throw new NotFoundException('Playlist not found');
			if (p.kind !== 'audio')
				throw new BadRequestException('Only music playlists can be shared');
			if (p.userId !== user.id && !p.isPublic && user.role !== 'admin') {
				throw new ForbiddenException('You can only share your own or public playlists');
			}
			title = p.name;
			artId = this.albumArt(this.playlistTrackIds(p.id)[0]);
		} else {
			const ids = [...new Set((input.trackIds ?? []).map(String))].slice(0, MAX_QUEUE_TRACKS);
			const existing = new Set(
				ids.length
					? this.db
							.select({ id: tracks.id })
							.from(tracks)
							.where(inArray(tracks.id, ids))
							.all()
							.map((r) => r.id)
					: [],
			);
			trackIds = ids.filter((id) => existing.has(id));
			if (!trackIds.length) throw new BadRequestException('The queue is empty');
			entityId = null;
			title = `${trackIds.length} track${trackIds.length === 1 ? '' : 's'}`;
			artId = this.albumArt(trackIds[0]);
		}

		const now = new Date();
		const days = this.expiryDays();
		const row: ShareRow = {
			id: randomBytes(18).toString('base64url'),
			kind: input.kind,
			entityId,
			trackIds: trackIds ? JSON.stringify(trackIds) : null,
			title,
			artId,
			createdBy: user.id,
			createdAt: now.toISOString(),
			expiresAt: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null,
		};
		this.db.insert(musicShares).values(row).run();
		return this.info(row);
	}

	listMine(userId: string): MusicShareInfo[] {
		return this.db
			.select()
			.from(musicShares)
			.where(eq(musicShares.createdBy, userId))
			.orderBy(desc(musicShares.createdAt))
			.all()
			.filter((r) => !this.expired(r))
			.map((r) => this.info(r));
	}

	revoke(user: { id: string; role: string }, token: string): void {
		const row = this.db.select().from(musicShares).where(eq(musicShares.id, token)).get();
		if (!row) throw new NotFoundException('Share link not found');
		if (row.createdBy !== user.id && user.role !== 'admin') {
			throw new ForbiddenException('Not your share link');
		}
		this.db.delete(musicShares).where(eq(musicShares.id, token)).run();
	}

	// ── Public side ────────────────────────────────────────────────────

	/** The shared tracks (art rewritten to the token's public art route). */
	payload(token: string): MusicSharePayload {
		const share = this.resolve(token);
		const ids = this.trackIds(share);
		const cards = this.query.summariesById('track', ids) as Map<string, TrackSummary>;
		const list = ids.map((id) => cards.get(id)).filter((t): t is TrackSummary => !!t);
		const first = list[0];
		return {
			token,
			kind: share.kind as MusicShareKind,
			title: share.title,
			subtitle:
				share.kind === 'album' || share.kind === 'track'
					? null
					: `${list.length} track${list.length === 1 ? '' : 's'}`,
			artUrl:
				this.publicArt(token, share.artId ?? null, 600) ??
				(first ? this.rewriteArt(token, first.artUrl) : null),
			tracks: list.map((t) => this.publicTrack(token, t)),
			expiresAt: share.expiresAt,
		};
	}

	track(token: string, trackId: string): TrackDetail {
		const share = this.resolve(token);
		this.assertTrack(share, trackId);
		const d = this.query.getTrack(trackId);
		return {
			...this.publicTrack(token, d),
			mbidRecording: d.mbidRecording,
			isrc: d.isrc,
			files: d.files,
			lyrics: d.lyrics,
			appearsOn: [],
			credits: d.credits,
		};
	}

	startStream(
		token: string,
		trackId: string,
		opts: { profile?: string; caps?: string },
	): AudioStreamSession {
		const share = this.resolve(token);
		this.assertTrack(share, trackId);
		const s = this.stream.start(trackId, opts);
		const base = `/api/v1/music/public/${encodeURIComponent(token)}`;
		return {
			...s,
			streamUrl: s.streamUrl.replace('/api/v1/music/files/', `${base}/files/`),
			waveformUrl: s.waveformUrl
				? s.waveformUrl.replace('/api/v1/music/waveform/', `${base}/waveform/`)
				: null,
		};
	}

	/** Throws unless the track file belongs to a shared track. */
	assertFile(token: string, trackFileId: string): void {
		const share = this.resolve(token);
		const f = this.db
			.select({ trackId: trackFiles.trackId })
			.from(trackFiles)
			.where(eq(trackFiles.id, trackFileId))
			.get();
		if (!f) throw new NotFoundException('File not found');
		this.assertTrack(share, f.trackId);
	}

	assertLyrics(token: string, trackId: string): void {
		this.assertTrack(this.resolve(token), trackId);
	}

	/** Throws unless the artwork is the share's cover or an album cover of a shared track. */
	assertArt(token: string, artId: string): void {
		const share = this.resolve(token);
		if (share.artId === artId) return;
		const ids = this.trackIds(share);
		if (!ids.length) throw new NotFoundException('Artwork not found');
		const hit = this.db
			.select({ id: albums.id })
			.from(tracks)
			.innerJoin(albums, eq(albums.id, tracks.albumId))
			.where(and(inArray(tracks.id, ids), eq(albums.artId, artId)))
			.get();
		if (!hit) throw new NotFoundException('Artwork not found');
	}

	// ── Internals ──────────────────────────────────────────────────────

	resolve(token: string): ShareRow {
		const row = this.db
			.select()
			.from(musicShares)
			.where(eq(musicShares.id, String(token ?? '')))
			.get();
		if (!row) throw new NotFoundException('This share link does not exist');
		if (this.expired(row)) throw new GoneException('This share link has expired');
		return row;
	}

	private expired(row: ShareRow): boolean {
		return !!row.expiresAt && Date.parse(row.expiresAt) < Date.now();
	}

	/** Track ids in play order: live for album/playlist, snapshot for queue. */
	private trackIds(share: ShareRow): string[] {
		switch (share.kind) {
			case 'track':
				return share.entityId ? [share.entityId] : [];
			case 'album':
				return share.entityId ? this.query.albumTrackIds(share.entityId) : [];
			case 'playlist':
				return share.entityId ? this.playlistTrackIds(share.entityId) : [];
			default:
				try {
					return JSON.parse(share.trackIds ?? '[]') as string[];
				} catch {
					return [];
				}
		}
	}

	private assertTrack(share: ShareRow, trackId: string): void {
		if (!this.trackIds(share).includes(trackId)) {
			throw new NotFoundException('Track is not part of this share');
		}
	}

	private playlistTrackIds(playlistId: string): string[] {
		return this.db
			.all<{ id: string }>(sql`
				SELECT item_id AS id FROM playlist_items
				WHERE playlist_id = ${playlistId} AND item_type = 'track'
				ORDER BY position`)
			.map((r) => r.id);
	}

	private trackRow(id: string | null) {
		const t = this.db
			.select()
			.from(tracks)
			.where(eq(tracks.id, id ?? ''))
			.get();
		if (!t) throw new NotFoundException('Track not found');
		return t;
	}

	private albumArt(trackIdOrAlbumId: string | undefined | null): string | null {
		if (!trackIdOrAlbumId) return null;
		const viaTrack = this.db
			.select({ artId: albums.artId })
			.from(tracks)
			.innerJoin(albums, eq(albums.id, tracks.albumId))
			.where(eq(tracks.id, trackIdOrAlbumId))
			.get();
		if (viaTrack) return viaTrack.artId;
		return (
			this.db
				.select({ artId: albums.artId })
				.from(albums)
				.where(eq(albums.id, trackIdOrAlbumId))
				.get()?.artId ?? null
		);
	}

	private publicArt(token: string, artId: string | null, size: number): string | null {
		return artId
			? `/api/v1/music/public/${encodeURIComponent(token)}/art/${artId}?size=${size}`
			: null;
	}

	/** `/api/v1/music/art/<id>?size=N` → the token's public art route. */
	private rewriteArt(token: string, url: string | null): string | null {
		const m = url?.match(/\/api\/v1\/music\/art\/([^?]+)(?:\?size=(\d+))?/);
		return m ? this.publicArt(token, m[1]!, Number(m[2]) || 256) : null;
	}

	/** Strip per-user fields and point art at the public route. */
	private publicTrack<T extends TrackSummary>(token: string, t: T): T {
		return { ...t, artUrl: this.rewriteArt(token, t.artUrl), userRating: undefined };
	}

	private expiryDays(): number | null {
		const raw = this.settings.get<number | null | undefined>(
			EXPIRY_SETTING,
			DEFAULT_EXPIRY_DAYS,
		);
		if (raw == null) return null;
		const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	private info(row: ShareRow): MusicShareInfo {
		return {
			token: row.id,
			kind: row.kind as MusicShareKind,
			title: row.title,
			path: `/listen/${row.id}`,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
		};
	}
}
