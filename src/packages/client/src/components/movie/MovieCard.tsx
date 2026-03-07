import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import type { Movie } from '@/state/library.state';
import styles from './MovieCard.module.scss';

interface MovieCardProps {
  movie: Movie;
}

export function MovieCard({ movie }: MovieCardProps) {
  const handleClick = useCallback(() => {
    route(`/movie/${movie.id}`);
  }, [movie.id]);

  const handlePlay = useCallback(
    (e: Event) => {
      e.stopPropagation();
      route(`/player/${movie.id}`);
    },
    [movie.id]
  );

  const rating = movie.rating ?? 0;
  const ratingColor =
    rating >= 7
      ? 'var(--color-success)'
      : rating >= 5
        ? 'var(--color-warning)'
        : 'var(--color-error)';

  return (
    <div class={styles.card} onClick={handleClick} role="button" tabIndex={0}>
      <div class={styles.poster}>
        {movie.posterUrl ? (
          <img
            src={movie.posterUrl}
            alt={`${movie.title} poster`}
            loading="lazy"
            class={styles.posterImage}
          />
        ) : (
          <div class={styles.posterPlaceholder}>
            <span>{(movie.title ?? '?').charAt(0)}</span>
          </div>
        )}

        {rating > 0 && (
          <div class={styles.ratingBadge} style={{ background: ratingColor }}>
            {rating.toFixed(1)}
          </div>
        )}

        {movie.watchProgress !== undefined && movie.watchProgress > 0 && (
          <div class={styles.progressBar}>
            <div
              class={styles.progressFill}
              style={{ width: `${Math.min(movie.watchProgress * 100, 100)}%` }}
            />
          </div>
        )}

        <div class={styles.overlay}>
          <button
            class={styles.playButton}
            onClick={handlePlay}
            aria-label={`Play ${movie.title}`}
          >
            {'\u25B6'}
          </button>
        </div>
      </div>

      <div class={styles.info}>
        <h3 class={styles.title}>{movie.title}</h3>
        <span class={styles.year}>{movie.year}</span>
      </div>
    </div>
  );
}
