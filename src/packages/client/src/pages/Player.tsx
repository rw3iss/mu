import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Spinner } from '@/components/common/Spinner';
import {
  startStream,
  endStream,
  initPlayerSettings,
  showControls,
} from '@/state/player.state';
import { moviesService } from '@/services/movies.service';
import { notifyError } from '@/state/notifications.state';
import type { StreamSession } from '@/state/player.state';
import type { Movie } from '@/state/library.state';
import styles from './Player.module.scss';

interface PlayerProps {
  path?: string;
  id?: string;
}

export function Player({ id }: PlayerProps) {
  const [session, setSession] = useState<StreamSession | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    initPlayerSettings();

    async function init() {
      setIsLoading(true);
      setError(null);

      try {
        const [s, m] = await Promise.all([
          startStream(id!),
          moviesService.get(id!).catch(() => null),
        ]);
        setSession(s);
        setMovie(m);
      } catch (err) {
        console.error('Failed to start stream:', err);
        setError('Failed to start playback');
        notifyError('Failed to start playback');
      } finally {
        setIsLoading(false);
      }
    }

    init();

    return () => {
      endStream();
    };
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

  if (error || !session) {
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

  return (
    <div class={styles.player}>
      <button
        class={`${styles.closeButton} ${showControls.value ? styles.closeVisible : ''}`}
        onClick={() => route(`/movie/${id}`)}
        aria-label="Close player"
      >
        {'\u2715'}
      </button>

      <VideoPlayer
        streamUrl={session.streamUrl}
        directPlay={session.directPlay}
        startPosition={session.startPosition}
        movie={movie}
      />
    </div>
  );
}
