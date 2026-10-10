import type {
	AlbumDetail,
	AlbumSummary,
	ArtistDetail,
	ArtistSummary,
	AudioQuality,
	AudioStreamSession,
	MusicSettings,
	TrackDetail,
	TrackSummary,
	WaveformData,
} from '@mu/shared';
import { api } from './api';

/**
 * Music API client. Contract: docs/music-support-plan.md §5–§6.
 * Every route 404s when the Music feature is disabled.
 */

export interface Page<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}

export interface MusicListQuery {
	q?: string;
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	minRating?: number;
	artistId?: string;
	sort?: string;
	order?: 'asc' | 'desc';
	page?: number;
	pageSize?: number;
}

export interface MusicHome {
	recentlyAdded: AlbumSummary[];
	continueListening: AlbumSummary[];
	mostPlayed: TrackSummary[];
	favorites: AlbumSummary[];
}

export interface MusicSearchResult {
	artists: ArtistSummary[];
	albums: AlbumSummary[];
	tracks: TrackSummary[];
}

function params(q: MusicListQuery): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(q)) {
		if (v !== undefined && v !== null && v !== '') out[k] = String(v);
	}
	return out;
}

/**
 * Codecs this browser decodes natively, sent as `caps` on stream start so the
 * server can serve originals (FLAC as FLAC) and transcode only what won't play.
 */
export function audioCapabilities(): string[] {
	if (typeof Audio === 'undefined') return [];
	const a = new Audio();
	const probe: [string, string][] = [
		['flac', 'audio/flac'],
		['opus', 'audio/ogg; codecs=opus'],
		['vorbis', 'audio/ogg; codecs=vorbis'],
		['alac', 'audio/mp4; codecs=alac'],
		['aiff', 'audio/aiff'],
		['aac', 'audio/mp4; codecs=mp4a.40.2'],
		['mp3', 'audio/mpeg'],
	];
	return probe.filter(([, mime]) => a.canPlayType(mime) !== '').map(([k]) => k);
}

type LyricsDto = { plain: string | null; syncedLrc: string | null; source: string | null } | null;

/** Per-track lyrics promises, shared by the lyrics panel and the waveform markers. */
const lyricsCache = new Map<string, Promise<LyricsDto>>();

export const musicService = {
	albums(q: MusicListQuery = {}): Promise<Page<AlbumSummary>> {
		return api.get('/music/albums', params(q));
	},
	artists(q: MusicListQuery = {}): Promise<Page<ArtistSummary>> {
		return api.get('/music/artists', params(q));
	},
	tracks(q: MusicListQuery = {}): Promise<Page<TrackSummary>> {
		return api.get('/music/tracks', params(q));
	},
	genres(): Promise<{ name: string; albumCount: number }[]> {
		return api.get('/music/genres');
	},
	album(id: string): Promise<AlbumDetail> {
		return api.get(`/music/albums/${encodeURIComponent(id)}`);
	},
	artist(id: string): Promise<ArtistDetail> {
		return api.get(`/music/artists/${encodeURIComponent(id)}`);
	},
	track(id: string): Promise<TrackDetail> {
		return api.get(`/music/tracks/${encodeURIComponent(id)}`);
	},
	search(q: string): Promise<MusicSearchResult> {
		return api.get('/music/search', { q });
	},
	home(): Promise<MusicHome> {
		return api.get('/music/home');
	},
	/** Track ids of an album / artist in play order (for "play all"). */
	albumTrackIds(albumId: string): Promise<string[]> {
		return api.get(`/music/albums/${encodeURIComponent(albumId)}/track-ids`);
	},
	startStream(
		trackId: string,
		opts: { profile?: AudioQuality } = {},
	): Promise<AudioStreamSession> {
		const p: Record<string, string> = { caps: audioCapabilities().join(',') };
		if (opts.profile) p.profile = opts.profile;
		return api.get(`/music/stream/${encodeURIComponent(trackId)}/start`, p);
	},
	reportProgress(sessionId: string, positionSeconds: number, completed = false): Promise<void> {
		return api.post(`/music/stream/${encodeURIComponent(sessionId)}/progress`, {
			positionSeconds,
			completed,
		});
	},
	waveform(trackFileId: string): Promise<WaveformData> {
		return api.get(`/music/waveform/${encodeURIComponent(trackFileId)}`);
	},
	lyrics(
		trackId: string,
	): Promise<{ plain: string | null; syncedLrc: string | null; source: string | null } | null> {
		return api.get(`/music/tracks/${encodeURIComponent(trackId)}/lyrics`);
	},
	/** Cached `lyrics()`; failures resolve to null. Cleared by `saveLyrics`. */
	lyricsCached(trackId: string): Promise<LyricsDto> {
		let p = lyricsCache.get(trackId);
		if (!p) {
			p = this.lyrics(trackId).catch(() => null);
			lyricsCache.set(trackId, p);
		}
		return p;
	},
	saveLyrics(
		trackId: string,
		body: { plain: string | null; syncedLrc: string | null },
	): Promise<void> {
		lyricsCache.delete(trackId);
		return api.put(`/music/tracks/${encodeURIComponent(trackId)}/lyrics`, body);
	},
	settings(): Promise<MusicSettings> {
		return api.get('/music/settings');
	},
	saveSettings(patch: Partial<MusicSettings>): Promise<MusicSettings> {
		return api.put('/music/settings', patch);
	},
};
