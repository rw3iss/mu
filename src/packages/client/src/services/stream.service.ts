import type { StreamSession } from '@/state/player.state';
import { api } from './api';

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

export const streamService = {
	/**
	 * Start a new stream session for a movie
	 */
	startStream(movieId: string): Promise<StreamSession> {
		return api.get<StreamSession>(`/stream/${movieId}/start`);
	},

	/**
	 * Check readiness of a streaming session
	 */
	getStreamStatus(sessionId: string): Promise<StreamStatus> {
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
	 * Update playback progress for a stream session
	 */
	updateProgress(sessionId: string, position: number): Promise<void> {
		return api.post<void>(`/stream/${sessionId}/progress`, { positionSeconds: position });
	},

	/**
	 * End a stream session
	 */
	endStream(sessionId: string): Promise<void> {
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
