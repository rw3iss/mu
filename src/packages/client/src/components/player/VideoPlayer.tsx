import { h } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import { PlayerControls } from './PlayerControls';
import { InfoPanel } from './InfoPanel';
import { useVideoEngine } from './useVideoEngine';
import type { VideoEngine } from './useVideoEngine';
import {
  currentSession,
  currentTime,
  duration,
  volume,
  isMuted,
  isFullscreen,
  isBuffering,
  showControls,
  isPlaying,
} from '@/state/player.state';
import type { Movie } from '@/state/library.state';
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
  const [showInfo, setShowInfo] = useState(false);

  // Use external engine or create internal one
  const internalEngine = useVideoEngine();
  const engine = externalEngine ?? internalEngine;

  // Move video element into our container
  useEffect(() => {
    if (containerRef.current && engine.videoRef.current) {
      containerRef.current.insertBefore(
        engine.videoRef.current,
        containerRef.current.firstChild,
      );
      // Add click/dblclick handlers to the video element
      const video = engine.videoRef.current;
      const handleClick = () => engine.togglePlay();
      const handleDblClick = () => toggleFullscreen();
      video.addEventListener('click', handleClick);
      video.addEventListener('dblclick', handleDblClick);
      return () => {
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

  // Fullscreen
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        isFullscreen.value = false;
      } else {
        await container.requestFullscreen();
        isFullscreen.value = true;
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, []);

  const toggleInfo = useCallback(() => {
    setShowInfo((v) => !v);
  }, []);

  // Controls visibility
  const resetControlsTimer = useCallback(() => {
    showControls.value = true;

    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }

    if (isPlaying.value) {
      controlsTimerRef.current = setTimeout(() => {
        showControls.value = false;
      }, 3000);
    }
  }, []);

  const handleMouseMove = useCallback(() => {
    resetControlsTimer();
  }, [resetControlsTimer]);

  const handleMouseLeave = useCallback(() => {
    if (isPlaying.value) {
      controlsTimerRef.current = setTimeout(() => {
        showControls.value = false;
      }, 1000);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
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
          toggleInfo();
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
          if (showInfo) {
            e.preventDefault();
            setShowInfo(false);
          }
          break;
      }

      resetControlsTimer();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [engine, toggleFullscreen, toggleInfo, resetControlsTimer, showInfo]);

  // Fullscreen change detection
  useEffect(() => {
    function handleFullscreenChange() {
      isFullscreen.value = !!document.fullscreenElement;
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
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
        </div>
      )}

      {engine.playbackError && (
        <div class={styles.errorOverlay}>
          <div class={styles.errorIcon}>!</div>
          <p class={styles.errorTitle}>Playback Failed</p>
          <p class={styles.errorDetail}>{engine.playbackError}</p>
        </div>
      )}

      <PlayerControls
        visible={showControls.value}
        onTogglePlay={engine.togglePlay}
        onSeek={engine.seek}
        onToggleFullscreen={toggleFullscreen}
        onToggleInfo={toggleInfo}
        session={currentSession.value}
        title={movie?.title}
      />

      <InfoPanel movie={movie} visible={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  );
}
