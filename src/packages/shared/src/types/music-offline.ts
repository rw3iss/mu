import type { AudioQuality } from './music.js';

/** What the current user may do with offline music (`GET /music/offline/policy`). */
export interface MusicOfflinePolicy {
	allowed: boolean;
	/** Profile downloads are encoded at (admin `offline.downloadProfile`). */
	profile: AudioQuality;
	/** Admin cap per device; the user's own limit can only be lower. */
	maxOfflineGbPerDevice: number;
}

/** One signed download (`POST /music/offline/token`). */
export interface MusicOfflineItem {
	trackId: string;
	trackFileId: string;
	/** Short-lived signed URL (`/api/v1/music/offline/files/...?t=`); no JWT needed. */
	url: string;
	profile: AudioQuality;
	codec: string | null;
	durationSeconds: number | null;
}

export interface MusicOfflineTokenResponse {
	items: MusicOfflineItem[];
	/** Track ids with no playable file. */
	missing: string[];
	/** ISO time the URLs stop working. */
	expiresAt: string;
	policy: MusicOfflinePolicy;
}
