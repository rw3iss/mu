import {
	type AudioQuality,
	type AudioStreamSession,
	DEFAULT_MUSIC_SETTINGS,
	type EntityRef,
	type ReplayGainMode,
	type TrackSummary,
} from '@mu/shared';
import { computed, effect, signal, untracked } from '@preact/signals';
import { audioEngine } from '@/audio/audio-engine';
import { getUiSetting, getUiSettingSignal, setUiSetting } from '@/hooks/useUiSetting';
import { musicService } from '@/services/music.service';
import { offlineTrackSummary } from '@/services/music-offline-index';
import {
	bassEnhanceEnabled,
	compressorEnabled,
	eqEnabled,
	hrtfSurroundEnabled,
	initAudioEffects,
	stereoWidthEnabled,
} from '@/state/audio-effects.state';
import { audioResetTrigger, clearAudioSuspect } from '@/state/audio-reset.state';
import {
	activeKind,
	activeRef,
	enterAudioShell,
	type PlayerMode,
	playerMode,
} from '@/state/globalPlayer.state';
import { notifyError } from '@/state/notifications.state';
import {
	currentTime,
	duration,
	isBuffering,
	isMuted,
	isPlaying,
	volume,
} from '@/state/player.state';
import {
	audioQueue,
	audioRepeat,
	audioShuffle,
	playNext,
	type QueueItem,
	queueItemKey,
	setAudioRepeat,
	setAudioShuffle,
	setQueue,
	takeFromQueue,
	takeNextFromQueue,
} from '@/state/queue.state';
import { shareMode } from '@/state/share.state';
import { audioAdapterHooks, audioPlayback } from './player/adapters/audioAdapter';
import type { PlayMediaOptions } from './player/types';

/**
 * Music playback state: now playing, queue/context, history, shuffle/repeat,
 * gapless advance, ReplayGain, progress reporting and refresh persistence.
 * The `<audio>` elements themselves live in `audioAdapter.ts`
 * (`audioPlayback`). See docs/music-support-plan.md §6.4.
 *
 * Entry points for pages: {@link playTracks}, {@link playAlbum},
 * {@link playArtist}, {@link playTrack}; or `playMedia(ref)` for any ref.
 */

// ============================================
// Types
// ============================================

export interface NowPlayingTrack {
	track: TrackSummary;
	artUrl: string | null;
	/** Server stream session; null until the stream has started. */
	session: AudioStreamSession | null;
}

export type PlaybackContextType = 'album' | 'playlist' | 'artist' | 'queue';

/** Where the current run of tracks came from (drives the list panel tabs). */
export interface PlaybackContext {
	type: PlaybackContextType;
	id: string | null;
	title: string;
}

interface PersistedAudioState {
	track: TrackSummary;
	position: number;
	context: PlaybackContext | null;
	contextTracks: TrackSummary[];
	mode: PlayerMode;
}

// ============================================
// Settings (per user, localStorage)
// ============================================

export const MUSIC_REPLAYGAIN_KEY = 'music_replaygain';
export const MUSIC_GAPLESS_KEY = 'music_gapless';
export const MUSIC_PROFILE_KEY = 'music_stream_profile';
export const MUSIC_RESUME_AFTER_VIDEO_KEY = 'music_resume_after_video';

export const musicReplayGain = getUiSettingSignal<ReplayGainMode>(
	MUSIC_REPLAYGAIN_KEY,
	DEFAULT_MUSIC_SETTINGS.replayGain,
);
export const musicGapless = getUiSettingSignal<boolean>(
	MUSIC_GAPLESS_KEY,
	DEFAULT_MUSIC_SETTINGS.gapless,
);
export const musicStreamProfile = getUiSettingSignal<AudioQuality>(
	MUSIC_PROFILE_KEY,
	DEFAULT_MUSIC_SETTINGS.defaultProfile,
);

// ============================================
// Signals
// ============================================

export const currentTrack = signal<NowPlayingTrack | null>(null);
export const playbackContext = signal<PlaybackContext | null>(null);
/** The full track list of the current context (album / playlist / artist). */
export const contextTracks = signal<TrackSummary[]>([]);
/** Previously played tracks, oldest first. Drives previous(). */
export const audioHistory = signal<TrackSummary[]>([]);
/** True while music owns the player shell. */
export const isAudioActive = computed(
	() => activeKind.value === 'audio' && currentTrack.value !== null,
);

