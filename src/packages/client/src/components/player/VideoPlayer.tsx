import { h } from 'preact';
import { useEffect, useRef, useCallback, useState, useMemo } from 'preact/hooks';
import Hls from 'hls.js';
import { PlayerControls } from './PlayerControls';
import { InfoPanel } from './InfoPanel';
import {
  currentSession,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isFullscreen,
  isBuffering,
  showControls,
  updateProgress,
} from '@/state/player.state';
import { getUiSetting } from '@/hooks/useUiSetting';
import type { Movie } from '@/state/library.state';
import styles from './VideoPlayer.module.scss';

const BUFFER_CONFIGS: Record<string, { maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number }> = {
  small:  { maxBufferLength: 10,  maxMaxBufferLength: 20,  maxBufferSize: 15 * 1024 * 1024 },
  normal: { maxBufferLength: 30,  maxMaxBufferLength: 60,  maxBufferSize: 60 * 1024 * 1024 },
  large:  { maxBufferLength: 60,  maxMaxBufferLength: 120, maxBufferSize: 120 * 1024 * 1024 },
  max:    { maxBufferLength: 120, maxMaxBufferLength: 240, maxBufferSize: 250 * 1024 * 1024 },
};

/** Max recovery attempts after HLS.js exhausts per-fragment retries */
const MAX_RECOVERIES = 3;
/** Base delay before each recovery attempt (multiplied by attempt number) */
const RECOVERY_BASE_DELAY_MS = 2000;

interface VideoPlayerProps {
  streamUrl: string;
  directPlay?: boolean;
  startPosition?: number;
  movie?: Movie | null;
}

export function VideoPlayer({
  streamUrl,
  directPlay = false,
  startPosition = 0,
  movie = null,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const bufferConfig = useMemo(() => {
    const stored = getUiSetting('buffer_size', 'normal');
    return BUFFER_CONFIGS[stored] || BUFFER_CONFIGS.normal;
  }, []);

  // Initialize HLS or native playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (directPlay || !Hls.isSupported()) {
      // Direct play or native HLS (Safari) — append token for authenticated access
      const token = localStorage.getItem('mu_token');
      const sep = streamUrl.includes('?') ? '&' : '?';
      video.src = token ? `${streamUrl}${sep}token=${encodeURIComponent(token)}` : streamUrl;
      if (startPosition > 0) {
        video.currentTime = startPosition;
      }
      video.play().catch(() => {});
    } else {
      // HLS.js playback — configured for transcoded/remuxed streams
      const token = localStorage.getItem('mu_token');
      const hls = new Hls({
        startPosition,
        enableWorker: true,
        lowLatencyMode: false,
        startFragPrefetch: true,
        maxBufferLength: bufferConfig.maxBufferLength,
        maxMaxBufferLength: bufferConfig.maxMaxBufferLength,
        maxBufferSize: bufferConfig.maxBufferSize,
        // 5 fast retries per fragment/manifest before escalating to fatal
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 5,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        // Inject auth token into all HLS.js XHR requests
        xhrSetup(xhr) {
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
        },
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startPosition > 0) {
          video.currentTime = startPosition;
        }
        video.play().catch(() => {});
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
                `[HLS] Network error (${detail}${statusCode ? ` HTTP ${statusCode}` : ''}), ` +
                `recovery ${networkRecoveries}/${MAX_RECOVERIES} in ${delay}ms`,
              );
              setTimeout(() => {
                if (hlsRef.current) hls.startLoad();
              }, delay);
            } else {
              const msg = `Network error: unable to load video segments after ${5 + MAX_RECOVERIES} attempts (${detail}${statusCode ? `, HTTP ${statusCode}` : ''})`;
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
                `[HLS] Media error (${detail}), recovery ${mediaRecoveries}/${MAX_RECOVERIES}`,
              );
              hls.recoverMediaError();
            } else {
              const msg = `Media error: video could not be decoded (${detail})`;
              console.error(`[HLS] ${msg}`);
              setPlaybackError(msg);
              hls.destroy();
              hlsRef.current = null;
            }
            break;
          default: {
            const msg = `Playback error: ${detail}`;
            console.error(`[HLS] Fatal error: ${detail}`);
            setPlaybackError(msg);
            hls.destroy();
            hlsRef.current = null;
            break;
          }
        }
      });

      hlsRef.current = hls;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, directPlay, startPosition]);

  // Sync volume/mute state to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume.value;
    video.muted = isMuted.value;
  }, [volume.value, isMuted.value]);

  // Progress reporting every 10s
  useEffect(() => {
    progressIntervalRef.current = setInterval(() => {
      if (isPlaying.value && videoRef.current) {
        updateProgress(videoRef.current.currentTime);
      }
    }, 10000);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // Video event handlers
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      currentTime.value = video.currentTime;
    }
  }, []);

  const handleDurationChange = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration && isFinite(video.duration)) {
      duration.value = video.duration;
    }
  }, []);

  const handlePlay = useCallback(() => {
    isPlaying.value = true;
  }, []);

  const handlePause = useCallback(() => {
    isPlaying.value = false;
  }, []);

  const handleWaiting = useCallback(() => {
    isBuffering.value = true;
  }, []);

  const handleCanPlay = useCallback(() => {
    isBuffering.value = false;
  }, []);

  // Playback controls
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      currentTime.value = time;
    }
  }, []);

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
      // Don't handle if typing in an input
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
          togglePlay();
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
          seek(Math.max(0, currentTime.value - 10));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(duration.value, currentTime.value + 10));
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
  }, [togglePlay, toggleFullscreen, toggleInfo, seek, resetControlsTimer, showInfo]);

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
      <video
        ref={videoRef}
        class={styles.video}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPlay={handlePlay}
        onPause={handlePause}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onClick={togglePlay}
        autoPlay
        playsInline
      />

      {isBuffering.value && !playbackError && (
        <div class={styles.bufferingOverlay}>
          <div class={styles.bufferingSpinner} />
        </div>
      )}

      {playbackError && (
        <div class={styles.errorOverlay}>
          <div class={styles.errorIcon}>!</div>
          <p class={styles.errorTitle}>Playback Failed</p>
          <p class={styles.errorDetail}>{playbackError}</p>
        </div>
      )}

      <PlayerControls
        visible={showControls.value}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onToggleFullscreen={toggleFullscreen}
        onToggleInfo={toggleInfo}
        session={currentSession.value}
        title={movie?.title}
      />

      <InfoPanel movie={movie} visible={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  );
}
