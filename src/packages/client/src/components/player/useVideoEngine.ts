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

const BUFFER_CONFIGS: Record<string, { maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number }> = {
  small:  { maxBufferLength: 10,  maxMaxBufferLength: 20,  maxBufferSize: 15 * 1024 * 1024 },
  normal: { maxBufferLength: 30,  maxMaxBufferLength: 60,  maxBufferSize: 60 * 1024 * 1024 },
  large:  { maxBufferLength: 60,  maxMaxBufferLength: 120, maxBufferSize: 120 * 1024 * 1024 },
  max:    { maxBufferLength: 120, maxMaxBufferLength: 240, maxBufferSize: 250 * 1024 * 1024 },
};

const MAX_RECOVERIES = 3;
const RECOVERY_BASE_DELAY_MS = 2000;

export interface VideoEngine {
  videoRef: { current: HTMLVideoElement | null };
  playbackError: string | null;
  togglePlay: () => void;
  seek: (time: number) => void;
  initPlayback: (streamUrl: string, directPlay: boolean, startPosition: number) => void;
  destroy: () => void;
}

/**
 * Creates a persistent video element and manages HLS playback.
 * The video element lives for the lifetime of the component that
 * calls this hook (GlobalPlayer) and can be moved between containers.
 */
export function useVideoEngine(): VideoEngine {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDisplayTime = useRef<number>(0);
  const seekLockRef = useRef(false);
  const seekLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const bufferConfig = useMemo(() => {
    const stored = getUiSetting('buffer_size', 'normal');
    return BUFFER_CONFIGS[stored] || BUFFER_CONFIGS.normal;
  }, []);

  // Create the video element once on mount
  useEffect(() => {
    if (!videoRef.current) {
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      videoRef.current = video;

      video.addEventListener('durationchange', () => {
        if (video.duration && isFinite(video.duration)) {
          duration.value = video.duration;
        }
      });
      video.addEventListener('play', () => { isPlaying.value = true; });
      video.addEventListener('pause', () => { isPlaying.value = false; });
      video.addEventListener('waiting', () => { isBuffering.value = true; });
      video.addEventListener('canplay', () => { isBuffering.value = false; });
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
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (videoRef.current?.parentNode) {
        videoRef.current.parentNode.removeChild(videoRef.current);
      }
      videoRef.current = null;
    };
  }, []);

  // Sync volume/mute state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume.value;
    video.muted = isMuted.value;
  }, [volume.value, isMuted.value]);

  const initPlayback = useCallback((streamUrl: string, directPlay: boolean, startPosition: number) => {
    const video = videoRef.current;
    if (!video) return;

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setPlaybackError(null);

    if (directPlay || !Hls.isSupported()) {
      const token = localStorage.getItem('mu_token');
      const sep = streamUrl.includes('?') ? '&' : '?';
      video.src = token ? `${streamUrl}${sep}token=${encodeURIComponent(token)}` : streamUrl;
      if (startPosition > 0) video.currentTime = startPosition;
      video.play().catch(() => {});
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
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 5,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        xhrSetup(xhr) {
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        },
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startPosition > 0) video.currentTime = startPosition;
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
              console.warn(`[HLS] Network error, recovery ${networkRecoveries}/${MAX_RECOVERIES} in ${delay}ms`);
              setTimeout(() => { if (hlsRef.current) hls.startLoad(); }, delay);
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
              console.warn(`[HLS] Media error, recovery ${mediaRecoveries}/${MAX_RECOVERIES}`);
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
  }, [bufferConfig]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    seekLockRef.current = true;
    video.currentTime = time;
    currentTime.value = time;
    lastDisplayTime.current = time;
    if (seekLockTimerRef.current) clearTimeout(seekLockTimerRef.current);
    seekLockTimerRef.current = setTimeout(() => { seekLockRef.current = false; }, 150);
  }, []);

  const destroy = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  return { videoRef, playbackError, togglePlay, seek, initPlayback, destroy };
}