/** List panel (full mode side panel) open state + selected tab. */
export type MusicPanelTab = 'upnext' | 'album' | 'playlist' | 'recommended' | 'lyrics';
export const musicPanelOpen = getUiSettingSignal<boolean>('music_panel_open', true);
export const musicPanelTab = getUiSettingSignal<MusicPanelTab>('music_panel_tab', 'upnext');

const AUDIO_STATE_KEY = 'mu_audio_state';
const UNSHUFFLED_KEY = 'play_queue_audio_unshuffled';
const HISTORY_MAX = 100;
const PRELOAD_SECONDS = 15;
const REPORT_INTERVAL_MS = 5000;

// ============================================
// Internals
// ============================================

const trackCache = new Map<string, TrackSummary>();
/** Bumped on every track change so stale async results are dropped. */
let loadSeq = 0;
/** Track id a gapless preload was requested for. */
let preloadFor: string | null = null;
let lastReportAt = 0;
/** Session whose completion was already reported (skip a stale re-report). */
let endedSessionId: string | null = null;
/** Music paused because a video started; restored when the video closes. */
let suspended: { wasPlaying: boolean; mode: PlayerMode } | null = null;

function rememberTracks(tracks: TrackSummary[]): void {
	for (const t of tracks) trackCache.set(t.id, t);
}

/** Queue row for a track (denormalised title / art, see QueueItem). */
export function trackToQueueItem(t: TrackSummary): QueueItem {
	rememberTracks([t]);
	return {
		ref: { type: 'track', id: t.id },
		title: t.title,
		subtitle: t.artistCredit ?? (t.artists.map((a) => a.name).join(', ') || null),
		artUrl: t.artUrl,
		durationSeconds: t.durationSeconds,
	};
}

async function resolveTrack(id: string): Promise<TrackSummary | null> {
	const cached = trackCache.get(id);
	if (cached) return cached;
	try {
		const t = await musicService.track(id);
		rememberTracks([t]);
		return t;
	} catch {
		// Offline: a downloaded track still has its summary on this device.
		return offlineTrackSummary(id);
	}
}

function shuffled<T>(list: T[]): T[] {
	const a = [...list];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j]!, a[i]!];
	}
	return a;
}

function pushHistory(t: TrackSummary): void {
	audioHistory.value = [...audioHistory.value, t].slice(-HISTORY_MAX);
}

function replayGainDbFor(session: AudioStreamSession | null): number | null {
	if (!session) return null;
	const mode = musicReplayGain.value;
	if (mode === 'track') return session.replayGainTrack ?? session.replayGainAlbum;
	if (mode === 'album') return session.replayGainAlbum ?? session.replayGainTrack;
	return null;
}

function applyReplayGain(): void {
	if (!audioPlayback.isActive()) return;
	audioEngine.setReplayGainDb(replayGainDbFor(currentTrack.value?.session ?? null));
}

function needsWebAudio(): boolean {
	return (
		eqEnabled.value ||
		compressorEnabled.value ||
		stereoWidthEnabled.value ||
		bassEnhanceEnabled.value ||
		hrtfSurroundEnabled.value ||
		musicReplayGain.value !== 'off'
	);
}

function syncEngine(): void {
	if (!audioPlayback.isActive()) return;
	if (needsWebAudio()) audioPlayback.attachToEngine();
	else audioPlayback.applyVolume();
}

function reportCurrent(completed: boolean): void {
	const session = currentTrack.value?.session;
	if (!session || session.sessionId === endedSessionId) return;
	if (audioPlayback.currentTrackId() !== currentTrack.value?.track.id) return;
	const pos = audioPlayback.position();
	musicService.reportProgress(session.sessionId, pos, completed).catch(() => {});
}

function currentPosition(): number {
	const cur = currentTrack.value;
	if (cur && audioPlayback.currentTrackId() === cur.track.id) return audioPlayback.position();
	return audioPlayback.isActive() ? currentTime.value : 0;
}

// ============================================
// Persistence
// ============================================

