import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { Spinner } from '@/components/common/Spinner';
import { useSubtitleSettings } from '@/components/movie/SubtitleAppearance';
import { getUiSetting } from '@/hooks/useUiSetting';
import { sharedSessionService } from '@/services/shared-session.service';
import { streamService } from '@/services/stream.service';
import {
	closeEffectsPanel,
	showEffectsPanel,
	videoEffects,
	videoEnabled,
} from '@/state/audio-effects.state';
import {
	closePlayer,
	forceStartPosition,
	globalMovie,
	globalMovieId,
	isPlayerActive,
	maximizePlayer,
	minimizePlayer,
	type PlayerMode,
	playerMode,
	playerSeek,
	restoredAutoplay,
	splitExclusive,
	splitPlayer,
	splitWidth,
	startGlobalStream,
} from '@/state/globalPlayer.state';
import {
	currentSession,
	currentTime,
	initPlayerSettings,
	isBuffering,
	isFullscreen,
	isHoveringControls,
	isPlaying,
	restoreAudioTrackChoice,
	restoreSubtitleChoice,
	setVolume,
	showControls,
	showInfoPanel,
	streamError,
	subtitleTrack,
	volume,
} from '@/state/player.state';
import { shareMode } from '@/state/share.state';
import {
	activeSession,
	canControlPlayback,
	canSeekPlayback,
	closeSessionMenu,
	closeSessionSettingsPanel,
	closeVoicePanel,
	showSessionMenu,
	showSessionSettingsPanel,
	showVoicePanel,
} from '@/state/shared-session.state';
import { setSharedVideoEngine } from '@/state/videoEngineRef';
import { clearVideoSubtitles } from '@/utils/subtitle-dom';
import { EffectsPanel } from './EffectsPanel';
import styles from './GlobalPlayer.module.scss';
import { InfoPanel } from './InfoPanel';
import { PlayerControls } from './PlayerControls';
import { SnippetDialog } from './SnippetDialog';
import { SessionOverlays } from './session/SessionOverlays';
import { useVideoEngine } from './useVideoEngine';
import { VideoEnhancer } from './VideoEnhancer';

// Subtitle timing-offset is applied at runtime by mutating each loaded
// cue's startTime/endTime directly (see Effect B below). The cue's
// original times are snapshotted on track load so subsequent offset
// changes shift relative to the source, not relative to the previously
// shifted state. This makes offset changes instant and live — the
// currently-displayed cue moves immediately rather than waiting for the
// next cue boundary.

let splitWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
function setSplitWidth(w: number) {
	splitWidth.value = w;
	// Debounce localStorage write — signal updates are instant
	if (splitWidthSaveTimer) clearTimeout(splitWidthSaveTimer);
	splitWidthSaveTimer = setTimeout(() => {
		localStorage.setItem('mu_ui_split_width', String(w));
		splitWidthSaveTimer = null;
	}, 200);
}

