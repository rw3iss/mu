import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { useSubtitleSettings } from '@/components/movie/SubtitleAppearance';
import { getUiSetting } from '@/hooks/useUiSetting';
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
	restoredAutoplay,
	splitExclusive,
	splitPlayer,
	splitWidth,
	startGlobalStream,
} from '@/state/globalPlayer.state';
import {
	audioTrack,
	currentSession,
	currentTime,
	duration,
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
import { setSharedVideoEngine } from '@/state/videoEngineRef';
import { EffectsPanel } from './EffectsPanel';
import styles from './GlobalPlayer.module.scss';
import { InfoPanel } from './InfoPanel';
import { PlayerControls } from './PlayerControls';
import { useVideoEngine } from './useVideoEngine';

/** Shift all VTT timestamp cues by the given offset in milliseconds. */
function offsetVttTimings(vtt: string, offsetMs: number): string {
	if (offsetMs === 0) return vtt;
	// Match VTT timestamps: HH:MM:SS.mmm or MM:SS.mmm
	return vtt.replace(/(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/g, (_match, hours, mins, secs, ms) => {
		const h = hours ? parseInt(hours, 10) : 0;
		const totalMs =
			h * 3600000 +
			parseInt(mins, 10) * 60000 +
			parseInt(secs, 10) * 1000 +
			parseInt(ms, 10) +
			offsetMs;
		const clamped = Math.max(0, totalMs);
		const hh = String(Math.floor(clamped / 3600000)).padStart(2, '0');
		const mm = String(Math.floor((clamped % 3600000) / 60000)).padStart(2, '0');
		const ss = String(Math.floor((clamped % 60000) / 1000)).padStart(2, '0');
		const mmm = String(clamped % 1000).padStart(3, '0');
		return `${hh}:${mm}:${ss}.${mmm}`;
	});
}

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
	const [_isInitializing, setIsInitializing] = useState(false);
	const [preparingMessage, setPreparingMessage] = useState<string | null>(null);
	const playbackInitRef = useRef(false);
	/** Remembers the player mode before entering fullscreen, so we can restore it on exit */
	const preFullscreenModeRef = useRef<PlayerMode | null>(null);
	const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const resetControlsTimer = useCallback(() => {
		showControls.value = true;
		if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
		if (isPlaying.value) {
			const timeout = Math.max(100, getUiSetting('overlay_hide_timeout', 2000));
			if (timeout >= 100) {
				controlsTimerRef.current = setTimeout(() => {
					if (!isHoveringControls.value) {
						showControls.value = false;
					}
				}, timeout);
			}
		}
	}, []);

	// Auto-hide controls when playing starts
	useEffect(() => {
		if (isPlaying.value && playerMode.value !== 'mini' && playerMode.value !== 'split') {
			resetControlsTimer();
		}
	}, [isPlaying.value]);

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
				engine.togglePlay();
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
			}
		}
		document.addEventListener('keydown', handleGlobalKeyDown);
		return () => document.removeEventListener('keydown', handleGlobalKeyDown);
	}, [engine]);

	// Set browser tab title to movie name while playing
	useEffect(() => {
		const movie = globalMovie.value;
		if (!isPlayerActive.value || !movie) {
			document.title = 'Mu';
			return;
		}
		document.title = `${movie.title} — Mu`;
		return () => {
			document.title = 'Mu';
		};
	}, [isPlayerActive.value, globalMovie.value]);

	// When mode changes or a new movie starts, handle stream initialization.
	// ALWAYS init paused, then restore play state from localStorage after.
	useEffect(() => {
		if (!isPlayerActive.value || !globalMovieId.value) return;

		// Helper: after playback is initialized (paused), restore the saved play state.
		const restorePlayState = (isDirectPlay: boolean) => {
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

			// Click to toggle play, double-click for fullscreen.
			// Only respond to clicks directly on the video element — ignore
			// clicks on overlay buttons that might bubble through.
			const handleClick = (e: MouseEvent) => {
				if (playerMode.value === 'mini') return;
				if (e.target !== video) return;
				if (e.detail === 1) {
					videoClickTimerRef.current = setTimeout(() => {
						videoClickTimerRef.current = null;
						engine.togglePlay();
					}, 200);
				}
			};
			const handleDblClick = (e: MouseEvent) => {
				if (playerMode.value === 'mini') return;
				if (e.target !== video) return;
				if (videoClickTimerRef.current) {
					clearTimeout(videoClickTimerRef.current);
					videoClickTimerRef.current = null;
				}
				handleToggleFullscreen();
			};

			video.addEventListener('click', handleClick);
			video.addEventListener('dblclick', handleDblClick);
			return () => {
				if (videoClickTimerRef.current) clearTimeout(videoClickTimerRef.current);
				video.removeEventListener('click', handleClick);
				video.removeEventListener('dblclick', handleDblClick);
			};
		}
	}, [engine.videoRef.current, isPlayerActive.value, playerMode.value]);

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
			return;
		}

		const v = videoEffects.value;
		const filters = [
			`brightness(${v.brightness / 100})`,
			`contrast(${v.contrast / 100})`,
			`saturate(${v.saturation / 100})`,
			v.hueRotate !== 0 ? `hue-rotate(${v.hueRotate}deg)` : '',
			v.sepia > 0 ? `sepia(${v.sepia / 100})` : '',
			v.grayscale > 0 ? `grayscale(${v.grayscale / 100})` : '',
		]
			.filter(Boolean)
			.join(' ');

		video.style.filter = filters;
	}, [videoEnabled.value, videoEffects.value]);

	// Apply selected subtitle track to the video element
	useEffect(() => {
		const video = engine.videoRef.current;
		const session = currentSession.value;
		let cancelled = false;

		// Always clean up existing tracks first
		if (video) {
			for (const t of video.querySelectorAll('track')) {
				if (t.src?.startsWith('blob:')) URL.revokeObjectURL(t.src);
				video.removeChild(t);
			}
			for (let i = 0; i < video.textTracks.length; i++) {
				video.textTracks[i]!.mode = 'hidden';
			}
		}

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

		// Fetch VTT and create blob URL
		fetch(subtitleUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`Subtitle fetch failed: ${res.status}`);
				return res.text();
			})
			.then((vttText) => {
				if (cancelled) return;

				const timingOffset = subSettings.timingOffsetMs;
				let processedVtt = vttText;
				if (timingOffset !== 0) {
					processedVtt = offsetVttTimings(vttText, timingOffset);
				}

				const blob = new Blob([processedVtt], { type: 'text/vtt' });
				const blobUrl = URL.createObjectURL(blob);

				if (cancelled) {
					URL.revokeObjectURL(blobUrl);
					return;
				}

				// Remove any tracks that snuck in while we were fetching
				for (const t of video.querySelectorAll('track')) {
					if (t.src?.startsWith('blob:')) URL.revokeObjectURL(t.src);
					video.removeChild(t);
				}

				const trackEl = document.createElement('track');
				trackEl.kind = 'subtitles';
				trackEl.label = track.label;
				trackEl.srclang = track.language;
				trackEl.src = blobUrl;
				trackEl.default = true;
				video.appendChild(trackEl);
				trackEl.track.mode = 'showing';
			})
			.catch((err) => {
				if (!cancelled) console.error('[Subtitles] Failed to load subtitle track:', err);
			});

		return () => {
			cancelled = true;
			if (video) {
				for (const t of video.querySelectorAll('track')) {
					if (t.src?.startsWith('blob:')) URL.revokeObjectURL(t.src);
					video.removeChild(t);
				}
				for (let i = 0; i < video.textTracks.length; i++) {
					video.textTracks[i]!.mode = 'hidden';
				}
			}
		};
	}, [subtitleTrack.value, currentSession.value?.sessionId, subSettings.timingOffsetMs]);

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
			}
		};
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
	}, [engine]);

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
		};
		document.addEventListener('mousedown', handleGlobalClick);
		return () => document.removeEventListener('mousedown', handleGlobalClick);
	}, []);

	// Lock body scroll when player is in full mode (prevent scrollbar over video)
	useEffect(() => {
		const isFull =
			isPlayerActive.value && playerMode.value !== 'mini' && playerMode.value !== 'split';
		if (isFull) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [isPlayerActive.value, playerMode.value]);

	// Don't render anything if player is hidden
	if (!isPlayerActive.value) return null;

	const movie = globalMovie.value;
	const isMini = playerMode.value === 'mini';
	const isSplit = playerMode.value === 'split';
	// In full mode, the bar fades with controls; in mini/split mode, always visible
	const barVisible = isMini || isSplit || showControls.value;

	// Spacer height = just the video (aspect ratio based on split width).
	// The top bar (32px) is a flex child above the spacer so it pushes naturally.
	// The site header offset is handled by CSS (panel top: var(--topbar-height)).
	const splitVideoHeight = isSplit ? `calc((${splitWidth.value}vw - 3px) * 9 / 16)` : '0px';
	const isExclusive = isSplit && splitExclusive.value;

	// In exclusive mode, calculate the top offset to center the video vertically
	// The video height in px is approximately (splitWidth% of viewport width) * 9/16
	// Center offset = (windowHeight - videoHeight) / 2
	const exclusiveTopStyle = isExclusive
		? `calc((100vh - (${splitWidth.value}vw - 3px) * 9 / 16) / 2)`
		: undefined;

	return (
		<>
			{/* Split mode panel — everything except the video (which stays in the shared wrapper) */}
			{isSplit && (
				<div
					class={`${styles.splitPanel} ${isExclusive ? styles.splitPanelExclusive : ''}`}
					style={{ width: `${splitWidth.value}vw` }}
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

					{/* Top bar — overlays the video area */}
					<div class={styles.splitTopBar}>
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
					<PlayerControls
						visible
						isSplit
						onTogglePlay={engine.togglePlay}
						onSeek={engine.seek}
						onToggleFullscreen={handleToggleFullscreen}
						onToggleInfo={handleToggleInfo}
						session={currentSession.value}
						title={movie?.title}
					/>

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
				onMouseMove={!isMini && !isSplit ? resetControlsTimer : undefined}
				onWheel={
					!isMini
						? (e: WheelEvent) => {
								e.preventDefault();
								const delta = e.deltaY > 0 ? -0.05 : 0.05;
								setVolume(volume.value + delta);
							}
						: undefined
				}
			>
				{/* Mini mode overlays */}
				{isMini && (
					<>
						{preparingMessage && (
							<div class={styles.miniSpinnerOverlay}>
								<div class={styles.miniSpinner} />
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
						<button
							class={styles.topBtn}
							onClick={minimizePlayer}
							aria-label="Minimize player"
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
					)}
					{!shareMode.value && (
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
					)}
					{!shareMode.value && (
						<button
							class={styles.topBtn}
							onClick={closePlayer}
							aria-label="Close player"
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
						onTogglePlay={engine.togglePlay}
						onSeek={engine.seek}
						onToggleFullscreen={handleToggleFullscreen}
						onToggleInfo={handleToggleInfo}
						session={currentSession.value}
						title={movie?.title}
						hasMiniThumbnail={isMini}
						leftSlot={isMini ? <div class={styles.miniSpacer} /> : null}
					/>
				</div>
			)}
		</>
	);
}
