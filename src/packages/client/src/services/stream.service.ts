import type { StreamSession } from '@/state/player.state';
import { shareToken } from '@/state/share.state';
import { api } from './api';

/** Build a URL query-string credential to append to streaming URLs (HLS / native video). */
function buildStreamUrlCredential(): string {
	const share = shareToken.value;
	if (share) return `shareToken=${encodeURIComponent(share)}`;
	const token = localStorage.getItem('mu_token');
	return `token=${encodeURIComponent(token || '')}`;
}

// ============================================
// Remote movie ID helpers
// ============================================

function parseRemoteId(movieId: string): { serverId: string; remoteMovieId: string } | null {
	if (!movieId.startsWith('remote:')) return null;
	const parts = movieId.split(':');
	if (parts.length < 3) return null;
	return { serverId: parts[1]!, remoteMovieId: parts.slice(2).join(':') };
}

// ============================================
// Types
// ============================================

export interface ActiveSession {
	sessionId: string;
	userId: string;
	username: string;
	displayName?: string | null;
	movieId: string;
	movieTitle: string;
	position: number;
	startedAt: string;
	lastActivity: string;
	/** Originating client IP captured at session start. Null for
	 * sessions created before the column was added, or for share
	 * viewers that bypass the session-tracking branch. */
	ipAddress?: string | null;
}

export interface SessionHistoryEntry {
	id: string;
	userId: string;
	username: string | null;
	displayName?: string | null;
	movieId: string;
	movieTitle: string | null;
	movieYear: number | null;
	watchedAt: string;
	durationWatchedSeconds: number | null;
	completed: boolean | null;
	positionSeconds: number | null;
	isActive: boolean;
}

// ============================================
// Stream Service
// ============================================

export interface StreamStatus {
	state: 'preparing' | 'running' | 'completed' | 'failed';
	ready: boolean;
	error?: string;
}

export interface StreamInfo {
	streamMode: string;
	needsTranscode: boolean;
	hasCache: boolean;
	codecVideo: string | null;
	codecAudio: string | null;
	videoHeight: number | null;
}

/**
 * Whether this browser can decode HEVC/H.265 natively (computed once).
 * Safari, Chrome/Edge on Windows with the HEVC Video Extensions, and Macs
 * return non-empty; Chrome/Firefox on Linux return ''. When true we tell the
 * server (`?hevc=1`) so HEVC-in-MP4 files direct-play instead of transcoding.
 */
const SUPPORTS_HEVC: boolean = (() => {
	try {
		const v = document.createElement('video');
		return (
			v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '' ||
			v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== '' ||
			v.canPlayType('video/mp4; codecs="hvc1"') !== ''
		);
	} catch {
		return false;
	}
})();

