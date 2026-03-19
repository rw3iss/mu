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
	playerMode,
	restoredAutoplay,
	startGlobalStream,
} from '@/state/globalPlayer.state';
import {
	currentSession,
	currentTime,
	initPlayerSettings,
	isFullscreen,
	isHoveringControls,
	isPlaying,
	restoreSubtitleChoice,
	showControls,
	showInfoPanel,
	streamError,
	subtitleTrack,
} from '@/state/player.state';
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

export function GlobalPlayer() {
	const engine = useVideoEngine();
	const [_isInitializing, setIsInitializing] = useState(false);
	const [preparingMessage, setPreparingMessage] = useState<string | null>(null);
	const playbackInitRef = useRef(false);
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
		if (isPlaying.value && playerMode.value !== 'mini') {
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

			// Restore subtitle
			const movieId = globalMovieId.value;
			const session = currentSession.value;
			if (movieId && session && session.subtitles.length > 0) {
				restoreSubtitleChoice(movieId, session.subtitles);
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

			// Click to toggle play, double-click for fullscreen
			const handleClick = (e: MouseEvent) => {
				if (playerMode.value === 'mini') return;
				if (e.detail === 1) {
					videoClickTimerRef.current = setTimeout(() => {
						videoClickTimerRef.current = null;
						engine.togglePlay();
					}, 200);
				}
			};
			const handleDblClick = () => {
				if (playerMode.value === 'mini') return;
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
	}, [engine.videoRef.current, isPlayerActive.value]);

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

	// Fullscreen toggle — uses document.documentElement so both video and bar are visible
	const handleToggleFullscreen = useCallback(async () => {
		if (playerMode.value === 'mini') {
			maximizePlayer();
			return;
		}
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				isFullscreen.value = false;
			} else {
				await document.documentElement.requestFullscreen();
				isFullscreen.value = true;
			}
		} catch (error) {
			console.error('Fullscreen error:', error);
		}
	}, []);

	// Info panel toggle
	const handleToggleInfo = useCallback(() => {
		showInfoPanel.value = !showInfoPanel.value;
	}, []);

	// Close panels when clicking outside (e.g. on the main app, minimized player area, etc.)
	useEffect(() => {
		const handleGlobalClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			// If click is inside the player controls or panels, ignore (they handle their own clicks)
			if (target.closest('[data-player-panel]')) return;

			// Close effects panel if open
			if (showEffectsPanel.value) {
				closeEffectsPanel();
			}
			// Close info panel if open
			if (showInfoPanel.value) {
				showInfoPanel.value = false;
			}
		};
		document.addEventListener('mousedown', handleGlobalClick);
		return () => document.removeEventListener('mousedown', handleGlobalClick);
	}, []);

	// Don't render anything if player is hidden
	if (!isPlayerActive.value) return null;

	const movie = globalMovie.value;
	const isMini = playerMode.value === 'mini';
	// In full mode, the bar fades with controls; in mini mode, always visible
	const barVisible = isMini || showControls.value;

	return (
		<>
			{/* Persistent video wrapper — stays in DOM, CSS transitions between full/mini */}
			<div
				ref={videoWrapperRef}
				class={`${styles.videoWrapper} ${isMini ? styles.videoWrapperMini : styles.videoWrapperFull} ${!isMini && !showControls.value ? styles.hideCursor : ''}`}
				onClick={isMini ? maximizePlayer : undefined}
				onMouseMove={!isMini ? resetControlsTimer : undefined}
			>
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
			</div>

			{/* Preparing / error overlay */}
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

			{/* Transcoding in-progress banner — auto-hides with controls */}
			{!isMini && movie?.status === 'processing_playable' && (
				<div
					class={`${styles.transcodingBanner} ${showControls.value ? styles.transcodingBannerVisible : ''}`}
				>
					Transcoding in progress
				</div>
			)}

			{/* Top header — full mode only, fades with controls */}
			{!isMini && (
				<div
					class={`${styles.topHeader} ${showControls.value ? styles.topHeaderVisible : ''}`}
					onMouseEnter={() => {
						isHoveringControls.value = true;
					}}
					onMouseLeave={() => {
						isHoveringControls.value = false;
					}}
				>
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
					<button class={styles.topBtn} onClick={closePlayer} aria-label="Close player">
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
				</div>
			)}

			{/* Info panel — fixed flyout, independent of player mode */}
			<InfoPanel
				movie={movie}
				visible={showInfoPanel.value}
				onClose={() => {
					showInfoPanel.value = false;
				}}
			/>

			{/* Effects panel — floating over the player */}
			<EffectsPanel />

			{/* Bottom bar — same layout in both modes */}
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
		</>
	);
}
