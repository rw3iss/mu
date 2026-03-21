import Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { getUiSetting } from '@/hooks/useUiSetting';
import { streamService } from '@/services/stream.service';
import { initAudioEffects } from '@/state/audio-effects.state';
import { globalMovieId } from '@/state/globalPlayer.state';
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

const BUFFER_CONFIGS: Record<
	string,
	{ maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number }
> = {
	small: { maxBufferLength: 10, maxMaxBufferLength: 20, maxBufferSize: 15 * 1024 * 1024 },
	normal: { maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 60 * 1024 * 1024 },
	large: { maxBufferLength: 60, maxMaxBufferLength: 120, maxBufferSize: 120 * 1024 * 1024 },
	max: { maxBufferLength: 120, maxMaxBufferLength: 240, maxBufferSize: 250 * 1024 * 1024 },
};

const MAX_RECOVERIES = 12;
const RECOVERY_BASE_DELAY_MS = 1500;
/** Max recoveries specifically for 503 (transcoding in progress) — more patient */
const MAX_503_RECOVERIES = 30;
/** Max full stream reloads before giving up entirely */
const MAX_FULL_RELOADS = 3;

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
	const [playbackError, setPlaybackError] = useState<string | null>(null);
	const [hlsStatus, setHlsStatus] = useState<HlsStatus>(null);

	const bufferConfig = useMemo(() => {
		const stored = getUiSetting('buffer_size', 'normal');
		return BUFFER_CONFIGS[stored] || BUFFER_CONFIGS.normal;
	}, []);

	// Create the video element once on mount (only when enabled)
	useEffect(() => {
		if (!enabled) return;

		if (!videoRef.current) {
			const video = document.createElement('video');
			video.playsInline = true;
			// NOTE: crossOrigin removed to avoid createMediaElementSource audio tainting
			video.style.width = '100%';
			video.style.height = '100%';
			video.style.objectFit = 'contain';
			videoRef.current = video;

			video.addEventListener('durationchange', () => {
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
			});
			video.addEventListener('play', () => {
				isPlaying.value = true;
				intendedPlayingRef.current = true;
			});
			video.addEventListener('pause', () => {
				// Ignore pause events caused by:
				// 1. Explicit moves via moveVideoTo() set movingRef
				// 2. Implicit detachment (e.g. mini bar unmount) detected via document.contains
				// 3. Programmatic destroy/reinit (suppressPauseRef) — async pause events
				//    from old HLS destroy must not reset intendedPlayingRef for the new stream
				if (movingRef.current || suppressPauseRef.current || !document.contains(video))
					return;
				isPlaying.value = false;
				intendedPlayingRef.current = false;
			});
			video.addEventListener('waiting', () => {
				isBuffering.value = true;
			});
			video.addEventListener('canplay', () => {
				isBuffering.value = false;
			});

			// Attach audio engine EAGERLY (before HLS loads) — calling
			// createMediaElementSource on an empty video is fine, but calling
			// it AFTER HLS sets MediaSource causes Chrome to taint the audio.
			audioEngine.attach(video);
			initAudioEffects();

			// Resume AudioContext when video plays
			video.addEventListener('play', () => {
				audioEngine.resume();
			});
		}

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

		// Progress reporting every 3s
		progressIntervalRef.current = setInterval(() => {
			if (isPlaying.value && videoRef.current) {
				const t = videoRef.current.currentTime;
				updateProgress(t);
				savePositionLocally(t);
			}
		}, 3000);

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
			if (recoveryTimerRef.current) {
				clearTimeout(recoveryTimerRef.current);
				recoveryTimerRef.current = null;
			}
			if (hlsRef.current) {
				hlsRef.current.destroy();
				hlsRef.current = null;
			}
			if (videoRef.current?.parentNode) {
				videoRef.current.parentNode.removeChild(videoRef.current);
			}
			videoRef.current = null;
		};
	}, [enabled]);

	// Sync volume/mute state
	useEffect(() => {
		if (!enabled) return;
		const video = videoRef.current;
		if (!video) return;
		video.volume = volume.value;
		video.muted = isMuted.value;
	}, [enabled, volume.value, isMuted.value]);

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

			// Robust autoplay: listen for canplay to guarantee playback starts
			// once the browser has enough data, regardless of timing.
			if (autoplay) {
				const onCanPlay = () => {
					if (intendedPlayingRef.current && video.paused) {
						video.play().catch(() => {});
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
					const token = localStorage.getItem('mu_token');
					const sep = streamUrl.includes('?') ? '&' : '?';
					directUrl = token
						? `${streamUrl}${sep}token=${encodeURIComponent(token)}`
						: streamUrl;
				} else {
					directUrl = streamUrl;
				}

				if (autoplay) {
					// Load and play immediately
					deferredSrcRef.current = null;
					video.src = directUrl;
					if (startPosition > 0) video.currentTime = startPosition;
					video.play().catch(() => {});
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
				const token = localStorage.getItem('mu_token');
				const hls = new Hls({
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
						if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
					},
				});

				hls.loadSource(streamUrl);
				hls.attachMedia(video);

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
					if (autoplay) video.play().catch(() => {});
				});

				let networkRecoveries = 0;
				let transcodingRecoveries = 0;
				let mediaRecoveries = 0;
				let fullReloads = 0;
				let lastSuccessTime = Date.now();
				recoveryTimerRef.current = null;

				// Reset recovery counters on successful fragment load
				hls.on(Hls.Events.FRAG_LOADED, () => {
					networkRecoveries = 0;
					transcodingRecoveries = 0;
					fullReloads = 0;
					lastSuccessTime = Date.now();
					if (hlsStatus) setHlsStatus(null);
				});

				hls.on(Hls.Events.ERROR, (_event, data) => {
					const resp = (data as any).response;
					const statusCode = resp?.code ?? 0;

					// Non-fatal 503s mean transcoding is in progress — show status
					if (!data.fatal) {
						if (statusCode === 503) {
							setHlsStatus('Transcoding in progress...');
						}
						return;
					}
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
									// All 503 retries exhausted — give up
									const msg =
										'Stream unavailable: transcoding failed or took too long';
									console.error('[HLS] Max 503 recoveries exhausted');
									setPlaybackError(msg);
									hls.destroy();
									hlsRef.current = null;
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
										if (token)
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
								// All reloads exhausted — give up
								const msg = `Stream failed: unable to load video after ${MAX_FULL_RELOADS} attempts`;
								console.error('[HLS] All full reloads exhausted');
								setPlaybackError(msg);
								hls.destroy();
								hlsRef.current = null;
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

		// If we deferred a direct play source (loaded muted for preview frame), unmute and play
		if (deferredSrcRef.current) {
			deferredSrcRef.current = null;
			// Src is already loaded (muted for frame preview) — just unmute and play
			video.muted = isMuted.value;
			intendedPlayingRef.current = true;
			audioEngine.resume();
			video.play().catch(() => {});
			try {
				localStorage.setItem('mu_is_playing', '1');
			} catch {}
			return;
		}

		if (video.paused) {
			intendedPlayingRef.current = true;
			audioEngine.resume();
			video.play();
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
			// Restore mute state after async cleanup
			requestAnimationFrame(() => {
				if (video) video.muted = isMuted.value;
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
