import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import styles from './PersonDetail.module.scss';

// ============================================
// Types
// ============================================

interface PersonDetailProps {
  path?: string;
  id?: string;
}

// ============================================
// Component
// ============================================

export function PersonDetail({ id }: PersonDetailProps) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // The id param is the URL-encoded person name
  const personName = id ? decodeURIComponent(id) : '';

  useEffect(() => {
    if (!personName) {
      setIsLoading(false);
      return;
    }

    async function loadFilmography() {
      setIsLoading(true);
      try {
        const response = await moviesService.search(personName);
        setMovies(response.movies);
        setTotalResults(response.total);
      } catch (error) {
        console.error('Failed to load filmography:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadFilmography();
  }, [personName]);

  if (!personName) {
    return (
      <div class={styles.notFound}>
        <h2>Person not found</h2>
      </div>
    );
  }

  return (
    <div class={styles.personDetail}>
      <div class={styles.header}>
        <div class={styles.avatar}>
          <span>{personName.charAt(0).toUpperCase()}</span>
        </div>
        <div class={styles.headerInfo}>
          <h1 class={styles.title}>{personName}</h1>
          {!isLoading && (
            <span class={styles.count}>
              {totalResults} {totalResults === 1 ? 'movie' : 'movies'} in your
              library
            </span>
          )}
        </div>
      </div>

      <div class={styles.section}>
        <h2 class={styles.sectionTitle}>Filmography</h2>
        <MovieGrid
          movies={movies}
          isLoading={isLoading}
          emptyMessage={`No movies found for "${personName}"`}
        />
      </div>
    </div>
  );
}
