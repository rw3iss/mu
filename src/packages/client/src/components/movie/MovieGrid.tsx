import { h } from 'preact';
import { MovieCard } from './MovieCard';
import { Spinner } from '@/components/common/Spinner';
import type { Movie } from '@/state/library.state';
import styles from './MovieGrid.module.scss';

interface MovieGridProps {
  movies: Movie[];
  isLoading?: boolean;
  emptyMessage?: string;
}

export function MovieGrid({
  movies,
  isLoading = false,
  emptyMessage = 'No movies found',
}: MovieGridProps) {
  if (isLoading) {
    return (
      <div class={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <div class={styles.empty}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div class={styles.grid}>
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
}
