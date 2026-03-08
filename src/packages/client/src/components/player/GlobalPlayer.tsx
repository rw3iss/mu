import { h } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import {
  playerMode,
  globalMovieId,
  globalMovie,
  isPlayerActive,
  maximizePlayer,
  closePlayer,
  startGlobalStream,
} from '@/state/globalPlayer.state';
import {
  currentSession,
  currentTime,
  duration,
  isPlaying,
  initPlayerSettings,
} from '@/state/player.state';
import { useVideoEngine } from './useVideoEngine';
import { setSharedVideoEngine } from '@/state/videoEngineRef';
import styles from './GlobalPlayer.module.scss';

export function GlobalPlayer() {
  const engine = useVideoEngine();
  const miniVideoContainerRef = useRef<HTMLDivElement>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Expose the video engine via module-level ref so Player page can access it
  useEffect(() => {
    setSharedVideoEngine(engine);
    return () => { setSharedVideoEngine(null); };
  }, [engine]);

  // When mode changes or a new movie starts, handle stream initialization
  useEffect(() => {
    if (!isPlayerActive.value || !globalMovieId.value) return;

    // If we don't have a session yet, start one
    if (!currentSession.value) {
      setIsInitializing(true);
      initPlayerSettings();
      startGlobalStream().then((session) => {
        if (session) {
          engine.initPlayback(session.streamUrl, session.directPlay, session.startPosition);
        }
        setIsInitializing(false);
      });
    }
  }, [globalMovieId.value, isPlayerActive.value]);

  // Move video element to mini container when in mini mode
  useEffect(() => {
    if (playerMode.value === 'mini' && miniVideoContainerRef.current && engine.videoRef.current) {
      miniVideoContainerRef.current.appendChild(engine.videoRef.current);
    }
  }, [playerMode.value]);

  // Don't render anything if player is hidden
  if (!isPlayerActive.value) return null;

  // In full mode, don't render mini-bar (Player page handles display)
  if (playerMode.value === 'full') return null;

  // Mini mode: render the bottom bar
  const movie = globalMovie.value;
  const progress = duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0;

  return (
    <div class={styles.miniBar}>
      {/* Mini video thumbnail */}
      <div
        class={styles.miniVideo}
        ref={miniVideoContainerRef}
        onClick={maximizePlayer}
      >
        <div class={styles.miniVideoOverlay}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </div>
      </div>

      {/* Controls area */}
      <div class={styles.miniControls}>
        {/* Title row + close button */}
        <div class={styles.miniTitleRow}>
          <span class={styles.miniTitle}>{movie?.title ?? 'Playing'}</span>
          <button
            class={styles.miniCloseBtn}
            onClick={closePlayer}
            aria-label="Close player"
          >
            {'\u2715'}
          </button>
        </div>

        {/* Seek bar */}
        <div class={styles.miniSeekRow}>
          <MiniSeekBar
            progress={progress}
            currentTime={currentTime.value}
            duration={duration.value}
            onSeek={engine.seek}
          />
        </div>

        {/* Playback controls */}
        <div class={styles.miniButtonRow}>
          <button
            class={styles.miniBtn}
            onClick={() => engine.seek(Math.max(0, currentTime.value - 10))}
            aria-label="Skip back 10s"
          >
            <span class={styles.miniSkipText}>-10s</span>
          </button>

          <button
            class={styles.miniPlayBtn}
            onClick={engine.togglePlay}
            aria-label={isPlaying.value ? 'Pause' : 'Play'}
          >
            {isPlaying.value ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            class={styles.miniBtn}
            onClick={() => engine.seek(Math.min(duration.value, currentTime.value + 10))}
            aria-label="Skip forward 10s"
          >
            <span class={styles.miniSkipText}>+10s</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Mini seek bar sub-component
function MiniSeekBar({
  progress,
  currentTime: ct,
  duration: dur,
  onSeek,
}: {
  progress: number;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: MouseEvent) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(fraction * dur);
  }, [dur, onSeek]);

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div class={styles.miniSeek}>
      <div ref={barRef} class={styles.miniSeekTrack} onClick={handleClick}>
        <div class={styles.miniSeekProgress} style={{ width: `${progress}%` }} />
      </div>
      <span class={styles.miniTimeLabel}>
        {formatTime(ct)} / {formatTime(dur)}
      </span>
    </div>
  );
}
