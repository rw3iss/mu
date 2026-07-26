import Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { getUiSetting } from '@/hooks/useUiSetting';
import { streamService } from '@/services/stream.service';
import { wsService } from '@/services/websocket.service';
import {
	bassEnhanceEnabled,
	compressorEnabled,
	eqEnabled,
	hrtfSurroundEnabled,
	initAudioEffects,
	stereoWidthEnabled,
} from '@/state/audio-effects.state';
import { audioResetTrigger, clearAudioSuspect } from '@/state/audio-reset.state';
import { globalMovieId } from '@/state/globalPlayer.state';
import { notifyInfo } from '@/state/notifications.state';
import {
	currentSession,
	currentTime,
	duration,
	isBuffering,
	isMuted,
	isPlaying,
	updateProgress,
	volume,
} from '@/state/player.state';
import { shareToken } from '@/state/share.state';
import { clearWatchPosition, setLocalPosition } from '@/state/watchPositions.state';

const BUFFER_CONFIGS: Record<
	string,
	{ maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number }
> = {
	// Bumped: deeper buffers absorb the seek stalls a busy media HDD induces.
	small: { maxBufferLength: 20, maxMaxBufferLength: 40, maxBufferSize: 30 * 1024 * 1024 },
	normal: { maxBufferLength: 45, maxMaxBufferLength: 90, maxBufferSize: 90 * 1024 * 1024 },
	large: { maxBufferLength: 90, maxMaxBufferLength: 180, maxBufferSize: 180 * 1024 * 1024 },
	max: { maxBufferLength: 180, maxMaxBufferLength: 360, maxBufferSize: 400 * 1024 * 1024 },
};

// When Web Audio effects (EQ/compressor) are engaged, a media-element buffer
// underrun produces an audible silence gap — the MediaElementSource emits
// silence during the stall. On a cold/evicted buffer (e.g. resuming a movie
// after being away) the element flaps in and out of buffering for ~10s, giving
// the repeated ~half-second "skip". So before starting playback we wait for a
// small buffered margin ahead, bounded by a max wait so a genuinely slow
// source still starts. (No effect on the native path — see startPlayback.)
const PREROLL_SECONDS = 5;
const PREROLL_MAX_WAIT_MS = 8000;

/** Seconds of contiguous buffered media ahead of the current playhead. */
function bufferedAhead(v: HTMLMediaElement): number {
	const t = v.currentTime;
	const r = v.buffered;
	for (let i = 0; i < r.length; i++) {
		if (r.start(i) - 0.25 <= t && t < r.end(i) + 0.25) return Math.max(0, r.end(i) - t);
	}
	return 0;
}

/**
 * Module-level singleton video element.
 *
 * Created lazily the first time any `useVideoEngine` hook instance runs, and
 * reused on every subsequent remount. This is load-bearing for Web Audio:
 * `createMediaElementSource()` permanently binds the element to an audio
 * graph, and the browser refuses to create a second source node for the same
 * element. If we created a new `<video>` on every hook mount, the audio
 * engine's graph would be orphaned (stuck on the old element) and the new
 * element would bypass EQ/compressor processing entirely.
 */
let sharedVideoElement: HTMLVideoElement | null = null;

/** The persistent player <video> element (null before first play). */
export function getActiveVideoElement(): HTMLVideoElement | null {
	return sharedVideoElement;
}

function getSharedVideoElement(): HTMLVideoElement {
	if (!sharedVideoElement) {
		const video = document.createElement('video');
		video.playsInline = true;
		// crossOrigin='anonymous' is REQUIRED here. With the eager-attach
		// flow (createMediaElementSource called on the empty <video>
		// BEFORE HLS.js attaches a MediaSource), the source node binds
		// to the element; the audio data must then flow through Web
		// Audio without taint. blob: URLs from MediaSource are treated
		// as opaque by Chrome's tainting logic when the element wasn't
		// configured for CORS — same-origin or not, the MediaElementSource
		// output ends up silenced. Without this attribute,
		// `createMediaElementSource` silently produces no samples even
		// for content served from the same host:port as the page.
		// This was the working configuration in commit f7a0155 and the
		// rediscovered configuration here.
		video.crossOrigin = 'anonymous';
		video.style.width = '100%';
		video.style.height = '100%';
		// Don't set object-fit inline — the wrapper class drives it per
		// mode (.videoWrapperFull → cover; .videoWrapperSplit → contain;
		// .videoWrapperMini → cover). An inline style here would override
		// those rules and force `contain` everywhere, which left visible
		// black bars on mobile-landscape (viewport aspect ≠ video aspect)
		// even though `.videoWrapperFull` deliberately specifies cover
		// for edge-to-edge fill.
		sharedVideoElement = video;
	}
	return sharedVideoElement;
}

