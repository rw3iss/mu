import { useRef, useEffect, useMemo, useCallback, useState } from 'preact/hooks';
import Hls from 'hls.js';
import {
	isPlaying,
	currentTime,
	duration,
	volume,
	isMuted,
	isBuffering,
	updateProgress,
} from '@/state/player.state';
import { getUiSetting } from '@/hooks/useUiSetting';

const BUFFER_CONFIGS: Record<
	string,
	{ maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number }
> = {
	small: { maxBufferLength: 10, maxMaxBufferLength: 20, maxBufferSize: 15 * 1024 * 1024 },
	normal: { maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 60 * 1024 * 1024 },
	large: { maxBufferLength: 60, maxMaxBufferLength: 120, maxBufferSize: 120 * 1024 * 1024 },
	max: { maxBufferLength: 120, maxMaxBufferLength: 240, maxBufferSize: 250 * 1024 * 1024 },
};

const MAX_RECOVERIES = 6;
const RECOVERY_BASE_DELAY_MS = 2000;

export interface VideoEngine {
	videoRef: { current: HTMLVideoElement | null };
	playbackError: string | null;
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
	const [playbackError, setPlaybackError] = useState<string | null>(null);

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
			video.style.width = '100%';
			video.style.height = '100%';
			video.style.objectFit = 'contain';
			videoRef.current = video;

			video.addEventListener('durationchange', () => {
				if (video.duration && Number.isFinite(video.duration)) {
					duration.value = video.duration;
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
		}

		// 60fps time tracking via requestAnimationFrame
		const tick = () => {
			const video = videoRef.current;
			if (video && !seekLockRef.current) {
				const time = video.currentTime;
				if (time >= lastDisplayTime.current || time < lastDisplayTime.current - 1) {
					currentTime.value = time;
					lastDisplayTime.current = time;
				}
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);

		// Progress reporting every 10s
		progressIntervalRef.current = setInterval(() => {
			if (isPlaying.value && videoRef.current) {
				updateProgress(videoRef.current.currentTime);
			}
		}, 10000);

		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			if (seekLockTimerRef.current) clearTimeout(seekLockTimerRef.current);
			if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
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

			// Re-enable pause tracking after async events settle
			requestAnimationFrame(() => {
				suppressPauseRef.current = false;
			});

			if (directPlay || !Hls.isSupported()) {
				const token = localStorage.getItem('mu_token');
				const sep = streamUrl.includes('?') ? '&' : '?';
				video.src = token
					? `${streamUrl}${sep}token=${encodeURIComponent(token)}`
					: streamUrl;
				if (startPosition > 0) video.currentTime = startPosition;
				if (autoplay) video.play().catch(() => {});
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
					manifestLoadingMaxRetry: 15,
					manifestLoadingRetryDelay: 2000,
					levelLoadingMaxRetry: 15,
					levelLoadingRetryDelay: 2000,
					fragLoadingMaxRetry: 15,
					fragLoadingRetryDelay: 2000,
					xhrSetup(xhr) {
						if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
					},
				});

				hls.loadSource(streamUrl);
				hls.attachMedia(video);

				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					// Don't disrupt if user already started playing manually
					if (!video.paused) return;
					if (startPosition > 0) video.currentTime = startPosition;
					if (autoplay) video.play().catch(() => {});
				});

				let networkRecoveries = 0;
				let mediaRecoveries = 0;
				hls.on(Hls.Events.ERROR, (_event, data) => {
					if (!data.fatal) return;
					const detail = data.details || 'unknown';
					const response = (data as any).response;
					const statusCode = response?.code ?? '';

					switch (data.type) {
						case Hls.ErrorTypes.NETWORK_ERROR:
							if (networkRecoveries < MAX_RECOVERIES) {
								networkRecoveries++;
								const delay = RECOVERY_BASE_DELAY_MS * networkRecoveries;
								console.warn(
									`[HLS] Network error, recovery ${networkRecoveries}/${MAX_RECOVERIES} in ${delay}ms`,
								);
								setTimeout(() => {
									if (hlsRef.current) hls.startLoad();
								}, delay);
							} else {
								const msg = `Network error: unable to load video segments (${detail}${statusCode ? `, HTTP ${statusCode}` : ''})`;
								console.error(`[HLS] ${msg}`);
								setPlaybackError(msg);
								hls.destroy();
								hlsRef.current = null;
							}
							break;
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
		if (video.paused) {
			intendedPlayingRef.current = true;
			video.play();
		} else {
			intendedPlayingRef.current = false;
			video.pause();
		}
	}, []);

	const seek = useCallback((time: number) => {
		const video = videoRef.current;
		if (!video) return;
		seekLockRef.current = true;
		video.currentTime = time;
		currentTime.value = time;
		lastDisplayTime.current = time;
		if (seekLockTimerRef.current) clearTimeout(seekLockTimerRef.current);
		seekLockTimerRef.current = setTimeout(() => {
			seekLockRef.current = false;
		}, 150);
	}, []);

	const destroy = useCallback(() => {
		suppressPauseRef.current = true;
		intendedPlayingRef.current = false;
		if (hlsRef.current) {
			hlsRef.current.destroy();
			hlsRef.current = null;
		}
		const video = videoRef.current;
		if (video) {
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
		// Re-enable after async pause events settle
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
		togglePlay,
		seek,
		initPlayback,
		destroy,
		moveVideoTo,
		setIntendedPlaying,
	};
}