function persistNow(): void {
	if (shareMode.value) return;
	const cur = currentTrack.value;
	if (!cur) return;
	const state: PersistedAudioState = {
		track: cur.track,
		position: currentPosition(),
		context: playbackContext.value,
		contextTracks: contextTracks.value.slice(0, 300),
		mode: suspended?.mode ?? playerMode.value,
	};
	try {
		localStorage.setItem(AUDIO_STATE_KEY, JSON.stringify(state));
	} catch {
		// Storage full / unavailable.
	}
}

function readPersisted(): PersistedAudioState | null {
	try {
		const raw = localStorage.getItem(AUDIO_STATE_KEY);
		if (!raw) return null;
		const s = JSON.parse(raw) as PersistedAudioState;
		return s?.track?.id ? s : null;
	} catch {
		return null;
	}
}

function applyPersisted(saved: PersistedAudioState): void {
	rememberTracks([saved.track, ...(saved.contextTracks ?? [])]);
	currentTrack.value = { track: saved.track, artUrl: saved.track.artUrl, session: null };
	playbackContext.value = saved.context ?? null;
	contextTracks.value = saved.contextTracks ?? [];
}

// ============================================
// Core playback
// ============================================

interface PlayTrackOptions {
	startPosition?: number;
	autoplay?: boolean;
	/** Push the outgoing track onto the history stack (default true). */
	pushHistory?: boolean;
}

async function playTrackNow(track: TrackSummary, opts: PlayTrackOptions = {}): Promise<void> {
	const seq = ++loadSeq;
	const autoplay = opts.autoplay !== false;
	const start = Math.max(0, opts.startPosition ?? 0);
	suspended = null;
	rememberTracks([track]);
	// Report the outgoing session before its element is reused.
	reportCurrent(false);

	await enterAudioShell({ type: 'track', id: track.id });
	if (seq !== loadSeq) return;
	audioPlayback.setActive(true);

	const prev = currentTrack.value;
	if (opts.pushHistory !== false && prev && prev.track.id !== track.id) pushHistory(prev.track);
	currentTrack.value = { track, artUrl: track.artUrl, session: null };
	activeRef.value = { type: 'track', id: track.id };
	audioPlayback.clearPreload();
	preloadFor = null;
	endedSessionId = null;
	currentTime.value = start;
	duration.value = track.durationSeconds ?? 0;
	isBuffering.value = autoplay;
	persistNow();

	let session: AudioStreamSession;
	try {
		session = await musicService.startStream(track.id, { profile: musicStreamProfile.value });
	} catch (err) {
		if (seq !== loadSeq) return;
		isBuffering.value = false;
		isPlaying.value = false;
		const e = err as { body?: { message?: string }; message?: string };
		notifyError(e?.body?.message || e?.message || 'Failed to start playback');
		return;
	}
	if (seq !== loadSeq) return;
	currentTrack.value = { track, artUrl: track.artUrl, session };
	applyReplayGain();
	audioPlayback.load(track.id, session, start, autoplay);
	syncEngine();
	lastReportAt = Date.now();
}

/** Start the next queued track (or wrap for repeat-all). */
export async function next(fromEnded = false): Promise<void> {
	const item = takeNextFromQueue('audio') ?? refillForRepeat();
	if (!item) {
		// End of the run: leave the finished track paused at its end; play
		// restarts it.
		if (!fromEnded) notifyError('Nothing queued up next.');
		return;
	}
	const t = await resolveTrack(item.ref.id);
	if (!t) {
		notifyError(`Could not load "${item.title}".`);
		return;
	}
	await playTrackNow(t);
}

/** Restart the current track when >3s in, else go back to the previous one. */
export async function previous(): Promise<void> {
	if (currentPosition() > 3 || audioHistory.value.length === 0) {
		seekAudio(0);
		return;
	}
	const h = [...audioHistory.value];
	const prev = h.pop()!;
	audioHistory.value = h;
	const cur = currentTrack.value?.track;
	if (cur) playNext(trackToQueueItem(cur));
	await playTrackNow(prev, { pushHistory: false });
}

function refillForRepeat(): QueueItem | null {
	if (audioRepeat.value !== 'all') return null;
	const cur = currentTrack.value?.track;
	const fromContext = contextTracks.value.length > 0;
	const source = fromContext
		? contextTracks.value
		: [...audioHistory.value, ...(cur ? [cur] : [])];
	if (source.length === 0) return null;
	let items = source.map(trackToQueueItem);
	if (audioShuffle.value) {
		setUiSetting(UNSHUFFLED_KEY, items);
		items = shuffled(items);
	}
	if (!fromContext) audioHistory.value = [];
	const [first, ...rest] = items;
	setQueue('audio', rest);
	return first ?? null;
}

