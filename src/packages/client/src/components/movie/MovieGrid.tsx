import { h } from 'preact';
import { MovieCard } from './MovieCard';
import { MovieLargeCard } from './MovieLargeCard';
import { MovieListItem } from './MovieListItem';
import { Spinner } from '@/components/common/Spinner';
import type { Movie, ViewMode } from '@/state/library.state';
import styles from './MovieGrid.module.scss';

interface MovieGridProps {
  movies: Movie[];
  isLoading?: boolean;
  emptyMessage?: string;
  viewMode?: ViewMode;
}

export function MovieGrid({
  movies,
  isLoading = false,
  emptyMessage = 'No movies found',
  viewMode = 'grid',
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

  if (viewMode === 'list') {
    return (
      <div class={styles.list}>
        {movies.map((movie) => (
          <MovieListItem key={movie.id} movie={movie} />
        ))}
      </div>
    );
  }

  if (viewMode === 'large') {
    return (
      <div class={styles.largeGrid}>
        {movies.map((movie) => (
          <MovieLargeCard key={movie.id} movie={movie} />
        ))}
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