const MAX_RECOVERIES = 8;
const RECOVERY_BASE_DELAY_MS = 1000;
/** Max recoveries specifically for 503 (transcoding in progress) — more patient */
const MAX_503_RECOVERIES = 30;
/** Max full stream reloads before falling through to a fresh-session restart.
 *  Set low because if MAX_RECOVERIES already failed, reloading the same
 *  stale manifest rarely helps — the win is creating a new session. */
const MAX_FULL_RELOADS = 1;

/** User-facing status message during HLS recovery (e.g. transcoding in progress) */
type HlsStatus = string | null;

export interface VideoEngine {
	videoRef: { current: HTMLVideoElement | null };
	playbackError: string | null;
	hlsStatus: HlsStatus;
	togglePlay: () => void;
	seek: (time: number) => void;
	initPlayback: (
		streamUrl: string,
		directPlay: boolean,
		startPosition: number,
		autoplay?: boolean,
	) => void;
	destroy: () => void;
	/** Move the video element into a container, preserving play state across the DOM move. */
	moveVideoTo: (container: HTMLElement) => void;
	/** Explicitly set the intended play state (e.g. before starting a new movie). */
	setIntendedPlaying: (value: boolean) => void;
}

/**
 * Creates a persistent video element and manages HLS playback.
 *
 * @param enabled  When false the hook is inert — no video element is
 *                 created and no RAF / interval loops run.  This lets
 *                 VideoPlayer call the hook unconditionally (rules of
 *                 hooks) while avoiding a second engine that would
 *                 fight with the external one over shared signals.
 */