export const streamService = {
	/**
	 * Get stream mode info for a movie (needs transcode, has cache, etc.)
	 */
	getStreamInfo(movieId: string): Promise<StreamInfo> {
		return api.get<StreamInfo>(`/stream/info/${movieId}`);
	},

	/**
	 * Send a heartbeat to keep a stream session alive during pause.
	 */
	heartbeat(sessionId: string): Promise<{ ok: boolean }> {
		return api.post(`/stream/${sessionId}/heartbeat`);
	},

	/**
	 * Delete a cached transcode for a movie at a specific quality.
	 */
	deleteCachedVersion(movieId: string, quality: string): Promise<{ success: boolean }> {
		return api.delete(`/stream/cache/${movieId}/${quality}`);
	},

	/**
	 * Start a new stream session for a movie.
	 * For remote movies, routes through the local proxy.
	 */
	startStream(movieId: string, options?: { audioTrack?: number }): Promise<StreamSession> {
		const remote = parseRemoteId(movieId);
		if (remote) {
			return api.get<StreamSession>(
				`/remote/stream/${remote.serverId}/${remote.remoteMovieId}/start`,
			);
		}
		const params = new URLSearchParams();
		if (options?.audioTrack != null) params.set('audioTrack', String(options.audioTrack));
		if (SUPPORTS_HEVC) params.set('hevc', '1');
		const qs = params.toString();
		return api.get<StreamSession>(`/stream/${movieId}/start${qs ? `?${qs}` : ''}`);
	},

	/**
	 * Check readiness of a streaming session.
	 * Remote sessions report as always ready.
	 */
	getStreamStatus(sessionId: string): Promise<StreamStatus> {
		if (sessionId.startsWith('remote:'))
			return Promise.resolve({ state: 'running', ready: true });
		return api.get<StreamStatus>(`/stream/${sessionId}/status`);
	},

	/**
	 * Poll until the stream is ready (first segment available) or failed.
	 * Calls onStatus on each poll so the UI can show progress.
	 * Returns true if ready, false if failed.
	 */
	async waitForReady(
		sessionId: string,
		onStatus?: (status: StreamStatus) => void,
		maxWaitMs: number = 120_000,
	): Promise<boolean> {
		const start = Date.now();
		const interval = 2000;

		while (Date.now() - start < maxWaitMs) {
			try {
				const status = await this.getStreamStatus(sessionId);
				if (onStatus) onStatus(status);

				if (status.ready) return true;
				if (status.state === 'failed') return false;
			} catch {
				// Network hiccup — keep trying
			}
			await new Promise((r) => setTimeout(r, interval));
		}

		return false;
	},

	/**
	 * Update playback progress for a stream session.
	 * No-op for remote sessions (progress is not tracked cross-server).
	 */
	updateProgress(sessionId: string, position: number): Promise<void> {
		if (sessionId.startsWith('remote:')) return Promise.resolve();
		return api.post<void>(`/stream/${sessionId}/progress`, { positionSeconds: position });
	},

	/**
	 * Restart transcoding from a new seek position.
	 */
	seekStream(sessionId: string, positionSeconds: number): Promise<void> {
		if (sessionId.startsWith('remote:')) return Promise.resolve();
		return api.post<void>(`/stream/${sessionId}/seek`, { positionSeconds });
	},

	/**
	 * End a stream session.
	 * No-op for remote sessions.
	 */
	endStream(sessionId: string): Promise<void> {
		if (sessionId.startsWith('remote:')) return Promise.resolve();
		return api.delete<void>(`/stream/${sessionId}`);
	},

	/**
	 * Get all active stream sessions (admin)
	 */
	getActiveSessions(): Promise<ActiveSession[]> {
		return api.get<ActiveSession[]>('/stream/sessions');
	},

	/**
	 * End a specific session (admin)
	 */
	endSession(sessionId: string): Promise<void> {
		return api.delete<void>(`/admin/sessions/${sessionId}`);
	},

	/**
	 * End all sessions except the current user's (admin)
	 */
	endAllSessions(): Promise<{ endedCount: number }> {
		return api.delete<{ endedCount: number }>('/admin/sessions');
	},

	/**
	 * Get session history — past watch records across all users (admin)
	 */
	getSessionHistory(): Promise<SessionHistoryEntry[]> {
		return api.get<SessionHistoryEntry[]>('/admin/session-history');
	},

	/**
	 * Clear all session history except currently-active sessions (admin)
	 */
	clearSessionHistory(): Promise<{ clearedCount: number; preservedCount: number }> {
		return api.delete<{ clearedCount: number; preservedCount: number }>(
			'/admin/session-history',
		);
	},

	/**
	 * Generate thumbnails for all movies missing one (admin)
	 */
	generateMissingThumbnails(): Promise<{ movieCount: number }> {
		return api.post<{ movieCount: number }>('/admin/generate-missing-thumbnails');
	},

	/**
	 * Get the stream URL for direct playback
	 */
	getStreamUrl(sessionId: string): string {
		return `/api/v1/stream/${sessionId}/media?${buildStreamUrlCredential()}`;
	},

	/**
	 * Get subtitle file URL
	 */
	getSubtitleUrl(sessionId: string, trackId: string): string {
		return `/api/v1/stream/${sessionId}/subtitles/${trackId}?${buildStreamUrlCredential()}`;
	},

	/**
	 * Direct-download URL for a movie's source file. The browser streams it
	 * natively (resumable), and the server sets a `Title (Year).<ext>`
	 * filename. Auth rides on the `?token=` query credential, like the other
	 * media URLs, since a native download can't attach an Authorization header.
	 */
	getDownloadUrl(movieId: string): string {
		return `/api/v1/stream/download/${encodeURIComponent(movieId)}?${buildStreamUrlCredential()}`;
	},
};
