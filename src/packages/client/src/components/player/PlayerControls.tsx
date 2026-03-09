import { h, VNode } from 'preact';
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import {
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isFullscreen,
  quality,
  subtitleTrack,
  setVolume,
  toggleMute,
} from '@/state/player.state';
import type { StreamSession } from '@/state/player.state';
import styles from './PlayerControls.module.scss';

interface PlayerControlsProps {
  visible: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onToggleFullscreen: () => void;
  onToggleInfo: () => void;
  session: StreamSession | null;
  title?: string;
  /** When true, fullscreen button shows maximize icon instead */
  hasMiniThumbnail?: boolean;
  /** Element rendered to the left of the controls row, below the seek bar */
  leftSlot?: VNode | null;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const DRAG_THROTTLE_MS = 15;

export function PlayerControls({
  visible,
  onTogglePlay,
  onSeek,
  onToggleFullscreen,
  onToggleInfo,
  session,
  title,
  hasMiniThumbnail,
  leftSlot,
}: PlayerControlsProps) {
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<'main' | 'quality' | 'subtitles'>('main');
  const [seekHover, setSeekHover] = useState<number | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const dragLastSeek = useRef<number>(0);

  const progress = duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0;

  // Close settings on outside click
  useEffect(() => {
    if (!showSettingsMenu) return;
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
        setSettingsPanel('main');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSettingsMenu]);

  // Close volume on outside click
  useEffect(() => {
    if (!showVolume) return;
    function handleClick(e: MouseEvent) {
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setShowVolume(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showVolume]);

  // ── Seek bar: click ──
  const seekFromEvent = useCallback(
    (e: MouseEvent) => {
      const bar = seekBarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return fraction * duration.value;
    },
    [],
  );

  const handleSeekBarClick = useCallback(
    (e: MouseEvent) => {
      if (isDragging) return;
      const time = seekFromEvent(e);
      if (time !== undefined) onSeek(time);
    },
    [onSeek, seekFromEvent, isDragging],
  );

  // ── Seek bar: hover tooltip ──
  const handleSeekHover = useCallback((e: MouseEvent) => {
    const bar = seekBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSeekHover(fraction * duration.value);
  }, []);

  // ── Seek bar: drag ──
  const handleSeekMouseDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragLastSeek.current = 0;

      const onMove = (me: MouseEvent) => {
        const now = performance.now();
        if (now - dragLastSeek.current < DRAG_THROTTLE_MS) return;
        dragLastSeek.current = now;

        const bar = seekBarRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
        onSeek(fraction * duration.value);
      };

      const onUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setIsDragging(false);

        const bar = seekBarRef.current;
        if (bar) {
          const rect = bar.getBoundingClientRect();
          const fraction = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
          onSeek(fraction * duration.value);
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

      const bar = seekBarRef.current;
      if (bar) {
        const rect = bar.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onSeek(fraction * duration.value);
      }
    },
    [onSeek],
  );

  // ── Volume ──
  const handleVolumeChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    setVolume(parseFloat(target.value));
  }, []);

  const toggleVolumePopup = useCallback(() => {
    setShowVolume((v) => !v);
  }, []);

  // ── Skip ──
  const skipBack = useCallback(
    (seconds: number) => {
      onSeek(Math.max(0, currentTime.value - seconds));
    },
    [onSeek],
  );

  const skipForward = useCallback(
    (seconds: number) => {
      onSeek(Math.min(duration.value, currentTime.value + seconds));
    },
    [onSeek],
  );

  // ── Settings ──
  const handleQualitySelect = useCallback((q: string) => {
    quality.value = q;
    setShowSettingsMenu(false);
    setSettingsPanel('main');
  }, []);

  const handleSubtitleSelect = useCallback((trackId: string | null) => {
    subtitleTrack.value = trackId;
    setShowSettingsMenu(false);
    setSettingsPanel('main');
  }, []);

  const toggleSettings = useCallback(() => {
    setShowSettingsMenu((v) => !v);
    setSettingsPanel('main');
  }, []);

