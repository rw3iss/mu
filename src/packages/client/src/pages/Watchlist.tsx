import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { api } from '@/services/api';
import type { Movie } from '@/state/library.state';
import styles from './Watchlist.module.scss';

interface WatchlistProps {
  path?: string;
}

export function Watchlist(_props: WatchlistProps) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const data = await api.get<Array<{
          id: string;
          movieId: string;
          addedAt: string;
          notes: string | null;
          movieTitle: string;
          movieYear: number;
          moviePosterUrl: string;
          movieOverview: string;
          movieRuntimeMinutes: number;
        }>>('/watchlist');
        // Map watchlist entries to Movie shape for MovieGrid
        setMovies(data.map((entry) => ({
          id: entry.movieId,
          title: entry.movieTitle ?? 'Untitled',
          year: entry.movieYear ?? 0,
          overview: entry.movieOverview ?? '',
          posterUrl: entry.moviePosterUrl ?? '',
          backdropUrl: '',
          runtime: entry.movieRuntimeMinutes ?? 0,
          genres: [],
          cast: [],
          rating: 0,
          addedAt: entry.addedAt ?? '',
          inWatchlist: true,
        })));
      } catch (error) {
        console.error('Failed to load watchlist:', error);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, []);

  return (
    <div class={styles.watchlist}>
      <div class={styles.header}>
        <h1 class={styles.title}>Watchlist</h1>
        {movies.length > 0 && (
          <span class={styles.count}>
            {movies.length} {movies.length === 1 ? 'movie' : 'movies'}
          </span>
        )}
      </div>

      <MovieGrid
        movies={movies}
        isLoading={isLoading}
        emptyMessage="Your watchlist is empty. Browse the library and add movies you want to watch."
      />
    </div>
  );
}
