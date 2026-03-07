import { h } from 'preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { Button } from '@/components/common/Button';
import {
  movies,
  totalMovies,
  currentPage,
  totalPages,
  isLoading,
  searchQuery,
  viewMode,
  filters,
  fetchMovies,
  searchMovies,
  setFilters,
  setViewMode,
  initViewMode,
} from '@/state/library.state';
import { useDebounce } from '@/hooks/useDebounce';
import { moviesService } from '@/services/movies.service';
import styles from './Library.module.scss';

interface LibraryProps {
  path?: string;
}

export function Library(_props: LibraryProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery.value);
  const [genres, setGenres] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    initViewMode();
    fetchMovies(1);
    loadGenres();
  }, []);

  useEffect(() => {
    searchMovies(debouncedSearch);
  }, [debouncedSearch]);

  async function loadGenres() {
    try {
      const g = await moviesService.getGenres();
      setGenres(g);
    } catch {
      // Genres optional
    }
  }

  const handleSearchInput = useCallback((e: Event) => {
    setLocalSearch((e.target as HTMLInputElement).value);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    fetchMovies(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleGenreToggle = useCallback(
    (genre: string) => {
      const current = filters.value.genres;
      const newGenres = current.includes(genre)
        ? current.filter((g) => g !== genre)
        : [...current, genre];
      setFilters({ genres: newGenres });
    },
    []
  );

  const handleSortChange = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    const [sortBy, sortOrder] = value.split(':') as [string, 'asc' | 'desc'];
    setFilters({ sortBy: sortBy as any, sortOrder });
  }, []);

  return (
    <div class={styles.library}>
      {/* Header */}
      <div class={styles.header}>
        <h1 class={styles.title}>Library</h1>
        <span class={styles.count}>{totalMovies.value} movies</span>
      </div>

      {/* Toolbar */}
      <div class={styles.toolbar}>
        <div class={styles.searchBar}>
          <input
            type="search"
            class={styles.searchInput}
            placeholder="Search your library..."
            value={localSearch}
            onInput={handleSearchInput}
          />
        </div>

        <div class={styles.toolbarActions}>
          <select class={styles.sortSelect} onChange={handleSortChange}>
            <option value="addedAt:desc">Recently Added</option>
            <option value="title:asc">Title A-Z</option>
            <option value="title:desc">Title Z-A</option>
            <option value="year:desc">Year (Newest)</option>
            <option value="year:asc">Year (Oldest)</option>
            <option value="rating:desc">Highest Rated</option>
            <option value="runtime:asc">Shortest</option>
            <option value="runtime:desc">Longest</option>
          </select>

          <div class={styles.viewToggle}>
            <button
              class={`${styles.viewButton} ${viewMode.value === 'grid' ? styles.active : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
            >
              {'\u25A6'}
            </button>
            <button
              class={`${styles.viewButton} ${viewMode.value === 'list' ? styles.active : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              {'\u2630'}
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters {filters.value.genres.length > 0 ? `(${filters.value.genres.length})` : ''}
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div class={styles.filtersPanel}>
          <div class={styles.filterGroup}>
            <h3 class={styles.filterLabel}>Genres</h3>
            <div class={styles.genreList}>
              {genres.map((genre) => (
                <button
                  key={genre}
                  class={`${styles.genreChip} ${
                    filters.value.genres.includes(genre) ? styles.active : ''
                  }`}
                  onClick={() => handleGenreToggle(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Movie Grid */}
      <MovieGrid
        movies={movies.value}
        isLoading={isLoading.value}
        emptyMessage={
          searchQuery.value
            ? `No results for "${searchQuery.value}"`
            : 'Your library is empty'
        }
      />

      {/* Pagination */}
      {totalPages.value > 1 && (
        <div class={styles.pagination}>
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage.value <= 1}
            onClick={() => handlePageChange(currentPage.value - 1)}
          >
            Previous
          </Button>
          <span class={styles.pageInfo}>
            Page {currentPage.value} of {totalPages.value}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage.value >= totalPages.value}
            onClick={() => handlePageChange(currentPage.value + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
