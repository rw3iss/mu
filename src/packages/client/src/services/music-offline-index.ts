import type { AudioQuality, AudioStreamSession, TrackSummary } from '@mu/shared';

/**
 * Offline music manifest — the device-local index of what is in the
 * `music-offline` Cache Storage cache. Kept dependency-free (no state/service
 * imports) so `music.service.ts` can fall back to it without import cycles.
 * The service worker (public/sw.js) reads the cache by the same keys.
 */

export const OFFLINE_CACHE = 'music-offline';
const STORAGE_KEY = 'mu_music_offline_v1';

/** Cache key for a track file's bytes (independent of profile / token query). */
export function offlineFileKey(trackFileId: string): string {
	return `/__mu-offline/track-file/${encodeURIComponent(trackFileId)}`;
}

export type OfflineGroupKind = 'album' | 'playlist' | 'track';

export interface OfflineTrack {
	track: TrackSummary;
	trackFileId: string;
	profile: AudioQuality;
	codec: string | null;
	bytes: number;
	/** Group keys (`album:<id>`, `playlist:<id>`, `track:<id>`) holding this track. */
	groups: string[];
	addedAt: number;
	lastUsedAt: number;
}

export interface OfflineGroup {
	key: string;
	kind: OfflineGroupKind;
	id: string;
	title: string;
	/** "Keep": never evicted by the size budget. */
	keep: boolean;
	trackIds: string[];
	addedAt: number;
}

export interface OfflineManifest {
	tracks: Record<string, OfflineTrack>;
	groups: Record<string, OfflineGroup>;
}

let current: OfflineManifest | null = null;

export function loadManifest(): OfflineManifest {
	if (current) return current;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as OfflineManifest) : null;
		current = parsed?.tracks && parsed.groups ? parsed : { tracks: {}, groups: {} };
	} catch {
		current = { tracks: {}, groups: {} };
	}
	return current;
}

export function saveManifest(m: OfflineManifest): void {
	current = m;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
	} catch {
		// Quota / private mode: keep the in-memory copy.
	}
}

/**
 * A synthetic stream session for a downloaded track, used when the server is
 * unreachable. The URL only needs the track file id: the service worker
 * serves `/music/files/<id>` from the offline cache regardless of query.
 */
export function offlineSession(trackId: string): AudioStreamSession | null {
	const t = loadManifest().tracks[trackId];
	if (!t) return null;
	return {
		sessionId: `${trackId}.offline`,
		ref: { type: 'track', id: trackId },
		trackFileId: t.trackFileId,
		streamUrl: `/api/v1/music/files/${encodeURIComponent(t.trackFileId)}?p=${t.profile}&c=`,
		profile: t.profile,
		original: t.profile === 'original',
		codec: t.codec,
		durationSeconds: t.track.durationSeconds,
		startPosition: 0,
		replayGainTrack: null,
		replayGainAlbum: null,
		waveformUrl: null,
	};
}

export function offlineTrackSummary(trackId: string): TrackSummary | null {
	return loadManifest().tracks[trackId]?.track ?? null;
}
