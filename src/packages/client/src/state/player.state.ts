import { DEFAULT_THUMBNAIL_SIZE, type ThumbnailSize } from '@mu/shared';
import { signal } from '@preact/signals';
import { getUiSetting } from '@/hooks/useUiSetting';
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
	/** Server-persisted default for this movie. */
	default?: boolean;
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

/**
 * Sentinel for "the user explicitly turned subtitles OFF".
 *
 * Previously OFF deleted the key, which is indistinguishable from "never
 * chose" — so a refresh fell back to the server default and silently switched
 * subtitles back on. Storing the intent explicitly keeps OFF sticky.
 */
export const SUBTITLE_OFF = 'off';

/** Save the selected subtitle track for a movie so it persists across refreshes. */
export function saveSubtitleChoice(movieId: string, trackId: string | null): void {
	subtitleTrack.value = trackId;
	try {
		localStorage.setItem(`mu_subtitle_${movieId}`, trackId ?? SUBTITLE_OFF);
	} catch {
		/* ignore */
	}
}

/**
 * Restore the previously selected subtitle track for a movie.
 *
 * Order: explicit OFF → saved track (if still present) → server default →
 * nothing. `availableTracks` must be the CURRENT session list; calling this
 * before the session has loaded would otherwise look like "saved track is
 * gone" and turn subtitles off.
 */
export function restoreSubtitleChoice(movieId: string, availableTracks: SubtitleTrack[]): void {
	try {
		const saved = localStorage.getItem(`mu_subtitle_${movieId}`);
		if (saved === SUBTITLE_OFF) {
			subtitleTrack.value = null;
			return;
		}
		if (saved && availableTracks.some((t) => t.id === saved)) {
			subtitleTrack.value = saved;
			return;
		}
		// Migrate values written by the old client, which stored `sub-<index>`
		// while the server issues a bare `<index>`. Without this every existing
		// saved choice would silently resolve to "off" once.
		if (saved?.startsWith('sub-')) {
			const legacy = saved.slice(4);
			if (availableTracks.some((t) => t.id === legacy)) {
				subtitleTrack.value = legacy;
				localStorage.setItem(`mu_subtitle_${movieId}`, legacy);
				return;
			}
		}
		// No usable stored choice (never set, or the track was deleted) — fall
		// back to the movie's server-side default subtitle if one is set.
		const def = availableTracks.find((t) => t.default);
		subtitleTrack.value = def ? def.id : null;
	} catch {
		subtitleTrack.value = null;
	}
}

/**
 * Rebuild `currentSession.subtitles` from the server's authoritative track
 * list and return it.
 *
 * The session's subtitle list is a snapshot taken when playback started, so it
 * goes stale the moment a subtitle is downloaded or deleted. Call sites used to
 * patch it by hand and invent ids (`sub-<i>`), but the server issues
 * `String(track.index)` — the two never matched, which is why a saved choice
 * never restored and why selecting a freshly downloaded track could resolve to
 * a different file. Ids and URLs here are derived exactly as the server does,
 * from `index`, never from array position.
 */
export async function refreshSessionSubtitles(movieId: string): Promise<SubtitleTrack[]> {
	const session = currentSession.value;
	if (!session) return [];
	const { subtitlesService } = await import('@/services/subtitles.service');
	const { subtitles } = await subtitlesService.list(movieId);
	// Cache-buster. The .vtt route is served with `max-age=86400`, but a
	// download makes the server re-index every track — so the SAME URL starts
	// resolving to a different subtitle and the browser replays the stale one.
	// Stamping the rebuild makes each generation a distinct URL, which also
	// re-triggers the player's load effect.
	const rev = Date.now();
	const tracks: SubtitleTrack[] = subtitles.map((t) => ({
		id: String(t.index),
		label: t.label,
		language: t.language,
		url: `/api/v1/stream/${session.sessionId}/subtitles/${t.index}.vtt?v=${rev}`,
		default: t.default,
	}));
	// Re-read: the session can be replaced while the request is in flight.
	const live = currentSession.value;
	if (live && live.sessionId === session.sessionId) {
		currentSession.value = { ...live, subtitles: tracks };
	}
	return tracks;
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
	/** Size the server actually served (resolver may downgrade
	 *  smaller→larger if only a bigger cache exists). Used by the
	 *  client to build sheet URLs that hit the same size. */
	size?: ThumbnailSize;
	/** Echoed by the server: what the client asked for. Distinct from
	 *  `size` when the resolver fell back to a different cached size. */
	requestedSize?: ThumbnailSize;
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

	// Fetch sprite sheet metadata for seek previews (non-blocking).
	// Size is the user's preferred thumbnail size; server resolves
	// to the best stored size at or above that, falling back to
	// queuing regeneration when nothing acceptable is cached.
	spriteMeta.value = null;
	const size = getUiSetting<ThumbnailSize>('thumbnail_size', DEFAULT_THUMBNAIL_SIZE);
	fetch(`/api/v1/media/sprites/${movieId}/meta.json?size=${encodeURIComponent(size)}`)
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

/**
 * Clamp to a usable 0..1 gain.
 *
 * `Math.max(0, Math.min(1, NaN))` is NaN — every NaN comparison is false — so a
 * plain clamp happily lets a bad value through. That NaN then reaches
 * `video.volume` and the master GainNode, silencing playback for *every* movie.
 * Because the value is persisted to `mu_volume`, the silence survives a hard
 * refresh and ignores "Reset Audio" (which rebuilds the engine, not the volume),
 * which makes it look like the audio stack died. Anything non-finite falls back
 * to `fallback` rather than poisoning the chain.
 */
export function clampVolume(v: number, fallback = 1): number {
	if (!Number.isFinite(v)) return fallback;
	return Math.max(0, Math.min(1, v));
}

export function setVolume(v: number): void {
	const next = clampVolume(v, volume.value);
	volume.value = next;
	if (next > 0) {
		isMuted.value = false;
	}
	localStorage.setItem('mu_volume', String(next));
}

export function toggleMute(): void {
	isMuted.value = !isMuted.value;
}

export function initPlayerSettings(): void {
	const savedVolume = localStorage.getItem('mu_volume');
	if (savedVolume === null) return;
	const parsed = Number.parseFloat(savedVolume);
	if (!Number.isFinite(parsed)) {
		// Self-heal: a poisoned key would otherwise silence the app forever.
		console.warn(`[player] Discarding invalid mu_volume=${savedVolume}; resetting to 1`);
		localStorage.removeItem('mu_volume');
		volume.value = 1;
		return;
	}
	volume.value = clampVolume(parsed);
}