export function GlobalPlayer() {
	const engine = useVideoEngine();

	// Expose the live seek to comment timestamp chips anywhere in the app.
	useEffect(() => {
		playerSeek.current = engine.seek;
		return () => {
			if (playerSeek.current === engine.seek) playerSeek.current = null;
		};
	}, [engine.seek]);

	// Shared-session play/pause + seek interception. With NO active session these
	// are byte-for-byte the original engine calls; in a session they gate on the
	// user's permission and broadcast the action to the party (the service's
	// echo-guard + applyingRemote flag prevent feedback loops).
	const handleTogglePlay = useCallback(() => {
		if (activeSession.value && !canControlPlayback.value) return;
		if (activeSession.value) {
			sharedSessionService.broadcastLocalCommand(
				isPlaying.value ? 'pause' : 'play',
				currentTime.value,
			);
		}
		engine.togglePlay();
	}, [engine]);

	const handleSessionSeek = useCallback(
		(t: number) => {
			if (activeSession.value) {
				if (!canSeekPlayback.value) return;
				sharedSessionService.broadcastLocalCommand('seek', t);
			}
			engine.seek(t);
		},
		[engine],
	);
	const [_isInitializing, setIsInitializing] = useState(false);
	const [preparingMessage, setPreparingMessage] = useState<string | null>(null);
	const playbackInitRef = useRef(false);
	/** Remembers the player mode before entering fullscreen, so we can restore it on exit */
	const preFullscreenModeRef = useRef<PlayerMode | null>(null);
	const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	/**
	 * Show the controls now and schedule them to fade after the
	 * configured `overlay_hide_timeout`. Called from:
	 *  - the video wrapper's `onMouseMove` (activity over the video)
	 *  - `armAutoHide` (entered an overlay mode)
	 *
	 * The setTimeout callback respects `isHoveringControls` so the user
	 * keeps the controls up by parking the cursor on the top header
	 * or bottom bar; moving off retriggers the fade on the next
	 * activity reset.
	 */
	const resetControlsTimer = useCallback(() => {
		showControls.value = true;
		if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
		const timeout = Math.max(100, getUiSetting('overlay_hide_timeout', 1000));
		controlsTimerRef.current = setTimeout(() => {
			if (!isHoveringControls.value) {
				showControls.value = false;
			}
		}, timeout);
	}, []);

	/**
	 * Whenever the player enters a state that overlays the video
	 * (full mode, exclusive split, or browser fullscreen), arm the
	 * auto-hide timer immediately — regardless of whether the mouse
	 * is over the video. Mouse activity over the video then resets
	 * the timer normally via the wrapper's `onMouseMove` handler.
	 *
	 * This is the only place the timer is armed on mode transitions;
	 * click/dblclick on the video do NOT explicitly arm it because
	 * the resulting mode/fullscreen change already triggers this
	 * effect.
	 */
	useEffect(() => {
		const inOverlayMode =
			playerMode.value === 'full' || (playerMode.value === 'split' && splitExclusive.value);
		if (inOverlayMode || isFullscreen.value) {
			resetControlsTimer();
		}
	}, [playerMode.value, splitExclusive.value, isFullscreen.value, resetControlsTimer]);

	// Expose the video engine via module-level ref so Player page can access it
	useEffect(() => {
		setSharedVideoEngine(engine);
		return () => {
			setSharedVideoEngine(null);
		};
	}, [engine]);

	// Global spacebar: toggle play/pause when player is open (full or mini)
	useEffect(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			// Don't intercept when typing in inputs
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				e.target instanceof HTMLSelectElement
			) {
				return;
			}
			if (playerMode.value === 'hidden') return;
			if (e.key === ' ') {
				e.preventDefault();
				handleTogglePlay();
			} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				const skipTimes = getUiSetting<number[]>('skip_times', [5, 10, 20]);
				const skipSeconds = skipTimes[0] ?? 5;
				const video = engine.videoRef.current;
				if (video) {
					const newTime =
						e.key === 'ArrowLeft'
							? Math.max(0, video.currentTime - skipSeconds)
							: Math.min(video.duration || Infinity, video.currentTime + skipSeconds);
					video.currentTime = newTime;
					currentTime.value = newTime;
				}
			} else if (e.key === 'Escape' || e.key === 'Backspace') {
				// In full mode (whether or not browser-fullscreen): exit fullscreen
				// and drop to mini. In mini/split it's a no-op so Escape/Backspace
				// keep their normal meaning elsewhere.
				if (playerMode.value !== 'full') return;
				e.preventDefault();
				// Let an open info panel close on the first press instead of
				// minimizing (a second press then minimizes).
				if (showInfoPanel.value) {
					showInfoPanel.value = false;
					return;
				}
				if (document.fullscreenElement) {
					document.exitFullscreen().catch(() => {});
					isFullscreen.value = false;
				}
				minimizePlayer();
			}
		}
		document.addEventListener('keydown', handleGlobalKeyDown);
		return () => document.removeEventListener('keydown', handleGlobalKeyDown);
	}, [engine, handleTogglePlay]);

	// When mode changes or a new movie starts, handle stream initialization.
	// ALWAYS init paused, then restore play state from localStorage after.
	useEffect(() => {
		if (!isPlayerActive.value || !globalMovieId.value) return;

		// Helper: after playback is initialized (paused), restore the saved play state.
		const _restorePlayState = (isDirectPlay: boolean) => {
			// restoredAutoplay: true/false = restoring from refresh, null = user clicked play
			const isRestore = restoredAutoplay.value !== null;
			const shouldPlay = restoredAutoplay.value ?? true;
			restoredAutoplay.value = null;

			// For direct play on restore: never auto-resume (ghost audio bug with Web Audio API).
			// The deferred src mechanism means the user must press play to load the video.
			// For user-initiated play: initPlayback was called with autoplay=true via playMovie.
			if (shouldPlay && !(isRestore && isDirectPlay)) {
				const video = engine.videoRef.current;
				if (video) {
					engine.setIntendedPlaying(true);
					audioEngine.resume();
					video.play().catch(() => {});
				}
			}

			// Restore subtitle and audio track choices
			const movieId = globalMovieId.value;
			const session = currentSession.value;
			if (movieId && session) {
				if (session.subtitles.length > 0) {
					restoreSubtitleChoice(movieId, session.subtitles);
				}
				if (session.audioTracks.length > 1) {
					restoreAudioTrackChoice(movieId, session.audioTracks);
				}
			}
		};

		if (!currentSession.value) {
			// No session — create a new stream
			engine.destroy();
			setIsInitializing(true);
			setPreparingMessage(null);
			initPlayerSettings();
			playbackInitRef.current = false;

			const isRestore = restoredAutoplay.value !== null;
			const shouldAutoplay = restoredAutoplay.value ?? true;
			restoredAutoplay.value = null;
			engine.setIntendedPlaying(shouldAutoplay);

			startGlobalStream().then(async (session) => {
				if (session) {
					if (!session.ready && !session.directPlay) {
						setPreparingMessage('Preparing video...');
						const ready = await streamService.waitForReady(
							session.sessionId,
							(status) => {
								if (status.state === 'failed') {
									setPreparingMessage(
										`Transcoding failed: ${status.error || 'unknown error'}`,
									);
								}
							},
						);

						if (!ready) {
							setPreparingMessage('Failed to prepare video for playback.');
							setIsInitializing(false);
							return;
						}
					}

					setPreparingMessage(null);
					const pos = forceStartPosition.value ?? session.startPosition;
					forceStartPosition.value = null;

					// For direct play on restore: don't autoplay (defers src loading)
					// For user-initiated or HLS: use shouldAutoplay
					const autoplay = isRestore && session.directPlay ? false : shouldAutoplay;
					engine.initPlayback(session.streamUrl, session.directPlay, pos, autoplay);
					playbackInitRef.current = true;
					if (pos > 0) currentTime.value = pos;

					// Restore subtitle
					const movieId = globalMovieId.value;
					if (movieId && session.subtitles.length > 0) {
						restoreSubtitleChoice(movieId, session.subtitles);
					}
				} else if (streamError.value) {
					setPreparingMessage(streamError.value);
				}
				setIsInitializing(false);
			});
		} else if (!playbackInitRef.current) {
			// Session exists (restored from localStorage)
			const isRestore = restoredAutoplay.value !== null;
			const shouldAutoplay = restoredAutoplay.value ?? true;
			restoredAutoplay.value = null;

			const pos = forceStartPosition.value ?? currentSession.value.startPosition;
			forceStartPosition.value = null;

			// For direct play on restore: don't autoplay (defers src loading)
			const autoplay = isRestore && currentSession.value.directPlay ? false : shouldAutoplay;
			engine.setIntendedPlaying(autoplay);
			engine.initPlayback(
				currentSession.value.streamUrl,
				currentSession.value.directPlay,
				pos,
				autoplay,
			);
			playbackInitRef.current = true;
			// Set currentTime so seek bar shows correct position immediately
			if (pos > 0) currentTime.value = pos;

			// Restore subtitle
			const movieId = globalMovieId.value;
			if (movieId && currentSession.value.subtitles.length > 0) {
				restoreSubtitleChoice(movieId, currentSession.value.subtitles);
			}
		}
	}, [globalMovieId.value, isPlayerActive.value]);

	// Mount video element into the persistent wrapper and attach click handlers
	const videoWrapperRef = useRef<HTMLDivElement>(null);
	const videoClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (videoWrapperRef.current && engine.videoRef.current) {
			const wrapper = videoWrapperRef.current;
			const video = engine.videoRef.current;
			if (!wrapper.contains(video)) {
				wrapper.insertBefore(video, wrapper.firstChild);
			}

			// Click → toggle play. Double-click → toggle browser fullscreen
			// (in full mode) or maximize (in split/mini). Only respond to
			// clicks directly on the video element — ignore clicks on
			// overlay buttons that might bubble through.
			const handleClick = (e: MouseEvent) => {
				if (playerMode.value === 'mini') return;
				if (e.target !== video) return;
				if (e.detail === 1) {
					videoClickTimerRef.current = setTimeout(() => {
						videoClickTimerRef.current = null;
						handleTogglePlay();
					}, 250);
				}
			};
			const handleDblClick = (e: MouseEvent) => {
				if (playerMode.value === 'mini') return;
				if (e.target !== video) return;
				if (videoClickTimerRef.current) {
					clearTimeout(videoClickTimerRef.current);
					videoClickTimerRef.current = null;
				}
				// In browser fullscreen + full mode: just exit fullscreen.
				if (document.fullscreenElement && playerMode.value === 'full') {
					document.exitFullscreen().catch(() => {});
					return;
				}
				handleToggleFullscreen();
			};

			// Scroll wheel to adjust volume (must be non-passive to preventDefault)
			const handleWheel = (e: WheelEvent) => {
				if (playerMode.value === 'mini') return;
				e.preventDefault();
				const delta = e.deltaY > 0 ? -0.05 : 0.05;
				setVolume(volume.value + delta);
			};

			video.addEventListener('click', handleClick);
			video.addEventListener('dblclick', handleDblClick);
			wrapper.addEventListener('wheel', handleWheel, { passive: false });
			return () => {
				if (videoClickTimerRef.current) clearTimeout(videoClickTimerRef.current);
				video.removeEventListener('click', handleClick);
				video.removeEventListener('dblclick', handleDblClick);
				wrapper.removeEventListener('wheel', handleWheel);
			};
		}
	}, [engine.videoRef.current, isPlayerActive.value, playerMode.value, handleTogglePlay]);

	// Session heartbeat — keeps the server session alive during pause
	useEffect(() => {
		const session = currentSession.value;
		if (!session?.sessionId) return;
		const interval = setInterval(
			() => {
				streamService.heartbeat(session.sessionId).catch(() => {});
			},
			2 * 60 * 1000,
		); // every 2 minutes
		return () => clearInterval(interval);
	}, [currentSession.value?.sessionId]);

	// Subtitle appearance settings
	const [subSettings] = useSubtitleSettings();

	// Apply subtitle appearance styles via a dynamic <style> element
	useEffect(() => {
		const s = subSettings;
		const styleId = 'mu-subtitle-style';
		let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
		if (!styleEl) {
			styleEl = document.createElement('style');
			styleEl.id = styleId;
			document.head.appendChild(styleEl);
		}

		// Parse hex color to rgba with opacity
		const hexToRgba = (hex: string, alpha: number) => {
			const r = parseInt(hex.slice(1, 3), 16);
			const g = parseInt(hex.slice(3, 5), 16);
			const b = parseInt(hex.slice(5, 7), 16);
			return `rgba(${r}, ${g}, ${b}, ${alpha})`;
		};

		const fontColor = hexToRgba(s.fontColor, s.textOpacity);
		const bgColor = hexToRgba(s.backgroundColor, s.backgroundOpacity);
		const shadowColor = s.shadowColor;
		const fontSizeEm = (s.fontSize / 100) * 1.3;
		const lineHeight = s.lineSpacing ?? 1.0;
		const userOffset = s.verticalOffset;
		// Push subtitles up when player controls are visible in full mode
		const controlsUp = showControls.value && playerMode.value !== 'mini' ? -90 : 0;
		const totalOffset = userOffset + controlsUp;

		styleEl.textContent = `
			video::cue {
				color: ${fontColor};
				background-color: ${bgColor};
				font-size: ${fontSizeEm}em;
				line-height: ${lineHeight};
				text-shadow: 1px 1px 2px ${shadowColor}, -1px -1px 2px ${shadowColor};
			}
			video::-webkit-media-text-track-display {
				transform: translateY(${totalOffset}px);
				transition: transform 200ms ease;
			}
		`;

		return () => {
			styleEl?.remove();
		};
	}, [subSettings, showControls.value, playerMode.value]);

	// Apply video effects (CSS filters) to the video element
	useEffect(() => {
		const video = engine.videoRef.current;
		if (!video) return;

		if (!videoEnabled.value) {
			video.style.filter = '';
			video.style.transform = '';
			return;
		}

		const v = videoEffects.value;
		const cssFilters = [
			`brightness(${v.brightness / 100})`,
			`contrast(${v.contrast / 100})`,
			`saturate(${v.saturation / 100})`,
			v.hueRotate !== 0 ? `hue-rotate(${v.hueRotate}deg)` : '',
			v.sepia > 0 ? `sepia(${v.sepia / 100})` : '',
			v.grayscale > 0 ? `grayscale(${v.grayscale / 100})` : '',
		].filter(Boolean);

		// Gamma, black-level, and sharpen live in an SVG filter chain (CSS
		// has no equivalent for any of them). Reference it FIRST in the
		// CSS filter chain so its output feeds brightness/contrast/sat,
		// matching natural grading order: black-point → gamma → sharpen
		// → brightness → contrast → saturation. Only inject the URL when
		// at least one is non-default so we skip a no-op pass when unused.
		const usesSvg =
			(v.gamma ?? 100) !== 100 || (v.blackLevel ?? 0) !== 0 || (v.sharpen ?? 0) !== 0;
		video.style.filter = usesSvg
			? ['url(#mu-video-filter)', ...cssFilters].join(' ')
			: cssFilters.join(' ');

		// Geometric transforms: uniform crop zooms past letterbox bars,
		// vertical scale corrects squished/stretched aspect. Combined into
		// a single transform so they compose; CSS scale composites on the
		// GPU with zero relayout. The <video> bounding box stays the same;
		// overflow on the parent container clips overdraw.
		const scaleY = (v.verticalScale ?? 100) / 100;
		const crop = (v.crop ?? 100) / 100;
		const parts: string[] = [];
		if (crop !== 1) parts.push(`scale(${crop})`);
		if (scaleY !== 1) parts.push(`scaleY(${scaleY})`);
		video.style.transform = parts.join(' ');
	}, [videoEnabled.value, videoEffects.value]);

	// ── Subtitles: load track + apply timing offset live ──────────────
	//
	// Effect A loads the track when the source changes (track or session).
	// Effect B applies the timing offset by mutating each cue's start/end
	// time directly — no re-fetch, no track replacement. The active cue
	// moves immediately, which is what makes the offset feel live.

	const cueOriginalsRef = useRef<WeakMap<TextTrackCue, { start: number; end: number }>>(
		new WeakMap(),
	);
	const cueListRef = useRef<TextTrackCue[]>([]);
	const currentOffsetMsRef = useRef<number>(subSettings.timingOffsetMs);

	const applySubtitleOffset = useCallback((offsetMs: number) => {
		currentOffsetMsRef.current = offsetMs;
		const offsetSec = offsetMs / 1000;
		for (const cue of cueListRef.current) {
			const orig = cueOriginalsRef.current.get(cue);
			if (!orig) continue;
			const newStart = Math.max(0, orig.start + offsetSec);
			// Keep at least 1ms of duration so the browser still considers
			// the cue valid — clamping start to 0 must not collapse end too.
			const newEnd = Math.max(newStart + 0.001, orig.end + offsetSec);
			if (cue.startTime !== newStart) cue.startTime = newStart;
			if (cue.endTime !== newEnd) cue.endTime = newEnd;
		}
	}, []);

	// Effect A — load the selected subtitle track
	useEffect(() => {
		cueOriginalsRef.current = new WeakMap();
		cueListRef.current = [];

		const video = engine.videoRef.current;
		const session = currentSession.value;
		let cancelled = false;

		clearVideoSubtitles(video);

		if (!video || !session) return;

		const selectedId = subtitleTrack.value;
		if (!selectedId) return;

		const track = session.subtitles.find((t) => t.id === selectedId);
		if (!track) return;

		// Build the subtitle URL with auth
		let subtitleUrl = track.url;
		if (subtitleUrl.startsWith('http')) {
			try {
				const parsed = new URL(subtitleUrl);
				if (parsed.origin === window.location.origin) {
					subtitleUrl = parsed.pathname + parsed.search;
				}
			} catch {}
		}
		if (!subtitleUrl.startsWith('http')) {
			const token = localStorage.getItem('mu_token');
			if (token && !subtitleUrl.includes('token=')) {
				const sep = subtitleUrl.includes('?') ? '&' : '?';
				subtitleUrl = `${subtitleUrl}${sep}token=${encodeURIComponent(token)}`;
			}
		}

		fetch(subtitleUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`Subtitle fetch failed: ${res.status}`);
				return res.text();
			})
			.then((vttText) => {
				if (cancelled) return;

				const blob = new Blob([vttText], { type: 'text/vtt' });
				const blobUrl = URL.createObjectURL(blob);

				if (cancelled) {
					URL.revokeObjectURL(blobUrl);
					return;
				}

				clearVideoSubtitles(video);

				const trackEl = document.createElement('track');
				trackEl.kind = 'subtitles';
				trackEl.label = track.label;
				trackEl.srclang = track.language;
				trackEl.src = blobUrl;
				trackEl.default = true;

				// When the cue list is parsed, snapshot original times and
				// apply the latest offset (read from the ref so a change
				// made while the fetch was in flight isn't lost).
				const onTrackLoad = () => {
					if (cancelled) return;
					const cues = trackEl.track.cues;
					if (!cues) return;
					cueOriginalsRef.current = new WeakMap();
					cueListRef.current = [];
					for (let i = 0; i < cues.length; i++) {
						const c = cues[i]!;
						cueOriginalsRef.current.set(c, {
							start: c.startTime,
							end: c.endTime,
						});
						cueListRef.current.push(c);
					}
					applySubtitleOffset(currentOffsetMsRef.current);
				};
				trackEl.addEventListener('load', onTrackLoad, { once: true });

				video.appendChild(trackEl);
				trackEl.track.mode = 'showing';
			})
			.catch((err) => {
				if (!cancelled) console.error('[Subtitles] Failed to load subtitle track:', err);
			});

		return () => {
			cancelled = true;
			cueOriginalsRef.current = new WeakMap();
			cueListRef.current = [];
			clearVideoSubtitles(video);
		};
	}, [subtitleTrack.value, currentSession.value?.sessionId, applySubtitleOffset]);

	// Effect B — apply timing offset live whenever the user changes it.
	// No fetch, no track rebuild — just shift the existing cues.
	useEffect(() => {
		applySubtitleOffset(subSettings.timingOffsetMs);
	}, [subSettings.timingOffsetMs, applySubtitleOffset]);

	// Fullscreen toggle — always enters full mode for true fullscreen
	const handleToggleFullscreen = useCallback(async () => {
		try {
			if (document.fullscreenElement) {
				// If in split/mini mode while fullscreen, switch to full mode
				// instead of exiting fullscreen
				if (playerMode.value !== 'full') {
					preFullscreenModeRef.current = null; // don't restore split on exit
					maximizePlayer();
					return;
				}
				await document.exitFullscreen();
				// Restore previous mode (handled by fullscreenchange listener below)
			} else {
				// Remember current mode and play state before switching to full
				preFullscreenModeRef.current = playerMode.value;
				const wasPlaying = !engine.videoRef.current?.paused;
				// Switch to full mode so the full-screen overlay renders correctly
				if (playerMode.value !== 'full') {
					maximizePlayer();
				}
				await document.documentElement.requestFullscreen();
				isFullscreen.value = true;
				// Restore play state after mode switch (moving video element can pause it)
				if (wasPlaying && engine.videoRef.current?.paused) {
					engine.videoRef.current.play().catch(() => {});
				}
			}
		} catch (error) {
			console.error('Fullscreen error:', error);
		}
	}, [engine]);

	// Restore previous mode when exiting fullscreen, preserving play state
	useEffect(() => {
		const handleFullscreenChange = () => {
			if (!document.fullscreenElement) {
				isFullscreen.value = false;
				const wasPlaying = !engine.videoRef.current?.paused;
				// Restore the mode the user was in before entering fullscreen
				const prev = preFullscreenModeRef.current;
				if (prev && prev !== 'full' && prev !== 'hidden') {
					if (prev === 'split') splitPlayer();
					else if (prev === 'mini') minimizePlayer();
				}
				preFullscreenModeRef.current = null;
				// Restore play state after mode switch
				if (wasPlaying) {
					requestAnimationFrame(() => {
						if (engine.videoRef.current?.paused) {
							engine.videoRef.current.play().catch(() => {});
						}
					});
				}
			} else {
				isFullscreen.value = true;
				// Entering fullscreen — especially via a double-click on a window
				// that wasn't focused beforehand — can drop the controls bar's
				// `mouseleave`, leaving `isHoveringControls` stuck `true` so the
				// auto-hide timer's callback never hides the overlay (no further
				// "mouse off" event arrives over the fixed video element). Force a
				// clean "not hovering" state and arm the hide as if the mouse had
				// just moved off, so the controls reliably auto-hide after going
				// fullscreen in all cases; a real mouse-over still re-shows them and
				// the normal hover / auto-hide cycle resumes.
				isHoveringControls.value = false;
				resetControlsTimer();
			}
		};
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
	}, [engine, resetControlsTimer]);

	// Info panel toggle
	const handleToggleInfo = useCallback(() => {
		showInfoPanel.value = !showInfoPanel.value;
	}, []);

	// Close panels when clicking outside
	useEffect(() => {
		const handleGlobalClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const clickedPanel = target.closest('[data-player-panel]');

			// Close effects panel if click is outside it
			if (showEffectsPanel.value) {
				const effectsEl = document.querySelector('[data-effects-panel]');
				if (!effectsEl?.contains(target)) {
					closeEffectsPanel();
				}
			}
			// Close info panel if click is outside any player panel
			if (showInfoPanel.value && !clickedPanel) {
				showInfoPanel.value = false;
			}
			// Close the session menu if the click missed it + its anchor.
			if (
				showSessionMenu.value &&
				!target.closest('[data-session-menu]') &&
				!target.closest('[data-session-menu-anchor]')
			) {
				closeSessionMenu();
			}
			// Close the session settings panel when clicking outside it.
			if (showSessionSettingsPanel.value) {
				const el = document.querySelector('[data-session-settings-panel]');
				if (!el?.contains(target)) closeSessionSettingsPanel();
			}
			// Close the voice panel when clicking outside it.
			if (showVoicePanel.value) {
				const el = document.querySelector('[data-voice-panel]');
				if (!el?.contains(target)) closeVoicePanel();
			}
		};
		document.addEventListener('mousedown', handleGlobalClick);
		return () => document.removeEventListener('mousedown', handleGlobalClick);
	}, []);

	// Lock ALL page scroll when the player is in full mode. On mobile the
	// scroller is often <html> (or the URL-bar lets the viewport pan), so
	// locking only <body> left a few px of vertical/horizontal scroll that
	// dragged the fixed top/bottom bars off-screen. Lock both elements +
	// kill overscroll so the full-screen player can never scroll.
	useEffect(() => {
		const isFull =
			isPlayerActive.value && playerMode.value !== 'mini' && playerMode.value !== 'split';
		const html = document.documentElement;
		const body = document.body;
		if (isFull) {
			html.style.overflow = 'hidden';
			body.style.overflow = 'hidden';
			body.style.overscrollBehavior = 'none';
		} else {
			html.style.overflow = '';
			body.style.overflow = '';
			body.style.overscrollBehavior = '';
		}
		return () => {
			html.style.overflow = '';
			body.style.overflow = '';
			body.style.overscrollBehavior = '';
		};
	}, [isPlayerActive.value, playerMode.value]);

	// Don't render anything if player is hidden
	if (!isPlayerActive.value) return null;

	const movie = globalMovie.value;
	const isMini = playerMode.value === 'mini';
	const isSplit = playerMode.value === 'split';
	const isExclusive = isSplit && splitExclusive.value;
	// In full mode and exclusive split mode, the bar fades; in mini/normal split, always visible
	const barVisible = isMini || (isSplit && !isExclusive) || showControls.value;

	// Spacer height = just the video (aspect ratio based on split width).
	// The top bar (32px) is a flex child above the spacer so it pushes naturally.
	// The site header offset is handled by CSS (panel top: var(--topbar-height)).
	const splitVideoHeight = isSplit ? `calc((${splitWidth.value}vw - 3px) * 9 / 16)` : '0px';

	// In exclusive mode, calculate the top offset to center the video vertically
	// The video height in px is approximately (splitWidth% of viewport width) * 9/16
	// Center offset = (windowHeight - videoHeight) / 2
	const exclusiveTopStyle = isExclusive
		? `calc((100vh - (${splitWidth.value}vw - 3px) * 9 / 16) / 2)`
		: undefined;

	// SVG filter for gamma + black-level + sharpen (CSS has no equivalent
	// for any of these). All three identity at default (gamma=1, black=0,
	// sharpen=0) → pass-through. The useEffect above only references the
	// filter URL when at least one is non-default so the cost when unused
	// is zero.
	const ve = videoEffects.value;
	const blackLevel = (ve.blackLevel ?? 0) / 100;
	const blackSlope = blackLevel < 1 ? 1 / (1 - blackLevel) : 1;
	const blackIntercept = blackLevel < 1 ? -blackLevel / (1 - blackLevel) : 0;
	const gammaValue = (ve.gamma ?? 100) / 100;
	const gammaExponent = gammaValue > 0 ? 1 / gammaValue : 1;
	// Unsharp mask via blur+composite: out = (1+a)·source − a·blur(source).
	// We use this instead of feConvolveMatrix because Chrome's video
	// filter pipeline silently drops convolveMatrix on <video> elements
	// in many builds, while feGaussianBlur + feComposite both run
	// reliably. a=0 gives k2=1, k3=0, which is identity (the blur is
	// computed but multiplied out), so the slider at 0 is a true no-op.
	const sharpenAmount = (ve.sharpen ?? 0) / 100;

	return (
		<>
			<svg
				width="0"
				height="0"
				style={{ position: 'absolute', pointerEvents: 'none' }}
				aria-hidden="true"
			>
				<filter id="mu-video-filter" color-interpolation-filters="sRGB">
					<feComponentTransfer result="afterBlack">
						<feFuncR type="linear" slope={blackSlope} intercept={blackIntercept} />
						<feFuncG type="linear" slope={blackSlope} intercept={blackIntercept} />
						<feFuncB type="linear" slope={blackSlope} intercept={blackIntercept} />
					</feComponentTransfer>
					<feComponentTransfer in="afterBlack" result="afterGamma">
						<feFuncR type="gamma" amplitude="1" exponent={gammaExponent} offset="0" />
						<feFuncG type="gamma" amplitude="1" exponent={gammaExponent} offset="0" />
						<feFuncB type="gamma" amplitude="1" exponent={gammaExponent} offset="0" />
					</feComponentTransfer>
					<feGaussianBlur in="afterGamma" stdDeviation="1" result="sharpenBlur" />
					<feComposite
						in="afterGamma"
						in2="sharpenBlur"
						operator="arithmetic"
						k1="0"
						k2={1 + sharpenAmount}
						k3={-sharpenAmount}
						k4="0"
					/>
				</filter>
			</svg>
			{/* Split mode panel — everything except the video (which stays in the shared wrapper) */}
			{isSplit && (
				<div
					class={`${styles.splitPanel} ${isExclusive ? styles.splitPanelExclusive : ''}`}
					style={{ width: `${splitWidth.value}vw` }}
					onMouseMove={isExclusive ? resetControlsTimer : undefined}
					onMouseLeave={
						isExclusive
							? () => {
									if (isPlaying.value) {
										if (controlsTimerRef.current)
											clearTimeout(controlsTimerRef.current);
										controlsTimerRef.current = setTimeout(() => {
											showControls.value = false;
										}, 300);
									}
								}
							: undefined
					}
				>
					{/* Drag handle on left edge */}
					<div
						class={styles.splitDragHandle}
						onMouseDown={(e: MouseEvent) => {
							e.preventDefault();
							const startX = e.clientX;
							const startWidth = splitWidth.value;
							const onMove = (ev: MouseEvent) => {
								const delta = startX - ev.clientX;
								const newWidth = Math.min(
									62,
									Math.max(25, startWidth + (delta / window.innerWidth) * 100),
								);
								setSplitWidth(Math.round(newWidth));
							};
							const onUp = () => {
								document.removeEventListener('mousemove', onMove);
								document.removeEventListener('mouseup', onUp);
							};
							document.addEventListener('mousemove', onMove);
							document.addEventListener('mouseup', onUp);
						}}
					/>

					{/* Top bar — overlays the video area, hides in exclusive mode */}
					<div
						class={`${styles.splitTopBar} ${isExclusive && !showControls.value ? styles.splitBarHidden : ''}`}
					>
						<button
							class={styles.splitTopBtn}
							onClick={() => minimizePlayer()}
							title="Minimize"
						>
							<svg
								width={22}
								height={22}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
							>
								<polyline points="6 9 12 15 18 9" />
							</svg>
						</button>
						<button
							class={styles.splitTopBtn}
							onClick={() => maximizePlayer()}
							title="Full screen"
						>
							<svg
								width={22}
								height={22}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
							>
								<polyline points="15 3 21 3 21 9" />
								<polyline points="9 21 3 21 3 15" />
								<line x1="21" y1="3" x2="14" y2="10" />
								<line x1="3" y1="21" x2="10" y2="14" />
							</svg>
						</button>
						<div style={{ flex: 1 }} />
						<button
							class={styles.splitTopBtn}
							onClick={() => closePlayer()}
							title="Close"
						>
							<svg
								width={22}
								height={22}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
							>
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</button>
					</div>

					{/* Spacer for video area (video is positioned fixed via the shared wrapper) */}
					<div
						style={{
							height: isExclusive
								? `calc(${exclusiveTopStyle} + ${splitVideoHeight} - var(--topbar-height, 56px))`
								: splitVideoHeight,
							flexShrink: 0,
							transition: 'height 300ms ease',
						}}
					/>

					{/* Seek bar + controls — directly below video, full width */}
					<div
						class={`${isExclusive && !showControls.value ? styles.splitBarHidden : ''}`}
					>
						<PlayerControls
							// In isolated (exclusive) split mode the controls auto-hide
							// on mouse-leave — tie the whole controls block (incl. the
							// seek bar inside it) to that state so nothing lingers below
							// the video. Normal split mode keeps controls always visible.
							visible={!isExclusive || showControls.value}
							isSplit
							onTogglePlay={handleTogglePlay}
							onSeek={handleSessionSeek}
							onToggleFullscreen={handleToggleFullscreen}
							onToggleInfo={handleToggleInfo}
							session={currentSession.value}
							title={movie?.title}
							playbackLocked={
								activeSession.value != null && !canControlPlayback.value
							}
						/>
					</div>

					{/* Movie info — inline, no flyout */}
					<div
						class={`${styles.splitInfoArea} ${isExclusive ? styles.splitInfoExclusive : ''}`}
					>
						{isExclusive ? (
							<button
								class={styles.exclusiveOverlay}
								onClick={() => {
									splitExclusive.value = false;
								}}
								title="Show info panel"
							>
								<div class={styles.exclusiveHoverContent}>
									<span class={styles.exclusiveTitle}>{movie?.title}</span>
									<svg
										width={16}
										height={16}
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth={2}
									>
										<polyline points="6 9 12 15 18 9" />
									</svg>
								</div>
							</button>
						) : (
							<>
								<button
									class={styles.exclusiveCloseBtn}
									onClick={() => {
										splitExclusive.value = true;
									}}
									title="Hide info panel"
								>
									<svg
										width={14}
										height={14}
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth={2.5}
									>
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
								{movie && (
									<InfoPanel movie={movie} visible onClose={() => {}} inline />
								)}
							</>
						)}
					</div>

					{/* Effects panel */}
					<EffectsPanel />
				</div>
			)}

			{/* Persistent video wrapper — stays in DOM, CSS repositions between full/mini/split */}
			<div
				ref={videoWrapperRef}
				class={`${styles.videoWrapper} ${isSplit ? styles.videoWrapperSplit : isMini ? styles.videoWrapperMini : styles.videoWrapperFull} ${!isMini && !isSplit && !showControls.value ? styles.hideCursor : ''}`}
				style={
					isSplit
						? {
								width: `calc(${splitWidth.value}vw - 3px)`,
								...(exclusiveTopStyle
									? { top: exclusiveTopStyle, transition: 'top 300ms ease' }
									: {}),
							}
						: undefined
				}
				onClick={isMini ? maximizePlayer : undefined}
				onMouseMove={!isMini && (!isSplit || isExclusive) ? resetControlsTimer : undefined}
			>
				{/* GPU video enhancement overlay. Renders nothing unless the
				    user has enabled it in the Effects panel and WebGPU is
				    available. When active it covers the underlying <video>
				    (which keeps playing for audio/seek/HLS). */}
				<VideoEnhancer />

				{/* Mini mode overlays */}
				{isMini && (
					<>
						{preparingMessage && (
							<div class={styles.miniSpinnerOverlay}>
								<Spinner size="md" />
							</div>
						)}
						<div class={styles.miniVideoOverlay}>
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="white"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<polyline points="18 15 12 9 6 15" />
							</svg>
						</div>
					</>
				)}

				{/* Loading spinner — inside video wrapper so it doesn't cover controls */}
				{!isMini &&
					!preparingMessage &&
					!streamError.value &&
					isPlayerActive.value &&
					isBuffering.value && (
						<div class={styles.loadingSpinner}>
							<div class={styles.loadingSpinnerIcon} />
						</div>
					)}

				{/* Preparing / error overlay — inside video wrapper so controls remain accessible */}
				{preparingMessage && !isMini && (
					<div class={styles.preparingOverlay}>
						<div class={styles.preparingContent}>
							{!streamError.value && <div class={styles.preparingSpinner} />}
							<span>{preparingMessage}</span>
							{streamError.value && (
								<button
									class={styles.preparingClose}
									onClick={() => {
										setPreparingMessage(null);
										closePlayer();
									}}
								>
									Close
								</button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Transcoding in-progress banner — auto-hides with controls */}
			{!isMini && !isSplit && movie?.status === 'processing_playable' && (
				<div
					class={`${styles.transcodingBanner} ${showControls.value ? styles.transcodingBannerVisible : ''}`}
				>
					Transcoding in progress
				</div>
			)}

			{/* Top header — full mode only, fades with controls */}
			{!isMini && !isSplit && (
				<div
					class={`${styles.topHeader} ${showControls.value ? styles.topHeaderVisible : ''}`}
					onClick={(e: Event) => e.stopPropagation()}
					onMouseEnter={() => {
						isHoveringControls.value = true;
					}}
					onMouseLeave={() => {
						isHoveringControls.value = false;
					}}
				>
					{!shareMode.value && (
						<div class={styles.topLeftGroup}>
							<button
								class={styles.topBtn}
								onClick={minimizePlayer}
								aria-label="Minimize player"
								title="Minimize"
							>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="white"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</button>
							<button
								class={styles.topBtn}
								onClick={splitPlayer}
								aria-label="Split view"
								title="Split view"
							>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="white"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<rect x="3" y="3" width="18" height="18" rx="2" />
									<line x1="12" y1="3" x2="12" y2="21" />
								</svg>
							</button>
						</div>
					)}
					{!shareMode.value && (
						<button
							class={styles.topBtn}
							onClick={closePlayer}
							aria-label="Close player"
							title="Close"
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="white"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</button>
					)}
				</div>
			)}

			{/* Info panel — fixed flyout, full/mini mode only (split has inline info) */}
			{!isSplit && (
				<InfoPanel
					movie={movie}
					visible={showInfoPanel.value}
					onClose={() => {
						showInfoPanel.value = false;
					}}
				/>
			)}

			{/* Effects panel — full/mini mode only (split has its own) */}
			{!isSplit && <EffectsPanel />}

			{/* Shared Sessions overlays — panels, modals, chat, speaking
			    indicator. Each self-gates; inert when there's no session. All
			    are fixed/portal-positioned so a single mount covers all modes. */}
			<SessionOverlays />

			{/* Bottom bar — full/mini mode only (split has inline controls) */}
			{!isSplit && (
				<div
					class={`${styles.playerBar} ${isMini ? styles.playerBarMini : styles.playerBarFull} ${barVisible ? '' : styles.hidden}`}
					onMouseEnter={() => {
						isHoveringControls.value = true;
					}}
					onMouseLeave={() => {
						isHoveringControls.value = false;
					}}
				>
					<PlayerControls
						visible={barVisible}
						onTogglePlay={handleTogglePlay}
						onSeek={handleSessionSeek}
						onToggleFullscreen={handleToggleFullscreen}
						onToggleInfo={handleToggleInfo}
						session={currentSession.value}
						title={movie?.title}
						hasMiniThumbnail={isMini}
						leftSlot={isMini ? <div class={styles.miniSpacer} /> : null}
						playbackLocked={activeSession.value != null && !canControlPlayback.value}
					/>
				</div>
			)}
			<SnippetDialog />
		</>
	);
}