function handleEnded(): void {
	const cur = currentTrack.value;
	const session = cur?.session;
	if (session) {
		const total = duration.value || audioPlayback.position();
		musicService.reportProgress(session.sessionId, total, true).catch(() => {});
		endedSessionId = session.sessionId;
	}
	if (audioRepeat.value === 'one') {
		endedSessionId = null;
		audioPlayback.seek(0);
		audioPlayback.play();
		return;
	}
	// Gapless: the next queue item is already buffered on the idle element.
	const upNext = audioQueue.value[0];
	if (musicGapless.value && upNext && audioPlayback.preloadedTrackId() === upNext.ref.id) {
		const t = trackCache.get(upNext.ref.id);
		if (t) {
			takeNextFromQueue('audio');
			const s = audioPlayback.swapToPreloaded();
			if (s) {
				loadSeq++;
				if (cur) pushHistory(cur.track);
				currentTrack.value = { track: t, artUrl: t.artUrl, session: s };
				activeRef.value = { type: 'track', id: t.id };
				preloadFor = null;
				endedSessionId = null;
				lastReportAt = Date.now();
				applyReplayGain();
				persistNow();
				return;
			}
		}
	}
	void next(true);
}

function handleTick(pos: number, total: number): void {
	const now = Date.now();
	if (now - lastReportAt >= REPORT_INTERVAL_MS) {
		lastReportAt = now;
		reportCurrent(false);
		persistNow();
	}
	if (!musicGapless.value || audioRepeat.value === 'one' || !total) return;
	if (total - pos > PRELOAD_SECONDS) return;
	const upNext = audioQueue.value[0];
	if (!upNext || preloadFor === upNext.ref.id) return;
	const id = upNext.ref.id;
	preloadFor = id;
	const seq = loadSeq;
	void (async () => {
		const t = await resolveTrack(id);
		if (!t) return;
		const s = await musicService
			.startStream(id, { profile: musicStreamProfile.value })
			.catch(() => null);
		if (!s || seq !== loadSeq || preloadFor !== id) return;
		audioPlayback.preload(id, s);
	})();
}

// ============================================
// Public actions
// ============================================

/**
 * Play a list of tracks starting at `startIndex`. The audio queue is replaced
 * with the tracks after it; `context` labels the run (album / playlist /
 * artist) for the list panel.
 */
export async function playTracks(
	tracks: TrackSummary[],
	startIndex = 0,
	context?: PlaybackContext,
): Promise<void> {
	if (tracks.length === 0) return;
	const i = Math.max(0, Math.min(startIndex, tracks.length - 1));
	rememberTracks(tracks);
	const rest = tracks.slice(i + 1).map(trackToQueueItem);
	if (audioShuffle.value) {
		setUiSetting(UNSHUFFLED_KEY, rest);
		setQueue('audio', shuffled(rest));
	} else {
		setQueue('audio', rest);
	}
	playbackContext.value = context ?? { type: 'queue', id: null, title: 'Queue' };
	contextTracks.value = tracks;
	await playTrackNow(tracks[i]!);
}

/** Play an album from the top, or from `startTrackId`. */
export async function playAlbum(albumId: string, startTrackId?: string): Promise<void> {
	try {
		const album = await musicService.album(albumId);
		const idx = startTrackId ? album.tracks.findIndex((t) => t.id === startTrackId) : 0;
		await playTracks(album.tracks, Math.max(0, idx), {
			type: 'album',
			id: album.id,
			title: album.title,
		});
	} catch {
		notifyError('Could not load this album.');
	}
}

/** Play an artist's popular tracks. */
export async function playArtist(artistId: string): Promise<void> {
	try {
		const artist = await musicService.artist(artistId);
		if (artist.popularTracks.length === 0) {
			notifyError('No tracks for this artist yet.');
			return;
		}
		await playTracks(artist.popularTracks, 0, {
			type: 'artist',
			id: artist.id,
			title: artist.name,
		});
	} catch {
		notifyError('Could not load this artist.');
	}
}

