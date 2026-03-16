import type { StreamSession } from '@/state/player.state';
import { api } from './api';

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
	movieId: string;
	movieTitle: string;
	position: number;
	startedAt: string;
	lastActivity: string;
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

export const streamService = {
	/**
	 * Get stream mode info for a movie (needs transcode, has cache, etc.)
	 */
	getStreamInfo(movieId: string): Promise<StreamInfo> {
		return api.get<StreamInfo>(`/stream/info/${movieId}`);
	},

	/**
	 * Start a new stream session for a movie.
	 * For remote movies, routes through the local proxy.
	 */
	startStream(movieId: string): Promise<StreamSession> {
		const remote = parseRemoteId(movieId);
		if (remote) {
			return api.get<StreamSession>(
				`/remote/stream/${remote.serverId}/${remote.remoteMovieId}/start`,
			);
		}
		return api.get<StreamSession>(`/stream/${movieId}/start`);
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
	 * Generate thumbnails for all movies missing one (admin)
	 */
	generateMissingThumbnails(): Promise<{ movieCount: number }> {
		return api.post<{ movieCount: number }>('/admin/generate-missing-thumbnails');
	},

	/**
	 * Get the stream URL for direct playback
	 */
	getStreamUrl(sessionId: string): string {
		const token = localStorage.getItem('mu_token');
		return `/api/v1/stream/${sessionId}/media?token=${encodeURIComponent(token || '')}`;
	},

	/**
	 * Get subtitle file URL
	 */
	getSubtitleUrl(sessionId: string, trackId: string): string {
		const token = localStorage.getItem('mu_token');
		return `/api/v1/stream/${sessionId}/subtitles/${trackId}?token=${encodeURIComponent(token || '')}`;
	},
};
