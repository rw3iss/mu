import { effect } from '@preact/signals';
import { getActiveVideoElement } from '@/components/player/useVideoEngine';
import { activeKind, globalMovie, playerSeek } from '@/state/globalPlayer.state';
import {
	currentTrack,
	next as nextTrack,
	previous as previousTrack,
	seekAudio,
	toggleAudioPlay,
} from '@/state/musicPlayer.state';
import { audioPlayback } from '@/state/player/adapters/audioAdapter';
import { currentTime, duration, isPlaying } from '@/state/player.state';
import { artAtSize } from '@/utils/music-art';

/**
 * OS media integration via the MediaSession API — lock-screen / notification /
 * headset controls and now-playing metadata.
 *
 * Unlike Picture-in-Picture this is well supported on BOTH Chrome for Android
 * and iOS Safari, so it's the piece that actually works on a phone: the movie's
 * title and poster appear on the lock screen and the hardware/notification
 * play-pause and seek buttons drive the player.
 *
 * Everything is feature-detected and wrapped — an unsupported browser is a
 * silent no-op, never an error.
 */

/** Seconds the notification's skip buttons jump. */
const SKIP_SECONDS = 10;

let disposers: (() => void)[] = [];

function supported(): boolean {
	return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/** Seek through the same path the UI uses, so engine state stays in sync. */
function seekTo(seconds: number): void {
	const target = Math.max(0, Math.min(seconds, duration.value || seconds));
	if (isAudio()) {
		seekAudio(target);
		return;
	}
	playerSeek.current?.(target);
}

function isAudio(): boolean {
	return activeKind.value === 'audio' && currentTrack.value !== null;
}

/** Album art at the sizes the OS picks from. */
function artwork(src: string | null | undefined): MediaImage[] {
	if (!src) return [];
	return [
		{ src: artAtSize(src, 256)!, sizes: '256x256', type: 'image/jpeg' },
		{ src: artAtSize(src, 600)!, sizes: '600x600', type: 'image/jpeg' },
	];
}

/**
 * Wire MediaSession to the player signals. Safe to call once at app start;
 * repeat calls re-wire cleanly.
 */
export function initMediaSession(): void {
	if (!supported()) return;
	teardownMediaSession();

	const ms = navigator.mediaSession;

	// --- Action handlers -------------------------------------------------
	// Each is guarded: browsers throw TypeError for actions they don't know.
	const setAction = (action: string, handler: MediaSessionActionHandler | null) => {
		try {
			ms.setActionHandler(action as MediaSessionAction, handler);
		} catch {
			// Unsupported action on this browser — ignore.
		}
	};

	setAction('play', () => {
		if (isAudio()) {
			if (audioPlayback.isPaused()) toggleAudioPlay();
			return;
		}
		const v = videoEl();
		v?.play().catch(() => {});
	});
	setAction('pause', () => {
		if (isAudio()) {
			audioPlayback.pause();
			return;
		}
		videoEl()?.pause();
	});
	setAction('seekbackward', (d: any) =>
		seekTo(currentTime.value - (d?.seekOffset || SKIP_SECONDS)),
	);
	setAction('seekforward', (d: any) =>
		seekTo(currentTime.value + (d?.seekOffset || SKIP_SECONDS)),
	);
	setAction('seekto', (d: any) => {
		if (typeof d?.seekTime === 'number') seekTo(d.seekTime);
	});
	setAction('stop', () => (isAudio() ? audioPlayback.pause() : videoEl()?.pause()));

	// Previous / next track exist only while music plays, so a movie's lock
	// screen keeps its plain seek controls.
	disposers.push(
		effect(() => {
			const audio = activeKind.value === 'audio' && currentTrack.value !== null;
			setAction('previoustrack', audio ? () => void previousTrack() : null);
			setAction('nexttrack', audio ? () => void nextTrack() : null);
		}),
	);

	// --- Metadata: follows the loaded movie ------------------------------
	disposers.push(
		effect(() => {
			if (activeKind.value === 'audio') {
				const now = currentTrack.value;
				if (!now) {
					try {
						ms.metadata = null;
					} catch {}
					return;
				}
				try {
					ms.metadata = new MediaMetadata({
						title: now.track.title,
						artist:
							now.track.artistCredit ||
							now.track.artists.map((a) => a.name).join(', '),
						album: now.track.albumTitle,
						artwork: artwork(now.artUrl),
					});
				} catch {}
				return;
			}
			const movie = globalMovie.value;
			if (!movie) {
				try {
					ms.metadata = null;
				} catch {}
				return;
			}
			const art = movie.posterUrl || movie.thumbnailUrl || movie.backdropUrl || '';
			try {
				ms.metadata = new MediaMetadata({
					title: movie.title,
					// Year + director read well as the "artist" line on a lock screen.
					artist: [movie.year || null, movie.director || null]
						.filter(Boolean)
						.join(' · '),
					album: 'Mu',
					artwork: art
						? [
								{ src: art, sizes: '512x512', type: 'image/jpeg' },
								{ src: art, sizes: '256x256', type: 'image/jpeg' },
							]
						: [],
				});
			} catch {
				// Malformed artwork URL etc. — metadata is cosmetic, never fatal.
			}
		}),
	);

	// --- Playback state + scrubber position ------------------------------
	disposers.push(
		effect(() => {
			const playing = isPlaying.value;
			try {
				ms.playbackState = playing ? 'playing' : 'paused';
			} catch {}
		}),
	);

	disposers.push(
		effect(() => {
			const dur = duration.value;
			const pos = currentTime.value;
			// setPositionState throws if the numbers are inconsistent (position
			// past duration, non-finite, …) — guard rather than let it throw on
			// every tick.
			if (!Number.isFinite(dur) || dur <= 0) return;
			const clamped = Math.max(0, Math.min(pos, dur));
			try {
				ms.setPositionState?.({ duration: dur, position: clamped, playbackRate: 1 });
			} catch {}
		}),
	);
}

/** Drop the handlers + metadata (used on logout / re-init). */
export function teardownMediaSession(): void {
	for (const d of disposers) d();
	disposers = [];
	if (!supported()) return;
	try {
		navigator.mediaSession.metadata = null;
		navigator.mediaSession.playbackState = 'none';
	} catch {}
}

/** The persistent player video element (null before first play). */
function videoEl(): HTMLVideoElement | null {
	return getActiveVideoElement();
}
