import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { streamService } from '@/services/stream.service';
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
	initPlayerSettings,
	isFullscreen,
	isHoveringControls,
	restoreSubtitleChoice,
	showControls,
	showInfoPanel,
	streamError,
	subtitleTrack,
} from '@/state/player.state';
import { useSubtitleSettings } from '@/components/movie/SubtitleAppearance';
import { closeEffectsPanel, showEffectsPanel } from '@/state/audio-effects.state';
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
	return vtt.replace(
		/(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/g,
		(_match, hours, mins, secs, ms) => {
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
		},
	);
}

export function GlobalPlayer() {
	const engine = useVideoEngine();
	const miniVideoContainerRef = useRef<HTMLDivElement>(null);
	const [_isInitializing, setIsInitializing] = useState(false);
	const [preparingMessage, setPreparingMessage] = useState<string | null>(null);
	const playbackInitRef = useRef(false);

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

	// When mode changes or a new movie starts, handle stream initialization
	useEffect(() => {
		if (!isPlayerActive.value || !globalMovieId.value) return;

		if (!currentSession.value) {
			// Stop any old video before starting a new stream
			engine.destroy();
			setIsInitializing(true);
			setPreparingMessage(null);
			initPlayerSettings();
			playbackInitRef.current = false;
			engine.setIntendedPlaying(true);
			startGlobalStream().then(async (session) => {
				if (session) {
					// If stream isn't ready yet (live transcode), poll until first segment is available
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
					engine.initPlayback(session.streamUrl, session.directPlay, pos);
					playbackInitRef.current = true;

					// Restore previously selected subtitle for this movie
					const movieId = globalMovieId.value;
					if (movieId && session.subtitles.length > 0) {
						restoreSubtitleChoice(movieId, session.subtitles);
					}
				} else if (streamError.value) {
					// Stream failed to start — show the error
					setPreparingMessage(streamError.value);
				}
				setIsInitializing(false);
			});
		} else if (!playbackInitRef.current) {
			const autoplay = restoredAutoplay.value ?? true;
			engine.setIntendedPlaying(autoplay);
			engine.initPlayback(
				currentSession.value.streamUrl,
				currentSession.value.directPlay,
				currentSession.value.startPosition,
				autoplay,
			);
			playbackInitRef.current = true;
			restoredAutoplay.value = null;
		}
	}, [globalMovieId.value, isPlayerActive.value]);

	// Move video element to mini container when in mini mode
	useEffect(() => {
		if (
			playerMode.value === 'mini' &&
			miniVideoContainerRef.current &&
			engine.videoRef.current
		) {
			engine.moveVideoTo(miniVideoContainerRef.current);
		}
	}, [playerMode.value]);

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
		const fontSize = `${(s.fontSize / 100) * 1.3}em`;
		const verticalOffset = s.verticalOffset;

		styleEl.textContent = `
			video::cue {
				color: ${fontColor};
				background-color: ${bgColor};
				font-size: ${fontSize};
				text-shadow: 1px 1px 2px ${shadowColor}, -1px -1px 2px ${shadowColor};
			}
			video::-webkit-media-text-track-display {
				transform: translateY(${verticalOffset}px);
			}
		`;

		return () => {
			styleEl?.remove();
		};
	}, [subSettings]);

	// Apply selected subtitle track to the video element
	useEffect(() => {
		const video = engine.videoRef.current;
		const session = currentSession.value;
		if (!video) return;

		// Remove existing track elements
		for (const t of video.querySelectorAll('track')) {
			video.removeChild(t);
		}

		// Also hide any active text tracks
		for (let i = 0; i < video.textTracks.length; i++) {
			video.textTracks[i]!.mode = 'hidden';
		}

		const selectedId = subtitleTrack.value;
		if (!selectedId || !session) return;

		const track = session.subtitles.find((t) => t.id === selectedId);
		if (!track) return;

		// Build the subtitle URL with auth
		let subtitleUrl = track.url;
		if (!subtitleUrl.startsWith('http')) {
			const token = localStorage.getItem('mu_token');
			if (token) {
				const sep = subtitleUrl.includes('?') ? '&' : '?';
				subtitleUrl = `${subtitleUrl}${sep}token=${encodeURIComponent(token)}`;
			}
		}

		// Fetch the VTT content and create a blob URL to avoid CORS issues
		// with crossOrigin='anonymous' on the video element
		fetch(subtitleUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`Subtitle fetch failed: ${res.status}`);
				return res.text();
			})
			.then((vttText) => {
				// Apply timing offset to the VTT content
				const timingOffset = subSettings.timingOffsetMs;
				let processedVtt = vttText;
				if (timingOffset !== 0) {
					processedVtt = offsetVttTimings(vttText, timingOffset);
				}

				const blob = new Blob([processedVtt], { type: 'text/vtt' });
				const blobUrl = URL.createObjectURL(blob);

				// Check video is still current
				if (engine.videoRef.current !== video) {
					URL.revokeObjectURL(blobUrl);
					return;
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
				console.error('[Subtitles] Failed to load subtitle track:', err);
			});

		return () => {
			// Clean up blob URLs
			for (const t of video.querySelectorAll('track')) {
				if (t.src.startsWith('blob:')) {
					URL.revokeObjectURL(t.src);
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
				class={`${styles.playerBar} ${barVisible ? '' : styles.hidden}`}
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
					leftSlot={
						isMini ? (
							<div
								class={styles.miniVideo}
								ref={miniVideoContainerRef}
								onClick={maximizePlayer}
							>
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
							</div>
						) : null
					}
				/>
			</div>
		</>
	);
}
