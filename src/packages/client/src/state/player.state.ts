import { signal } from '@preact/signals';
import { streamService } from '@/services/stream.service';

// ============================================
// Types
// ============================================

export interface StreamSession {
	sessionId: string;
	movieId: string;
	streamUrl: string;
	directPlay: boolean;
	ready: boolean;
	format: string;
	subtitles: SubtitleTrack[];
	audioTracks: AudioTrack[];
	qualities: QualityOption[];
	startPosition: number;
	durationSeconds?: number | null;
}

export interface SubtitleTrack {
	id: string;
	label: string;
	language: string;
	url: string;
}

export interface AudioTrack {
	id: string;
	label: string;
	language: string;
	channels: number;
}

export interface QualityOption {
	label: string;
	height: number;
	bitrate: number;
}

// ============================================
// Signals
// ============================================

export const currentSession = signal<StreamSession | null>(null);
export const isPlaying = signal(false);
export const currentTime = signal(0);
export const duration = signal(0);
export const volume = signal(1);
export const isMuted = signal(false);
export const isFullscreen = signal(false);
export const quality = signal<string>('auto');
export const subtitleTrack = signal<string | null>(null);

/** Save the selected subtitle track for a movie so it persists across refreshes. */
export function saveSubtitleChoice(movieId: string, trackId: string | null): void {
	subtitleTrack.value = trackId;
	try {
		if (trackId) {
			localStorage.setItem(`mu_subtitle_${movieId}`, trackId);
		} else {
			localStorage.removeItem(`mu_subtitle_${movieId}`);
		}
	} catch {
		/* ignore */
	}
}

/** Restore the previously selected subtitle track for a movie. */
export function restoreSubtitleChoice(movieId: string, availableTracks: SubtitleTrack[]): void {
	try {
		const saved = localStorage.getItem(`mu_subtitle_${movieId}`);
		if (saved && availableTracks.some((t) => t.id === saved)) {
			subtitleTrack.value = saved;
		} else {
			subtitleTrack.value = null;
		}
	} catch {
		subtitleTrack.value = null;
	}
}
export const audioTrack = signal<string | null>(null);

/** Save the selected audio track for a movie so it persists across refreshes. */
export function saveAudioTrackChoice(movieId: string, trackIndex: string | null): void {
	audioTrack.value = trackIndex;
	try {
		if (trackIndex) {
			localStorage.setItem(`mu_audiotrack_${movieId}`, trackIndex);
		} else {
			localStorage.removeItem(`mu_audiotrack_${movieId}`);
		}
	} catch {
		/* ignore */
	}
}

/** Restore the previously selected audio track for a movie. */
export function restoreAudioTrackChoice(movieId: string, availableTracks: AudioTrack[]): void {
	try {
		const saved = localStorage.getItem(`mu_audiotrack_${movieId}`);
		if (saved && availableTracks.some((t) => String(t.id) === saved)) {
			audioTrack.value = saved;
		} else {
			audioTrack.value = null;
		}
	} catch {
		audioTrack.value = null;
	}
}

export const isBuffering = signal(false);
export const showControls = signal(true);
export const isHoveringControls = signal(false);
export const showInfoPanel = signal(false);
export const streamError = signal<string | null>(null);

// Seek sprite metadata (loaded when stream starts)
export interface SpriteMeta {
	interval: number;
	frameWidth: number;
	frameHeight: number;
	columns: number;
	rows: number;
	sheetCount: number;
	totalFrames: number;
}
export const spriteMeta = signal<SpriteMeta | null>(null);

// ============================================
// Actions
// ============================================

export async function startStream(
	movieId: string,
	options?: { audioTrack?: number },
): Promise<StreamSession> {
	const session = await streamService.startStream(movieId, options);
	currentSession.value = session;
	currentTime.value = session.startPosition || 0;

	// Fetch sprite sheet metadata for seek previews (non-blocking)
	spriteMeta.value = null;
	fetch(`/api/v1/media/sprites/${movieId}/meta.json`)
		.then((r) => (r.ok ? r.json() : null))
		.then((meta) => {
			if (meta) spriteMeta.value = meta;
		})
		.catch(() => {});

	return session;
}

export async function updateProgress(position: number): Promise<void> {
	const session = currentSession.value;
	if (!session) return;

	currentTime.value = position;

	try {
		await streamService.updateProgress(session.sessionId, position);
	} catch (error) {
		console.error('Failed to update progress:', error);
	}
}

export async function endStream(): Promise<void> {
	const session = currentSession.value;
	if (!session) return;

	try {
		// Send final position so history is recorded even for short views
		if (currentTime.value > 0) {
			await streamService
				.updateProgress(session.sessionId, currentTime.value)
				.catch(() => {});
		}
		await streamService.endStream(session.sessionId);
	} catch (error) {
		console.error('Failed to end stream:', error);
	} finally {
		currentSession.value = null;
		isPlaying.value = false;
		currentTime.value = 0;
		duration.value = 0;
	}
}

export function setVolume(v: number): void {
	volume.value = Math.max(0, Math.min(1, v));
	if (v > 0) {
		isMuted.value = false;
	}
	localStorage.setItem('mu_volume', String(volume.value));
}

export function toggleMute(): void {
	isMuted.value = !isMuted.value;
}

export function initPlayerSettings(): void {
	const savedVolume = localStorage.getItem('mu_volume');
	if (savedVolume !== null) {
		volume.value = parseFloat(savedVolume);
	}
}
