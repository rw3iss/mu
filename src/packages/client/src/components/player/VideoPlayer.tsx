import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { Movie } from '@/state/library.state';
import {
	currentTime,
	duration,
	isBuffering,
	isFullscreen,
	isHoveringControls,
	isMuted,
	isPlaying,
	showControls,
	showInfoPanel,
	volume,
} from '@/state/player.state';
import type { VideoEngine } from './useVideoEngine';
import { useVideoEngine } from './useVideoEngine';
import styles from './VideoPlayer.module.scss';

interface VideoPlayerProps {
	streamUrl: string;
	directPlay?: boolean;
	startPosition?: number;
	movie?: Movie | null;
	externalEngine?: VideoEngine | null;
}

export function VideoPlayer({
	streamUrl,
	directPlay = false,
	startPosition = 0,
	movie = null,
	externalEngine,
}: VideoPlayerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Use external engine or create internal one.
	const internalEngine = useVideoEngine(!externalEngine);
	const engine = externalEngine ?? internalEngine;

	// Move video element into our container (preserving play state)
	useEffect(() => {
		if (containerRef.current && engine.videoRef.current) {
			engine.moveVideoTo(containerRef.current);

			// Add click/dblclick handlers to the video element.
			// Delay single-click (toggle play) so a double-click (fullscreen)
			// can cancel it, preventing the pause/unpause flicker.
			const video = engine.videoRef.current;
			let clickTimer: ReturnType<typeof setTimeout> | null = null;
			const handleClick = (e: MouseEvent) => {
				if (e.detail === 1) {
					clickTimer = setTimeout(() => {
						clickTimer = null;
						engine.togglePlay();
					}, 200);
				}
			};
			const handleDblClick = () => {
				if (clickTimer) {
					clearTimeout(clickTimer);
					clickTimer = null;
				}
				toggleFullscreen();
			};
			video.addEventListener('click', handleClick);
			video.addEventListener('dblclick', handleDblClick);
			return () => {
				if (clickTimer) clearTimeout(clickTimer);
				video.removeEventListener('click', handleClick);
				video.removeEventListener('dblclick', handleDblClick);
			};
		}
	}, [engine.videoRef.current]);

	// Initialize playback (only if using internal engine)
	useEffect(() => {
		if (!externalEngine) {
			engine.initPlayback(streamUrl, directPlay, startPosition);
		}
	}, [streamUrl, directPlay, startPosition, externalEngine]);

	// Fullscreen — use document.documentElement so both video area and player bar are visible
	const toggleFullscreen = useCallback(async () => {
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

	// Controls visibility
	const resetControlsTimer = useCallback(() => {
		showControls.value = true;

		if (controlsTimerRef.current) {
			clearTimeout(controlsTimerRef.current);
		}

		if (isPlaying.value) {
			controlsTimerRef.current = setTimeout(() => {
				if (!isHoveringControls.value) {
					showControls.value = false;
				}
			}, 3000);
		}
	}, []);

	const handleMouseMove = useCallback(() => {
		resetControlsTimer();
	}, [resetControlsTimer]);

	const handleMouseLeave = useCallback(() => {
		if (isPlaying.value) {
			controlsTimerRef.current = setTimeout(() => {
				if (!isHoveringControls.value) {
					showControls.value = false;
				}
			}, 1000);
		}
	}, []);

	// Keyboard shortcuts
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
				return;
			}

			switch (e.key) {
				case ' ':
				case 'k':
					e.preventDefault();
					engine.togglePlay();
					break;
				case 'f':
					e.preventDefault();
					toggleFullscreen();
					break;
				case 'i':
					e.preventDefault();
					showInfoPanel.value = !showInfoPanel.value;
					break;
				case 'm':
					e.preventDefault();
					isMuted.value = !isMuted.value;
					break;
				case 'ArrowLeft':
					e.preventDefault();
					engine.seek(Math.max(0, currentTime.value - 10));
					break;
				case 'ArrowRight':
					e.preventDefault();
					engine.seek(Math.min(duration.value, currentTime.value + 10));
					break;
				case 'ArrowUp':
					e.preventDefault();
					volume.value = Math.min(1, volume.value + 0.1);
					break;
				case 'ArrowDown':
					e.preventDefault();
					volume.value = Math.max(0, volume.value - 0.1);
					break;
				case 'Escape':
					if (showInfoPanel.value) {
						e.preventDefault();
						showInfoPanel.value = false;
					}
					break;
			}

			resetControlsTimer();
		}

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [engine, toggleFullscreen, resetControlsTimer]);

	// Fullscreen change detection
	useEffect(() => {
		function handleFullscreenChange() {
			isFullscreen.value = !!document.fullscreenElement;
		}

		document.addEventListener('fullscreenchange', handleFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
	}, []);

	return (
		<div
			ref={containerRef}
			class={`${styles.container} ${showControls.value ? '' : styles.hideControls}`}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
		>
			{/* Video element is inserted here via DOM manipulation */}

			{isBuffering.value && !engine.playbackError && (
				<div class={styles.bufferingOverlay}>
					<div class={styles.bufferingSpinner} />
					{engine.hlsStatus && (
						<span class={styles.bufferingText}>{engine.hlsStatus}</span>
					)}
				</div>
			)}

			{engine.playbackError && (
				<div class={styles.errorOverlay}>
					<div class={styles.errorIcon}>!</div>
					<p class={styles.errorTitle}>Playback Failed</p>
					<p class={styles.errorDetail}>{engine.playbackError}</p>
				</div>
			)}
		</div>
	);
}
