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
	showControls,
	showInfoPanel,
	streamError,
	subtitleTrack,
} from '@/state/player.state';
import { setSharedVideoEngine } from '@/state/videoEngineRef';
import styles from './GlobalPlayer.module.scss';
import { EffectsPanel } from './EffectsPanel';
import { InfoPanel } from './InfoPanel';
import { PlayerControls } from './PlayerControls';
import { useVideoEngine } from './useVideoEngine';

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

		const trackEl = document.createElement('track');
		trackEl.kind = 'subtitles';
		trackEl.label = track.label;
		trackEl.srclang = track.language;
		const token = localStorage.getItem('mu_token');
		trackEl.src = token ? `${track.url}?token=${encodeURIComponent(token)}` : track.url;
		trackEl.default = true;
		video.appendChild(trackEl);
		trackEl.track.mode = 'showing';
	}, [subtitleTrack.value, currentSession.value?.sessionId]);

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
		if (playerMode.value === 'mini') {
			showInfoPanel.value = true;
			maximizePlayer();
		} else {
			showInfoPanel.value = !showInfoPanel.value;
		}
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

			{/* Info panel — fixed flyout, sits above top header */}
			{!isMini && (
				<InfoPanel
					movie={movie}
					visible={showInfoPanel.value}
					onClose={() => {
						showInfoPanel.value = false;
					}}
				/>
			)}

			{/* Effects panel — floating over the player */}
			<EffectsPanel />

			{/* Bottom bar — same layout in both modes */}
			<div class={`${styles.playerBar} ${barVisible ? '' : styles.hidden}`}>
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