  // ── Volume SVG icons ──
  const VolumeIcon = () => {
    const v = volume.value;
    const muted = isMuted.value || v === 0;

    const speakerBody = (
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="white" stroke="none" />
    );

    if (muted) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {speakerBody}
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      );
    }

    if (v <= 0.32) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {speakerBody}
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      );
    }

    if (v <= 0.66) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {speakerBody}
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      );
    }

    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {speakerBody}
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M17.7 6.3a7.5 7.5 0 0 1 0 11.4" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    );
  };

  return (
    <div class={`${styles.controls} ${visible ? styles.visible : ''} ${hasMiniThumbnail ? styles.miniMode : ''}`}>
      {/* ── Row 1: Seek bar — flush to top, full width ── */}
      <div class={styles.seekRow}>
        <div
          ref={seekBarRef}
          class={`${styles.seekBar} ${isDragging ? styles.dragging : ''}`}
          onClick={handleSeekBarClick}
          onMouseDown={handleSeekMouseDown}
          onMouseMove={handleSeekHover}
          onMouseLeave={() => setSeekHover(null)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration.value}
          aria-valuenow={currentTime.value}
        >
          <div class={styles.seekTrack}>
            <div class={styles.seekProgress} style={{ width: `${progress}%` }} />
            <div class={styles.seekThumb} style={{ left: `${progress}%` }} />
          </div>
          {seekHover !== null && (
            <div
              class={styles.seekTooltip}
              style={{
                left: `${(seekHover / (duration.value || 1)) * 100}%`,
              }}
            >
              {formatTime(seekHover)}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Content row — optional left slot + controls ── */}
      <div class={styles.contentRow}>
        {leftSlot}
        <div class={styles.mainRow}>
          {/* Left: title + timing */}
          <div class={styles.leftSection}>
          {title && <span class={styles.titleText}>{title}</span>}
          <span class={styles.timingLabel}>
            {formatTime(currentTime.value)} / {formatTime(duration.value)}
          </span>
        </div>

        {/* Center: skip-back, play, skip-forward */}
        <div class={styles.centerControls}>
          <button
            class={`${styles.controlBtn} ${styles.skipBtn}`}
            onClick={() => skipBack(10)}
            aria-label="Skip back 10 seconds"
          >
            <span class={styles.skipText}>-10s</span>
          </button>

          <button
            class={`${styles.controlBtn} ${styles.playBtn}`}
            onClick={onTogglePlay}
            aria-label={isPlaying.value ? 'Pause' : 'Play'}
          >
            {isPlaying.value ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            class={`${styles.controlBtn} ${styles.skipBtn}`}
            onClick={() => skipForward(10)}
            aria-label="Skip forward 10 seconds"
          >
            <span class={styles.skipText}>+10s</span>
          </button>
        </div>

        {/* Right: info, volume, settings, fullscreen, minimize, close */}
        <div class={styles.rightControls}>
          {/* Info */}
          <button
            class={styles.controlBtn}
            onClick={onToggleInfo}
            aria-label="Movie info"
            title="Info"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>

          {/* Volume */}
          <div class={styles.volumeWrap} ref={volumeRef}>
            <button
              class={styles.controlBtn}
              onClick={toggleVolumePopup}
              aria-label={isMuted.value ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon />
            </button>

            {showVolume && (
              <div class={styles.volumePopup}>
                <input
                  type="range"
                  class={styles.volumeSlider}
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted.value ? 0 : volume.value}
                  onInput={handleVolumeChange}
                  aria-label="Volume"
                  orient="vertical"
                />
                <button
                  class={styles.volumeMuteBtn}
                  onClick={toggleMute}
                  aria-label={isMuted.value ? 'Unmute' : 'Mute'}
                >
                  <VolumeIcon />
                </button>
              </div>
            )}
          </div>

          {/* Settings */}
          <div class={styles.menuContainer} ref={settingsRef}>
            <button
              class={`${styles.controlBtn} ${showSettingsMenu ? styles.active : ''}`}
              onClick={toggleSettings}
              aria-label="Settings"
              title="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            {showSettingsMenu && (
              <div class={styles.menu}>
                {settingsPanel === 'main' && (
                  <>
                    <button
                      class={styles.menuRow}
                      onClick={() => setSettingsPanel('quality')}
                    >
                      <span class={styles.menuRowLabel}>Quality</span>
                      <span class={styles.menuRowValue}>
                        {quality.value === 'auto' ? 'Auto' : quality.value}
                        {' \u203A'}
                      </span>
                    </button>

                    {session?.subtitles && session.subtitles.length > 0 && (
                      <button
                        class={styles.menuRow}
                        onClick={() => setSettingsPanel('subtitles')}
                      >
                        <span class={styles.menuRowLabel}>Subtitles</span>
                        <span class={styles.menuRowValue}>
                          {subtitleTrack.value
                            ? session.subtitles.find((t) => t.id === subtitleTrack.value)
                                ?.label ?? 'On'
                            : 'Off'}
                          {' \u203A'}
                        </span>
                      </button>
                    )}
                  </>
                )}

                {settingsPanel === 'quality' && (
                  <>
                    <button
                      class={styles.menuBack}
                      onClick={() => setSettingsPanel('main')}
                    >
                      {'\u2039'} Quality
                    </button>
                    <button
                      class={`${styles.menuItem} ${quality.value === 'auto' ? styles.selected : ''}`}
                      onClick={() => handleQualitySelect('auto')}
                    >
                      Auto
                    </button>
                    {(session?.qualities ?? []).map((q) => (
                      <button
                        key={q.label}
                        class={`${styles.menuItem} ${
                          quality.value === q.label ? styles.selected : ''
                        }`}
                        onClick={() => handleQualitySelect(q.label)}
                      >
                        {q.label} ({q.height}p)
                      </button>
                    ))}
                  </>
                )}

                {settingsPanel === 'subtitles' && (
                  <>
                    <button
                      class={styles.menuBack}
                      onClick={() => setSettingsPanel('main')}
                    >
                      {'\u2039'} Subtitles
                    </button>
                    <button
                      class={`${styles.menuItem} ${subtitleTrack.value === null ? styles.selected : ''}`}
                      onClick={() => handleSubtitleSelect(null)}
                    >
                      Off
                    </button>
                    {(session?.subtitles ?? []).map((track) => (
                      <button
                        key={track.id}
                        class={`${styles.menuItem} ${
                          subtitleTrack.value === track.id ? styles.selected : ''
                        }`}
                        onClick={() => handleSubtitleSelect(track.id)}
                      >
                        {track.label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <button
            class={styles.controlBtn}
            onClick={onToggleFullscreen}
            aria-label={hasMiniThumbnail ? 'Maximize player' : (isFullscreen.value ? 'Exit fullscreen' : 'Enter fullscreen')}
            title={hasMiniThumbnail ? 'Maximize' : (isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen')}
          >
            {hasMiniThumbnail ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            ) : isFullscreen.value ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
