import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Spinner } from '@/components/common/Spinner';
import {
  playerMode,
  globalMovieId,
  globalMovie,
  playMovie,
  minimizePlayer,
  closePlayer,
} from '@/state/globalPlayer.state';
import {
  currentSession,
  showControls,
} from '@/state/player.state';
import { sharedVideoEngine } from '@/state/videoEngineRef';
import { notifyError } from '@/state/notifications.state';
import styles from './Player.module.scss';

interface PlayerProps {
  path?: string;
  id?: string;
}

export function Player({ id }: PlayerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    async function init() {
      setIsLoading(true);
      setError(null);

      try {
        // If globalPlayer is already playing this movie, just set mode to full
        if (globalMovieId.value === id && currentSession.value) {
          playerMode.value = 'full';
          setIsLoading(false);
          return;
        }

        // Otherwise, tell globalPlayer to start this movie
        await playMovie(id);
      } catch (err) {
        console.error('Failed to start stream:', err);
        setError('Failed to start playback');
        notifyError('Failed to start playback');
      } finally {
        setIsLoading(false);
      }
    }

    init();

    // No cleanup needed - globalPlayer manages the stream lifecycle
  }, [id]);

  if (isLoading) {
    return (
      <div class={styles.player}>
        <div class={styles.loading}>
          <Spinner size="lg" color="#ffffff" />
          <span>Preparing stream...</span>
        </div>
      </div>
    );
  }

  if (error || !currentSession.value) {
    return (
      <div class={styles.player}>
        <div class={styles.error}>
          <p>{error || 'Something went wrong'}</p>
          <button class={styles.backButton} onClick={() => id ? route(`/movie/${id}`) : history.back()}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const movie = globalMovie.value;
  const engine = sharedVideoEngine;

  return (
    <div class={styles.player}>
      {/* Minimize button - upper left */}
      <button
        class={`${styles.minimizeButton} ${showControls.value ? styles.buttonVisible : ''}`}
        onClick={minimizePlayer}
        aria-label="Minimize player"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Close button - upper right */}
      <button
        class={`${styles.closeButton} ${showControls.value ? styles.buttonVisible : ''}`}
        onClick={closePlayer}
        aria-label="Close player"
      >
        {'\u2715'}
      </button>

      <VideoPlayer
        streamUrl={currentSession.value.streamUrl}
        directPlay={currentSession.value.directPlay}
        startPosition={currentSession.value.startPosition}
        movie={movie}
        externalEngine={engine}
      />
    </div>
  );
}
