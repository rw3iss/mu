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
        // Retry manifest/fragment loads while transcoder is generating
        manifestLoadingMaxRetry: 30,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 10,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 30,
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

      let networkRetries = 0;
      let mediaRetries = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (networkRetries < 3) {
                networkRetries++;
                console.error(`[HLS] Network error, recovery attempt ${networkRetries}/3`);
                hls.startLoad();
              } else {
                console.error('[HLS] Network error, max retries exceeded — destroying');
                hls.destroy();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (mediaRetries < 3) {
                mediaRetries++;
                console.error(`[HLS] Media error, recovery attempt ${mediaRetries}/3`);
                hls.recoverMediaError();
              } else {
                console.error('[HLS] Media error, max retries exceeded — destroying');
                hls.destroy();
              }
              break;
            default:
              console.error('[HLS] Fatal error, destroying');
              hls.destroy();
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

      {isBuffering.value && (
        <div class={styles.bufferingOverlay}>
          <div class={styles.bufferingSpinner} />
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