/** Play one track now. The queue is left as it is. */
export async function playTrack(track: TrackSummary, opts?: PlayMediaOptions): Promise<void> {
	playbackContext.value = { type: 'queue', id: null, title: 'Queue' };
	contextTracks.value = [];
	await playTrackNow(track, { startPosition: opts?.fromBeginning ? 0 : undefined });
}

export async function playTrackById(trackId: string, opts?: PlayMediaOptions): Promise<void> {
	const t = await resolveTrack(trackId);
	if (!t) {
		notifyError('Could not load this track.');
		return;
	}
	await playTrack(t, opts);
}

/** Jump to an Up Next entry (dropping everything ahead of it); context kept. */
export async function playQueued(item: QueueItem): Promise<void> {
	const taken = takeFromQueue(item.ref);
	if (!taken) return;
	const t = await resolveTrack(taken.ref.id);
	if (!t) {
		notifyError(`Could not load "${taken.title}".`);
		return;
	}
	await playTrackNow(t);
}

/** `playMedia` entry for audio refs (track / album / artist). */
export async function playAudioRef(ref: EntityRef, opts?: PlayMediaOptions): Promise<void> {
	if (ref.type === 'album') return playAlbum(ref.id);
	if (ref.type === 'artist') return playArtist(ref.id);
	return playTrackById(ref.id, opts);
}

export function toggleAudioPlay(): void {
	const cur = currentTrack.value;
	if (!cur) return;
	audioEngine.ensureContext();
	const loaded = cur.session && audioPlayback.currentTrackId() === cur.track.id;
	if (!loaded) {
		// Restored after a refresh / failed start: create the stream now.
		void playTrackNow(cur.track, { startPosition: currentTime.value, pushHistory: false });
		return;
	}
	if (audioPlayback.isPaused()) audioPlayback.play();
	else audioPlayback.pause();
}

export function seekAudio(t: number): void {
	audioPlayback.seek(t);
	persistNow();
}

export function skipAudio(deltaSeconds: number): void {
	seekAudio(currentPosition() + deltaSeconds);
}

/** Shuffle on: Fisher-Yates the remaining queue. Off: restore its original order. */
export function toggleShuffle(): void {
	const on = !audioShuffle.value;
	const q = audioQueue.value;
	if (on) {
		setUiSetting(UNSHUFFLED_KEY, q);
		setQueue('audio', shuffled(q));
	} else {
		const orig = getUiSetting<QueueItem[]>(UNSHUFFLED_KEY, []);
		const inQueue = new Set(q.map(queueItemKey));
		const restored = orig.filter((i) => inQueue.has(queueItemKey(i)));
		const seen = new Set(restored.map(queueItemKey));
		for (const i of q) if (!seen.has(queueItemKey(i))) restored.push(i);
		setQueue('audio', restored);
		setUiSetting(UNSHUFFLED_KEY, []);
	}
	setAudioShuffle(on);
	audioPlayback.clearPreload();
	preloadFor = null;
}

/** off → all → one → off. */
export function cycleRepeat(): void {
	const order = ['off', 'all', 'one'] as const;
	const idx = order.indexOf(audioRepeat.value);
	setAudioRepeat(order[(idx + 1) % order.length]!);
}

/** Change stream quality; restarts the current track at the same position. */
export function setStreamProfile(profile: AudioQuality): void {
	setUiSetting(MUSIC_PROFILE_KEY, profile);
	const cur = currentTrack.value;
	if (!cur?.session) return;
	const pos = currentPosition();
	const wasPlaying = !audioPlayback.isPaused();
	void playTrackNow(cur.track, { startPosition: pos, autoplay: wasPlaying, pushHistory: false });
}

/** Stop music entirely (closing the audio player). The queue is kept. */
export function stopMusic(): void {
	loadSeq++;
	reportCurrent(false);
	audioPlayback.stop();
	audioPlayback.setActive(false);
	audioEngine.setReplayGainDb(null);
	suspended = null;
	preloadFor = null;
	currentTrack.value = null;
	playbackContext.value = null;
	contextTracks.value = [];
	audioHistory.value = [];
	isPlaying.value = false;
	isBuffering.value = false;
	currentTime.value = 0;
	duration.value = 0;
	try {
		localStorage.removeItem(AUDIO_STATE_KEY);
	} catch {}
}

// ── Video interplay (plan §6.4 "Closed") ──