export function useVideoEngine(enabled: boolean = true): VideoEngine {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const hlsRef = useRef<Hls | null>(null);
	const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const rafRef = useRef<number | null>(null);
	const lastDisplayTime = useRef<number>(0);
	const seekLockRef = useRef(false);
	const seekLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestTimeRef = useRef<number>(0);
	/** Guards against DOM-move-induced pause events flipping isPlaying. */
	const movingRef = useRef(false);
	/** Suppresses async pause events during destroy/initPlayback so they
	 *  don't reset intendedPlayingRef after we've already set it for the new stream. */
	const suppressPauseRef = useRef(false);
	/**
	 * Tracks the user's *intended* play state, independent of browser-fired
	 * pause events caused by DOM re-parenting.  When the mini-bar unmounts
	 * (GlobalPlayer returns null), the browser pauses the detached video.
	 * This ref lets moveVideoTo know whether to resume after the move.
	 */
	const intendedPlayingRef = useRef(false);
	/** For direct play with deferred loading: stores the URL until user plays */
	const deferredSrcRef = useRef<{ url: string; position: number } | null>(null);
	/** Tracks pending HLS recovery timeout so it can be cleared on destroy */
	const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Pre-roll poll: when Web Audio is engaged, playback waits for a buffered
	 *  margin before starting (see startPlayback) to avoid the cold-buffer
	 *  "skip". Held here so it can be cancelled on pause / teardown. */
	const prerollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const [playbackError, setPlaybackError] = useState<string | null>(null);
	const [hlsStatus, setHlsStatus] = useState<HlsStatus>(null);

	const bufferConfig = useMemo(() => {
		const stored = getUiSetting('buffer_size', 'large');
		return BUFFER_CONFIGS[stored] || BUFFER_CONFIGS.large;
	}, []);

	// Subscribe to the audio-reset trigger. Reading .value here registers
	// the parent component (GlobalPlayer) with the signal so any bump from
	// requestAudioReset() forces a re-render — which re-runs the mount
	// useEffect below (whose dep list includes resetTick) and performs the
	// swap-and-restore cycle.
	const resetTick = audioResetTrigger.value;

	// Attach event listeners to the shared video element on mount.
	// The element itself is a module-level singleton — only the event
	// listeners are per-mount, so refs captured in their closures stay fresh.
	useEffect(() => {
		if (!enabled) return;

		// ── Audio-reset path ──
		// When resetTick > 0, the previous run's cleanup has already
		// detached hook listeners from the old element. Now: close the
		// AudioContext, tear down HLS, throw away the old <video>, mint
		// a fresh one in the same DOM slot, and re-init playback at the
		// saved position. This is the only escape from Chrome's
		// "stuck-sink" state — createMediaElementSource permanently
		// re-routes the element away from native audio, and there's no
		// API to un-bind. A new element gets a new MediaElementSource
		// candidacy AND a fresh ctx that re-negotiates the sink.
		if (resetTick > 0 && sharedVideoElement) {
			const old = sharedVideoElement;
			const parent = old.parentElement;
			const snap = {
				currentTime: old.currentTime,
				paused: old.paused,
				volume: old.volume,
				muted: old.muted,
				playbackRate: old.playbackRate,
			};
			audioEngine.destroy();
			if (hlsRef.current) {
				try {
					hlsRef.current.destroy();
				} catch {}
				hlsRef.current = null;
			}
			old.pause();
			old.removeAttribute('src');
			old.load();
			old.remove();
			sharedVideoElement = null;
			const fresh = getSharedVideoElement();
			if (parent) parent.appendChild(fresh);
			fresh.volume = snap.volume;
			fresh.muted = snap.muted;
			fresh.playbackRate = snap.playbackRate;
			// Restart the stream at the saved offset. initPlayback is
			// defined later in this hook via useCallback — it's already
			// in lexical scope by the time this effect body runs (effects
			// fire after render). Defer to a microtask anyway so the
			// rest of the setup below (register + initAudioEffects) is
			// in place before we kick playback.
			queueMicrotask(() => {
				const session = currentSession.value;
				if (session) {
					initPlayback(
						session.streamUrl,
						session.directPlay,
						snap.currentTime,
						!snap.paused,
					);
				}
			});
			clearAudioSuspect();
			notifyInfo('Audio output reset.', 3000);
		}

		const video = getSharedVideoElement();
		videoRef.current = video;

		const onDurationChange = () => {
			if (video.duration && Number.isFinite(video.duration)) {
				// Prefer the known movie duration from session (full length)
				// over HLS-reported duration (which grows during transcoding)
				const knownDuration = currentSession.value?.durationSeconds;
				if (knownDuration && knownDuration > video.duration) {
					duration.value = knownDuration;
				} else {
					duration.value = video.duration;
				}
			}
		};
		const onPlay = () => {
			isPlaying.value = true;
			intendedPlayingRef.current = true;
			audioEngine.resume();
			// Restore the keep-alive so the AudioContext stays running.
			audioEngine.setPlaybackActive(true);
		};
		const onPause = () => {
			// Ignore pause events caused by:
			// 1. Explicit moves via moveVideoTo() set movingRef
			// 2. Implicit detachment (e.g. mini bar unmount) detected via document.contains
			// 3. Programmatic destroy/reinit (suppressPauseRef) — async pause events
			//    from old HLS destroy must not reset intendedPlayingRef for the new stream
			if (movingRef.current || suppressPauseRef.current || !document.contains(video)) return;
			isPlaying.value = false;
			intendedPlayingRef.current = false;
			// Mute the keep-alive's (inaudible) output while paused; the source
			// stays started so the context keeps running and won't need a
			// glitchy resume when playback restarts.
			audioEngine.setPlaybackActive(false);
		};
		const onWaiting = () => {
			isBuffering.value = true;
		};
		const onCanPlay = () => {
			isBuffering.value = false;
		};

		video.addEventListener('durationchange', onDurationChange);
		video.addEventListener('play', onPlay);
		video.addEventListener('pause', onPause);
		video.addEventListener('waiting', onWaiting);
		video.addEventListener('canplay', onCanPlay);

		// Register the video element with the audio engine. Web Audio
		// is NOT engaged here — until the user enables EQ/compressor,
		// audio flows natively through the <video> element straight
		// to speakers, which is the only path that's been verified
		// reliable across this app's history. Eager-attach (creating
		// MediaElementSource on the empty element before HLS attaches
		// MediaSource) was attempted and produced silent output: the
		// source binding doesn't subscribe to the audio that HLS later
		// streams in. Lazy attach defers the createMediaElementSource
		// risk until the user explicitly opts into Web Audio
		// processing.
		audioEngine.register(video);
		initAudioEffects();

		// 60fps time tracking via requestAnimationFrame
		const tick = () => {
			const video = videoRef.current;
			if (video && !seekLockRef.current) {
				const time = video.currentTime;
				latestTimeRef.current = time;
				if (time >= lastDisplayTime.current || time < lastDisplayTime.current - 1) {
					currentTime.value = time;
					lastDisplayTime.current = time;
				}
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);

		// Save position to localStorage for reliable restore
		const savePositionLocally = (time: number) => {
			const movieId = globalMovieId.value;
			if (movieId && time > 0) {
				try {
					localStorage.setItem(`mu_position_${movieId}`, String(time));
				} catch {}
			}
		};

		// Progress reporting every 3s: server (for cross-device resume),
		// localStorage (offline fallback), and the global watchPositions
		// signal (so movie cards in other views reflect playback live).
		progressIntervalRef.current = setInterval(() => {
			if (isPlaying.value && videoRef.current) {
				const t = videoRef.current.currentTime;
				const duration = videoRef.current.duration;
				updateProgress(t);
				savePositionLocally(t);
				const movieId = globalMovieId.value;
				if (movieId) {
					setLocalPosition(movieId, t, Number.isFinite(duration) ? duration : null);
				}
			}
		}, 3000);

		// End-of-stream lifecycle: when the video ends naturally, clear
		// the resume position on the server and locally so the next visit
		// starts fresh — per the watch-history contract.
		const onEnded = () => {
			const movieId = globalMovieId.value;
			if (!movieId) return;
			try {
				localStorage.removeItem(`mu_position_${movieId}`);
			} catch {}
			void clearWatchPosition(movieId);
		};
		video.addEventListener('ended', onEnded);

		// Send final position on page unload / tab hide so resume works after refresh.
		// Uses latestTimeRef (updated every frame) since the video element may already
		// be destroyed by the time beforeunload fires.
		const sendFinalProgress = () => {
			const time = videoRef.current?.currentTime ?? latestTimeRef.current;
			savePositionLocally(time);

			const session = currentSession.value;
			if (time <= 0 || !session) return;
			if (session.sessionId.startsWith('remote:')) return;

			const url = `/api/v1/stream/${session.sessionId}/progress`;
			const blob = new Blob([JSON.stringify({ positionSeconds: time })], {
				type: 'application/json',
			});
			navigator.sendBeacon(url, blob);
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') sendFinalProgress();
		};
		window.addEventListener('beforeunload', sendFinalProgress);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			sendFinalProgress();
			window.removeEventListener('beforeunload', sendFinalProgress);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			if (seekLockTimerRef.current) clearTimeout(seekLockTimerRef.current);
			if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
			if (prerollTimerRef.current) {
				clearInterval(prerollTimerRef.current);
				prerollTimerRef.current = null;
			}
			if (recoveryTimerRef.current) {
				clearTimeout(recoveryTimerRef.current);
				recoveryTimerRef.current = null;
			}
			if (hlsRef.current) {
				hlsRef.current.destroy();
				hlsRef.current = null;
			}
			// Remove hook-scoped event listeners from the shared element.
			// DO NOT remove the element from DOM or null the shared reference —
			// it must persist across remounts to keep the Web Audio graph alive.
			video.removeEventListener('durationchange', onDurationChange);
			video.removeEventListener('play', onPlay);
			video.removeEventListener('pause', onPause);
			video.removeEventListener('waiting', onWaiting);
			video.removeEventListener('canplay', onCanPlay);
			video.removeEventListener('ended', onEnded);
			videoRef.current = null;
		};
	}, [enabled, resetTick]);

	// Sync volume/mute state.
	//
	// When the Web Audio engine is attached, the <video> element is the
	// graph's source node — its own muted/volume gate the signal ENTERING
	// the graph, so muting it (or volume 0) silences the EQ/Comp output.
	// In that mode we keep the element unmuted + full and route the user's
	// volume/mute through the engine's master gain instead. Native path
	// (no effects ever enabled) keeps applying volume/mute on the element.
	//
	// The effect-enabled signals are in the dep list so this re-runs the
	// moment the engine first attaches (enabling EQ/Comp/etc.) and pushes
	// the current volume/mute onto the freshly-built master gain.
	useEffect(() => {
		if (!enabled) return;
		const video = videoRef.current;
		if (!video) return;
		if (audioEngine.isAttached()) {
			video.muted = false;
			video.volume = 1;
			audioEngine.setMasterOutput(volume.value, isMuted.value);
		} else {
			video.volume = volume.value;
			video.muted = isMuted.value;
		}
	}, [
		enabled,
		volume.value,
		isMuted.value,
		eqEnabled.value,
		compressorEnabled.value,
		stereoWidthEnabled.value,
		bassEnhanceEnabled.value,
		hrtfSurroundEnabled.value,
	]);

	const initPlayback = useCallback(
		(
			streamUrl: string,
			directPlay: boolean,
			startPosition: number,
			autoplay: boolean = true,
		) => {
			const video = videoRef.current;
			if (!video) return;

			// Suppress async pause events from the old HLS destroy so they don't
			// reset intendedPlayingRef after we set it for the new stream.
			suppressPauseRef.current = true;

			// Clean up previous HLS instance
			if (hlsRef.current) {
				hlsRef.current.destroy();
				hlsRef.current = null;
			}
			setPlaybackError(null);

			intendedPlayingRef.current = autoplay;
			if (autoplay) audioEngine.resume();

			// Re-enable pause tracking after async events settle
			requestAnimationFrame(() => {
				suppressPauseRef.current = false;
			});

			// Attempt autoplay; if the browser blocks unmuted autoplay (no user
			// gesture — e.g. a shared `/watch?t=` deep-link opened in a fresh
			// tab), fall back to MUTED autoplay, which is always permitted, so
			// the movie still starts at the shared time. We reflect the forced
			// mute in `isMuted` so the controls show an unmute affordance.
			const attemptAutoplay = (v: HTMLVideoElement) => {
				v.play().catch(() => {
					if (v.muted) return; // already muted and still blocked — give up
					v.muted = true;
					isMuted.value = true;
					v.play().catch(() => {});
				});
			};

			// Robust autoplay: listen for canplay to guarantee playback starts
			// once the browser has enough data, regardless of timing.
			if (autoplay) {
				const onCanPlay = () => {
					if (intendedPlayingRef.current && video.paused) {
						attemptAutoplay(video);
					}
					video.removeEventListener('canplay', onCanPlay);
				};
				video.addEventListener('canplay', onCanPlay);
			}

			if (directPlay || !Hls.isSupported()) {
				// Ensure video is fully stopped before setting new source
				video.pause();
				video.removeAttribute('src');
				video.load();

				const isAbsoluteUrl = streamUrl.startsWith('http');
				let directUrl: string;
				if (!isAbsoluteUrl) {
					const sep = streamUrl.includes('?') ? '&' : '?';
					const share = shareToken.value;
					if (share) {
						directUrl = `${streamUrl}${sep}shareToken=${encodeURIComponent(share)}`;
					} else {
						const token = localStorage.getItem('mu_token');
						directUrl = token
							? `${streamUrl}${sep}token=${encodeURIComponent(token)}`
							: streamUrl;
					}
				} else {
					directUrl = streamUrl;
				}

				if (autoplay) {
					// Load and play immediately
					deferredSrcRef.current = null;
					video.src = directUrl;
					if (startPosition > 0) video.currentTime = startPosition;
					attemptAutoplay(video);
				} else {
					// Load the source muted to show a frame, but don't play.
					// Muting prevents the Web Audio API ghost audio issue.
					deferredSrcRef.current = { url: directUrl, position: startPosition };
					video.muted = true;
					video.src = directUrl;
					if (startPosition > 0) video.currentTime = startPosition;
					// Video stays paused — frame will render once loaded
				}
			} else {
				const share = shareToken.value;
				const token = share ? null : localStorage.getItem('mu_token');
				const hlsDebug = localStorage.getItem('mu_hls_debug') === '1';
				const hls = new Hls({
					debug: hlsDebug,
					startPosition,
					enableWorker: true,
					lowLatencyMode: false,
					startFragPrefetch: true,
					maxBufferLength: bufferConfig.maxBufferLength,
					maxMaxBufferLength: bufferConfig.maxMaxBufferLength,
					maxBufferSize: bufferConfig.maxBufferSize,
					manifestLoadingMaxRetry: 10,
					manifestLoadingRetryDelay: 1000,
					levelLoadingMaxRetry: 10,
					levelLoadingRetryDelay: 1000,
					fragLoadingMaxRetry: 30,
					fragLoadingRetryDelay: 2000,
					fragLoadingMaxRetryTimeout: 30000,
					xhrSetup(xhr) {
						if (share) xhr.setRequestHeader('X-Share-Token', share);
						else if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
					},
				});

				hls.loadSource(streamUrl);
				hls.attachMedia(video);

				if (hlsDebug) {
					hls.on(Hls.Events.MANIFEST_LOADED, () => console.log('[HLS] Manifest loaded'));
					hls.on(Hls.Events.FRAG_LOADING, (_e, d) =>
						console.log('[HLS] Loading fragment', d.frag.sn),
					);
					hls.on(Hls.Events.FRAG_BUFFERED, (_e, d) =>
						console.log('[HLS] Fragment buffered', d.frag.sn),
					);
					hls.on(Hls.Events.BUFFER_APPENDING, () =>
						console.log('[HLS] Buffer appending'),
					);
					hls.on(Hls.Events.BUFFER_APPENDED, () => console.log('[HLS] Buffer appended'));
					hls.on(Hls.Events.BUFFER_EOS, () => console.log('[HLS] Buffer EOS'));
				}

				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					setHlsStatus(null);
					// Set full movie duration if known (for in-progress transcodes)
					const knownDuration = currentSession.value?.durationSeconds;
					if (knownDuration && knownDuration > 0) {
						duration.value = knownDuration;
					}
					// Don't disrupt if user already started playing manually
					if (!video.paused) return;
					if (startPosition > 0) video.currentTime = startPosition;
					if (autoplay) attemptAutoplay(video);
				});

				let networkRecoveries = 0;
				let transcodingRecoveries = 0;
				let mediaRecoveries = 0;
				let fullReloads = 0;
				let _lastSuccessTime = Date.now();
				recoveryTimerRef.current = null;

				// Reset recovery counters on successful fragment load
				hls.on(Hls.Events.FRAG_LOADED, () => {
					networkRecoveries = 0;
					transcodingRecoveries = 0;
					fullReloads = 0;
					_lastSuccessTime = Date.now();
					if (hlsStatus) setHlsStatus(null);
				});

				/**
				 * Persist the current playback position to localStorage and the
				 * watch-positions signal *immediately*. Called before any
				 * recovery path that destroys + recreates HLS — guarantees
				 * a refresh during the recovery window still resumes at the
				 * right spot.
				 */
				const persistPositionNow = (pos: number) => {
					const movieId = globalMovieId.value;
					if (!movieId || pos <= 0) return;
					try {
						localStorage.setItem(`mu_position_${movieId}`, String(pos));
					} catch {}
					const d = video.duration;
					setLocalPosition(movieId, pos, Number.isFinite(d) ? d : null);
				};

				/**
				 * Tear down the current HLS instance, request a brand-new
				 * stream session (the old one almost certainly died with the
				 * server), and re-init playback at `pos`.
				 *
				 * Used by both the 410 cache-corruption path and the
				 * exhausted-reload final-fallback path. We can't rely on the
				 * GlobalPlayer useEffect to re-init because its dep array
				 * doesn't watch `currentSession.value` — so we drive
				 * `initPlayback` directly from here.
				 */
				const restartStreamAtPosition = (pos: number) => {
					const movieId = globalMovieId.value;
					persistPositionNow(pos);
					try {
						hls.destroy();
					} catch {}
					hlsRef.current = null;
					if (recoveryTimerRef.current) {
						clearTimeout(recoveryTimerRef.current);
						recoveryTimerRef.current = null;
					}
					if (!movieId) {
						setPlaybackError('Stream session expired. Click play to restart.');
						return;
					}
					setHlsStatus('Reconnecting...');
					const wasPlaying = intendedPlayingRef.current;
					streamService
						.startStream(movieId)
						.then((newSession) => {
							currentSession.value = newSession;
							setHlsStatus(null);
							// initPlayback is the function we're currently inside —
							// calling it tears down any leftover state and brings up
							// a fresh HLS instance at `pos`.
							initPlayback(
								newSession.streamUrl,
								newSession.directPlay,
								pos > 0 ? pos : 0,
								wasPlaying,
							);
						})
						.catch((err) => {
							console.error('[HLS] Reconnect failed:', err);
							setPlaybackError('Stream session expired. Click play to restart.');
						});
				};

				hls.on(Hls.Events.ERROR, (_event, data) => {
					const resp = (data as any).response;
					const statusCode = resp?.code ?? 0;

					// 410 = cache corrupted, server cleared it — restart stream
					if (statusCode === 410) {
						console.warn('[HLS] Cache corrupted (410), restarting stream...');
						setHlsStatus('Repairing stream cache...');
						restartStreamAtPosition(video.currentTime);
						return;
					}

					// Non-fatal 503s mean transcoding is in progress — show status
					if (!data.fatal) {
						if (statusCode === 503) {
							setHlsStatus('Transcoding in progress...');
						}
						return;
					}
					// Snapshot position synchronously on the first fatal error so a
					// refresh during the recovery window resumes at the right spot
					// (the 3-second progress tick may have stale data).
					persistPositionNow(video.currentTime || latestTimeRef.current);
					const detail = data.details || 'unknown';

					switch (data.type) {
						case Hls.ErrorTypes.NETWORK_ERROR: {
							const is503 = statusCode === 503;

							if (is503) {
								// Transcoding in progress — be very patient
								transcodingRecoveries++;
								if (transcodingRecoveries < MAX_503_RECOVERIES) {
									const delay = Math.min(2000, 500 + transcodingRecoveries * 100);
									setHlsStatus(
										`Transcoding in progress... (${transcodingRecoveries})`,
									);
									if (recoveryTimerRef.current)
										clearTimeout(recoveryTimerRef.current);
									recoveryTimerRef.current = setTimeout(() => {
										recoveryTimerRef.current = null;
										if (hlsRef.current) hls.startLoad();
									}, delay);
								} else {
									// All 503 retries exhausted — old session is gone.
									// Spin up a fresh one at the last known position.
									const pos = video.currentTime || latestTimeRef.current;
									console.warn(
										`[HLS] Max 503 recoveries exhausted; restarting stream session from ${pos}s`,
									);
									restartStreamAtPosition(pos);
								}
							} else if (networkRecoveries < MAX_RECOVERIES) {
								networkRecoveries++;
								const delay =
									RECOVERY_BASE_DELAY_MS * Math.min(networkRecoveries, 4);
								setHlsStatus(
									`Loading video... (retry ${networkRecoveries}/${MAX_RECOVERIES})`,
								);
								console.warn(
									`[HLS] Network error, recovery ${networkRecoveries}/${MAX_RECOVERIES} in ${delay}ms`,
								);
								if (recoveryTimerRef.current)
									clearTimeout(recoveryTimerRef.current);
								recoveryTimerRef.current = setTimeout(() => {
									recoveryTimerRef.current = null;
									if (hlsRef.current) hls.startLoad();
								}, delay);
							} else if (fullReloads < MAX_FULL_RELOADS) {
								// Recoveries exhausted — try full reload from current position
								fullReloads++;
								const pos = video.currentTime;
								setHlsStatus(
									`Reloading stream... (${fullReloads}/${MAX_FULL_RELOADS})`,
								);
								console.warn(
									`[HLS] Full reload ${fullReloads}/${MAX_FULL_RELOADS} from`,
									pos,
								);
								hls.destroy();
								hlsRef.current = null;

								const newHls = new Hls({
									startPosition: pos,
									enableWorker: true,
									lowLatencyMode: false,
									maxBufferLength: bufferConfig.maxBufferLength,
									maxMaxBufferLength: bufferConfig.maxMaxBufferLength,
									maxBufferSize: bufferConfig.maxBufferSize,
									xhrSetup(xhr) {
										if (share) xhr.setRequestHeader('X-Share-Token', share);
										else if (token)
											xhr.setRequestHeader(
												'Authorization',
												`Bearer ${token}`,
											);
									},
								});
								newHls.loadSource(streamUrl);
								newHls.attachMedia(video);
								hlsRef.current = newHls;
								networkRecoveries = 0;
								transcodingRecoveries = 0;
							} else {
								// All reloads exhausted — old session is dead (e.g.
								// server restarted). Spin up a fresh session and
								// re-init playback at the last known position.
								const pos = video.currentTime || latestTimeRef.current;
								console.warn(
									`[HLS] All reloads exhausted, restarting stream session from ${pos}s`,
								);
								restartStreamAtPosition(pos);
							}
							break;
						}
						case Hls.ErrorTypes.MEDIA_ERROR:
							if (mediaRecoveries < MAX_RECOVERIES) {
								mediaRecoveries++;
								console.warn(
									`[HLS] Media error, recovery ${mediaRecoveries}/${MAX_RECOVERIES}`,
								);
								hls.recoverMediaError();
							} else {
								const msg = `Media error: video could not be decoded (${detail})`;
								setPlaybackError(msg);
								hls.destroy();
								hlsRef.current = null;
							}
							break;
						default:
							setPlaybackError(`Playback error: ${detail}`);
							hls.destroy();
							hlsRef.current = null;
							break;
					}
				});

				hlsRef.current = hls;
			}
		},
		[bufferConfig],
	);

	const togglePlay = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;

		const clearPreroll = () => {
			if (prerollTimerRef.current != null) {
				clearInterval(prerollTimerRef.current);
				prerollTimerRef.current = null;
			}
		};

		// Start (or resume) playback. When Web Audio effects are engaged AND the
		// buffer is thin (cold resume), hold off until a small margin is buffered
		// ahead — otherwise the element underruns repeatedly and each stall is an
		// audible silence gap through the MediaElementSource ("skip"). The native
		// path, or an already-healthy buffer, starts immediately.
		const begin = () => {
			intendedPlayingRef.current = true;
			audioEngine.resume();
			if (
				!audioEngine.isAttached() ||
				video.readyState >= 4 ||
				bufferedAhead(video) >= PREROLL_SECONDS
			) {
				video.play().catch(() => {});
				return;
			}
			isBuffering.value = true;
			const startedAt = Date.now();
			prerollTimerRef.current = setInterval(() => {
				const v = videoRef.current;
				if (!v || !intendedPlayingRef.current) {
					clearPreroll();
					return;
				}
				if (
					v.readyState >= 4 ||
					bufferedAhead(v) >= PREROLL_SECONDS ||
					Date.now() - startedAt > PREROLL_MAX_WAIT_MS
				) {
					clearPreroll();
					isBuffering.value = false;
					audioEngine.resume();
					v.play().catch(() => {});
				}
			}, 200);
		};

		// Mid pre-roll → a tap means "pause": cancel the wait instead of playing.
		if (prerollTimerRef.current != null) {
			clearPreroll();
			intendedPlayingRef.current = false;
			isBuffering.value = false;
			try {
				localStorage.setItem('mu_is_playing', '0');
			} catch {}
			return;
		}

		// If we deferred a direct play source (loaded muted for preview frame), unmute and play
		if (deferredSrcRef.current) {
			deferredSrcRef.current = null;
			// Src is already loaded (muted for frame preview) — restore audio.
			// When Web Audio is attached, keep the element unmuted and route
			// volume/mute through the master gain (a muted source = silent
			// effect chain); otherwise apply mute on the element directly.
			if (audioEngine.isAttached()) {
				video.muted = false;
				video.volume = 1;
				audioEngine.setMasterOutput(volume.value, isMuted.value);
			} else {
				video.muted = isMuted.value;
			}
			begin();
			try {
				localStorage.setItem('mu_is_playing', '1');
			} catch {}
			return;
		}

		if (video.paused) {
			begin();
			try {
				localStorage.setItem('mu_is_playing', '1');
			} catch {}
		} else {
			intendedPlayingRef.current = false;
			video.pause();
			try {
				localStorage.setItem('mu_is_playing', '0');
			} catch {}
		}
	}, []);

	const seek = useCallback((time: number) => {
		const video = videoRef.current;
		if (!video) return;

		// Check if seeking past what's buffered/available in the HLS stream
		const session = currentSession.value;
		const hls = hlsRef.current;
		if (hls && session && !session.directPlay) {
			// Get the end of the last buffered range
			let bufferedEnd = 0;
			if (video.buffered.length > 0) {
				bufferedEnd = video.buffered.end(video.buffered.length - 1);
			}
			// Also check the HLS-reported duration (transcoded length so far)
			const hlsDuration =
				video.duration && Number.isFinite(video.duration) ? video.duration : 0;
			const availableEnd = Math.max(bufferedEnd, hlsDuration);

			// If seeking past buffered content, tell server to prioritize those chunks
			if (time > availableEnd + 5) {
				setHlsStatus('Seeking...');

				// Tell server to prioritize chunks at the seek position
				streamService
					.seekStream(session.sessionId, time)
					.then(() => {
						setHlsStatus(null);
						// With VOD manifest, HLS.js can seek directly — uncached segments
						// return 503 which HLS.js retries automatically
					})
					.catch(() => {
						setHlsStatus(null);
					});

				currentTime.value = time;
				lastDisplayTime.current = time;
				latestTimeRef.current = time;
				return;
			}
		}

		seekLockRef.current = true;
		// Use fastSeek for smoother scrubbing (snaps to nearest keyframe)
		if (typeof video.fastSeek === 'function') {
			video.fastSeek(time);
		} else {
			video.currentTime = time;
		}
		currentTime.value = time;
		lastDisplayTime.current = time;
		latestTimeRef.current = time;
		if (seekLockTimerRef.current) clearTimeout(seekLockTimerRef.current);
		seekLockTimerRef.current = setTimeout(() => {
			seekLockRef.current = false;
		}, 100);

		// Save position locally so it persists
		const movieId = globalMovieId.value;
		if (movieId && time > 0) {
			try {
				localStorage.setItem(`mu_position_${movieId}`, String(time));
			} catch {}
		}
	}, []);

	const destroy = useCallback(() => {
		suppressPauseRef.current = true;
		intendedPlayingRef.current = false;
		deferredSrcRef.current = null;
		if (prerollTimerRef.current) {
			clearInterval(prerollTimerRef.current);
			prerollTimerRef.current = null;
		}
		if (recoveryTimerRef.current) {
			clearTimeout(recoveryTimerRef.current);
			recoveryTimerRef.current = null;
		}
		if (hlsRef.current) {
			hlsRef.current.destroy();
			hlsRef.current = null;
		}
		const video = videoRef.current;
		if (video) {
			video.pause();
			video.removeAttribute('src');
			video.load();
			// Remove all subtitle track elements and revoke blob URLs
			for (const t of video.querySelectorAll('track')) {
				if (t.src?.startsWith('blob:')) URL.revokeObjectURL(t.src);
				video.removeChild(t);
			}
			for (let i = 0; i < video.textTracks.length; i++) {
				video.textTracks[i]!.mode = 'hidden';
			}
			// Mute to kill any lingering audio from buffered data
			video.muted = true;
			// Restore mute state after async cleanup. If Web Audio is attached
			// the element must go back to unmuted/full (the master gain holds
			// the user's mute) — leaving it muted would silence the source.
			requestAnimationFrame(() => {
				if (!video) return;
				if (audioEngine.isAttached()) {
					video.muted = false;
					video.volume = 1;
					audioEngine.setMasterOutput(volume.value, isMuted.value);
				} else {
					video.muted = isMuted.value;
				}
			});
		}
		requestAnimationFrame(() => {
			suppressPauseRef.current = false;
		});
	}, []);

	const moveVideoTo = useCallback((container: HTMLElement) => {
		const video = videoRef.current;
		if (!video || !container) return;

		// Use intendedPlayingRef — the video may already be paused due to
		// DOM detachment (mini bar unmount), but the user intended it to play.
		const shouldPlay = intendedPlayingRef.current;

		// Flag prevents the 'pause' event listener from flipping isPlaying
		movingRef.current = true;
		container.insertBefore(video, container.firstChild);

		// Let the DOM settle, then clear the flag and resume if needed
		requestAnimationFrame(() => {
			movingRef.current = false;
			if (shouldPlay && video.paused) {
				video.play().catch(() => {});
			}
		});
	}, []);

	const setIntendedPlaying = useCallback((value: boolean) => {
		intendedPlayingRef.current = value;
	}, []);

	/**
	 * Server signalled that the movie we're playing was converted (its HLS
	 * cache cleared / source replaced by a direct-play MP4). Re-fetch a fresh
	 * session and reload the <video> at the current position so playback is
	 * seamless — and, when the new source is direct-play, audio effects work.
	 */
	useEffect(() => {
		const onSuperseded = (data: unknown) => {
			const movieId = (data as { movieId?: string })?.movieId;
			if (!movieId || movieId !== globalMovieId.value) return;
			const video = sharedVideoElement;
			const pos = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
			const wasPlaying = intendedPlayingRef.current;
			streamService
				.startStream(movieId)
				.then((session) => {
					currentSession.value = session;
					initPlayback(
						session.streamUrl,
						session.directPlay,
						pos > 0 ? pos : 0,
						wasPlaying,
					);
					notifyInfo(
						session.directPlay
							? 'Switched to direct play — audio effects are now available.'
							: 'Stream source updated.',
						4000,
					);
				})
				.catch((err) => {
					console.error('[stream:superseded] reload failed:', err);
				});
		};
		wsService.subscribe('stream');
		wsService.on('stream:superseded', onSuperseded);
		return () => {
			wsService.off('stream:superseded', onSuperseded);
		};
	}, [initPlayback]);

	return {
		videoRef,
		playbackError,
		hlsStatus,
		togglePlay,
		seek,
		initPlayback,
		destroy,
		moveVideoTo,
		setIntendedPlaying,
	};
}
