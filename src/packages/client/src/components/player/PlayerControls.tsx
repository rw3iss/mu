import { h } from 'preact';
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

export function PlayerControls({
  visible,
  onTogglePlay,
  onSeek,
  onToggleFullscreen,
  onToggleInfo,
  session,
  title,
}: PlayerControlsProps) {
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<'main' | 'quality' | 'subtitles'>('main');
  const [seekHover, setSeekHover] = useState<number | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

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

  const handleSeekBarClick = useCallback(
    (e: MouseEvent) => {
      const bar = seekBarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(fraction * duration.value);
    },
    [onSeek]
  );

  const handleSeekHover = useCallback((e: MouseEvent) => {
    const bar = seekBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSeekHover(fraction * duration.value);
  }, []);

  const handleVolumeChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    setVolume(parseFloat(target.value));
  }, []);

  const skipBack = useCallback(
    (seconds: number) => {
      onSeek(Math.max(0, currentTime.value - seconds));
    },
    [onSeek]
  );

  const skipForward = useCallback(
    (seconds: number) => {
      onSeek(Math.min(duration.value, currentTime.value + seconds));
    },
    [onSeek]
  );

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

  const volumeIcon =
    isMuted.value || volume.value === 0
      ? '\u{1F507}'
      : volume.value < 0.5
        ? '\u{1F509}'
        : '\u{1F50A}';

  return (
    <div class={`${styles.controls} ${visible ? styles.visible : ''}`}>
      {/* Gradient overlay */}
      <div class={styles.gradient} />

      {/* Top bar — title */}
      {title && (
        <div class={styles.topBar}>
          <span class={styles.nowPlaying}>{title}</span>
        </div>
      )}

      {/* Seek bar */}
      <div class={styles.seekContainer}>
        <div
          ref={seekBarRef}
          class={styles.seekBar}
          onClick={handleSeekBarClick}
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

      {/* Bottom controls */}
      <div class={styles.bottomBar}>
        <div class={styles.leftControls}>
          {/* Play/Pause */}
          <button
            class={styles.controlButton}
            onClick={onTogglePlay}
            aria-label={isPlaying.value ? 'Pause' : 'Play'}
          >
            {isPlaying.value ? '\u275A\u275A' : '\u25B6'}
          </button>

          {/* Skip back 10s */}
          <button
            class={styles.controlButton}
            onClick={() => skipBack(10)}
            aria-label="Skip back 10 seconds"
            title="-10s"
          >
            <span class={styles.skipIcon}>
              <span class={styles.skipArrow}>{'\u21BA'}</span>
              <span class={styles.skipLabel}>10</span>
            </span>
          </button>

          {/* Skip forward 30s */}
          <button
            class={styles.controlButton}
            onClick={() => skipForward(30)}
            aria-label="Skip forward 30 seconds"
            title="+30s"
          >
            <span class={styles.skipIcon}>
              <span class={styles.skipArrow}>{'\u21BB'}</span>
              <span class={styles.skipLabel}>30</span>
            </span>
          </button>

          {/* Volume */}
          <div class={styles.volumeGroup}>
            <button
              class={styles.controlButton}
              onClick={toggleMute}
              aria-label={isMuted.value ? 'Unmute' : 'Mute'}
            >
              {volumeIcon}
            </button>
            <input
              type="range"
              class={styles.volumeSlider}
              min="0"
              max="1"
              step="0.05"
              value={isMuted.value ? 0 : volume.value}
              onInput={handleVolumeChange}
              aria-label="Volume"
            />
          </div>

          {/* Time display */}
          <span class={styles.timeDisplay}>
            {formatTime(currentTime.value)} / {formatTime(duration.value)}
          </span>
        </div>

        <div class={styles.rightControls}>
          {/* Info panel toggle */}
          <button
            class={styles.controlButton}
            onClick={onToggleInfo}
            aria-label="Movie info"
            title="Info"
          >
            {'\u24D8'}
          </button>

          {/* Settings (quality + subtitles) */}
          <div class={styles.menuContainer} ref={settingsRef}>
            <button
              class={`${styles.controlButton} ${showSettingsMenu ? styles.active : ''}`}
              onClick={toggleSettings}
              aria-label="Settings"
              title="Settings"
            >
              {'\u2699'}
            </button>

            {showSettingsMenu && (
              <div class={styles.menu}>
                {settingsPanel === 'main' && (
                  <>
                    {/* Quality row */}
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

                    {/* Subtitles row */}
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
            class={styles.controlButton}
            onClick={onToggleFullscreen}
            aria-label={isFullscreen.value ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen.value ? '\u2716' : '\u26F6'}
          </button>
        </div>
      </div>
    </div>
  );
}