/** A video is starting: pause music and remember to resume it afterwards. */
export function suspendMusicForVideo(): void {
	if (!currentTrack.value) return;
	suspended = { wasPlaying: !audioPlayback.isPaused(), mode: playerMode.value };
	reportCurrent(false);
	persistNow();
	// Release the shared signals first so the pause event can't touch them.
	audioPlayback.setActive(false);
	audioPlayback.pause();
	audioEngine.setReplayGainDb(null);
}

/**
 * The video player closed. Bring the music shell back (playing again if it
 * was, and the user's "resume after video" setting is on). Returns true when
 * the audio shell was restored.
 */
export function resumeMusicAfterVideo(): boolean {
	const s = suspended;
	suspended = null;
	const cur = currentTrack.value;
	if (!s || !cur) return false;
	const resume = getUiSetting<boolean>(
		MUSIC_RESUME_AFTER_VIDEO_KEY,
		DEFAULT_MUSIC_SETTINGS.resumeAfterVideo,
	);
	if (!resume) {
		stopMusic();
		return false;
	}
	activeKind.value = 'audio';
	activeRef.value = { type: 'track', id: cur.track.id };
	playerMode.value = s.mode === 'hidden' ? 'mini' : s.mode;
	audioPlayback.setActive(true);
	applyReplayGain();
	syncEngine();
	if (s.wasPlaying) toggleAudioPlay();
	return true;
}

/** Restore the last music session paused on reload. Returns true if restored. */
export function restoreMusicPlayer(): boolean {
	if (shareMode.value) return false;
	const saved = readPersisted();
	if (!saved) return false;
	applyPersisted(saved);
	// The app starts in music mode, so the video engine (which normally loads
	// the saved EQ / compressor state) never mounts — load it here.
	initAudioEffects();
	activeKind.value = 'audio';
	activeRef.value = { type: 'track', id: saved.track.id };
	playerMode.value = saved.mode && saved.mode !== 'hidden' ? saved.mode : 'mini';
	audioPlayback.setActive(true);
	currentTime.value = saved.position || 0;
	duration.value = saved.track.durationSeconds ?? 0;
	// Prepare the stream paused so seeking and the waveform work at once.
	void playTrackNow(saved.track, {
		startPosition: saved.position || 0,
		autoplay: false,
		pushHistory: false,
	});
	return true;
}

/**
 * A video was restored on reload while a music session was also saved:
 * keep the music behind it (paused) so closing the video brings it back.
 */
export function noteMusicBehindVideo(): void {
	if (shareMode.value) return;
	const saved = readPersisted();
	if (!saved) return;
	applyPersisted(saved);
	suspended = { wasPlaying: false, mode: saved.mode || 'mini' };
}

// ============================================
// Init
// ============================================

let initialized = false;

/** Wire hooks + reactive effects. Called once from initGlobalPlayer. */
export function initMusicPlayer(): void {
	if (initialized) return;
	initialized = true;

	audioAdapterHooks.onEnded = handleEnded;
	audioPlayback.setHooks({
		onEnded: handleEnded,
		onTick: handleTick,
		onPause: () => {
			reportCurrent(false);
			persistNow();
		},
		onError: (message) => {
			isPlaying.value = false;
			notifyError(message);
		},
	});

	// Engine attachment + volume. Effects or ReplayGain need Web Audio; once
	// on the bus an element stays there (browser constraint).
	effect(() => {
		void volume.value;
		void isMuted.value;
		const needs = needsWebAudio();
		const owns = isAudioActive.value;
		untracked(() => {
			if (owns && needs) audioPlayback.attachToEngine();
			else audioPlayback.applyVolume();
		});
	});

	// ReplayGain mode changed in settings → re-apply to the current track.
	effect(() => {
		void musicReplayGain.value;
		untracked(applyReplayGain);
	});

	// "Reset Audio" while music owns the shell: the video engine's reset path
	// is disabled then, so rebuild the audio elements here.
	let lastReset = audioResetTrigger.value;
	effect(() => {
		const tick = audioResetTrigger.value;
		if (tick === lastReset) return;
		lastReset = tick;
		untracked(() => {
			if (!isAudioActive.value) return;
			audioPlayback.resetElements();
			clearAudioSuspect();
			syncEngine();
		});
	});

	window.addEventListener('beforeunload', () => {
		reportCurrent(false);
		persistNow();
	});
}
