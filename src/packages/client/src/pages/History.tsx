import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { Button } from '@/components/common/Button';
import { api } from '@/services/api';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import type { Movie } from '@/state/library.state';
import styles from './History.module.scss';

interface HistoryProps {
  path?: string;
}

export function History(_props: HistoryProps) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    setIsLoading(true);
    try {
      const data = await api.get<{
        data: Array<{
          id: string;
          movieId: string;
          watchedAt: string;
          positionSeconds: number;
          durationWatchedSeconds: number;
          completed: boolean;
          movieTitle: string;
          movieYear: number;
          moviePosterUrl: string;
          movieThumbnailUrl: string;
        }>;
      }>('/history');
      setMovies(data.data.map((entry) => ({
        id: entry.movieId,
        title: entry.movieTitle ?? 'Untitled',
        year: entry.movieYear ?? 0,
        overview: '',
        posterUrl: entry.moviePosterUrl || entry.movieThumbnailUrl || '',
        backdropUrl: '',
        runtime: 0,
        genres: [],
        cast: [],
        rating: 0,
        addedAt: entry.watchedAt ?? '',
        watchProgress: entry.positionSeconds ?? 0,
      })));
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClearHistory() {
    try {
      await api.delete('/history');
      setMovies([]);
      notifySuccess('Watch history cleared');
    } catch {
      notifyError('Failed to clear history');
    }
  }

  return (
    <div class={styles.history}>
      <div class={styles.header}>
        <div>
          <h1 class={styles.title}>Watch History</h1>
          {movies.length > 0 && (
            <span class={styles.count}>
              {movies.length} {movies.length === 1 ? 'movie' : 'movies'}
            </span>
          )}
        </div>
        {movies.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClearHistory}>
            Clear History
          </Button>
        )}
      </div>

      <MovieGrid
        movies={movies}
        isLoading={isLoading}
        emptyMessage="No watch history yet. Start watching movies to see them here."
      />
    </div>
  );
}
