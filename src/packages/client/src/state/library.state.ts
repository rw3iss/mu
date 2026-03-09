import { signal, computed } from '@preact/signals';
import { moviesService } from '@/services/movies.service';

// ============================================
// Types
// ============================================

export interface Movie {
  id: string;
  title: string;
  year: number;
  overview: string;
  posterUrl: string;
  thumbnailUrl?: string;
  backdropUrl: string;
  runtime: number;
  genres: string[];
  rating: number;
  imdbId?: string;
  tmdbId?: number;
  imdbRating?: number;
  rtRating?: number;
  metacriticRating?: number;
  cast: Array<{ name: string; character: string; profileUrl?: string }>;
  director?: string;
  addedAt: string;
  watchProgress?: number;
  watchPosition?: number;
  durationSeconds?: number;
  inWatchlist?: boolean;
  status?: 'idle' | 'processing';
}

export interface LibraryFilters {
  genres: string[];
  yearRange: [number, number] | null;
  ratingRange: [number, number] | null;
  sortBy: 'title' | 'year' | 'rating' | 'addedAt' | 'runtime';
  sortOrder: 'asc' | 'desc';
}

export type ViewMode = 'large' | 'grid' | 'list';

// ============================================
// Signals
// ============================================

export const movies = signal<Movie[]>([]);
export const totalMovies = signal(0);
export const currentPage = signal(1);
export const pageSize = signal(40);
export const isLoading = signal(false);
export const searchQuery = signal('');
export const viewMode = signal<ViewMode>('grid');

export const filters = signal<LibraryFilters>({
  genres: [],
  yearRange: null,
  ratingRange: null,
  sortBy: 'addedAt',
  sortOrder: 'desc',
});

export const totalPages = computed(() =>
  Math.ceil(totalMovies.value / pageSize.value)
);

// ============================================
// Actions
// ============================================

export async function fetchMovies(page = 1): Promise<void> {
  isLoading.value = true;
  currentPage.value = page;

  try {
    const params: Record<string, string> = {
      page: String(page),
      pageSize: String(pageSize.value),
      sortBy: filters.value.sortBy,
      sortOrder: filters.value.sortOrder,
    };

    if (searchQuery.value) {
      params.search = searchQuery.value;
    }

    if (filters.value.genres.length > 0) {
      params.genre = filters.value.genres.join(',');
    }

    if (filters.value.yearRange) {
      params.yearFrom = String(filters.value.yearRange[0]);
      params.yearTo = String(filters.value.yearRange[1]);
    }

    if (filters.value.ratingRange) {
      params.ratingFrom = String(filters.value.ratingRange[0]);
      params.ratingTo = String(filters.value.ratingRange[1]);
    }

    const response = await moviesService.list(params);
    movies.value = response.movies;
    totalMovies.value = response.total;
  } catch (error) {
    console.error('Failed to fetch movies:', error);
  } finally {
    isLoading.value = false;
  }
}

export async function searchMovies(query: string): Promise<void> {
  searchQuery.value = query;
  await fetchMovies(1);
}

export function setFilters(newFilters: Partial<LibraryFilters>): void {
  filters.value = { ...filters.value, ...newFilters };
  if (newFilters.sortBy !== undefined || newFilters.sortOrder !== undefined) {
    localStorage.setItem('mu_sort_by', filters.value.sortBy);
    localStorage.setItem('mu_sort_order', filters.value.sortOrder);
  }
  fetchMovies(1);
}

export function setViewMode(mode: ViewMode): void {
  viewMode.value = mode;
  localStorage.setItem('mu_view_mode', mode);
}

export function initViewMode(): void {
  const saved = localStorage.getItem('mu_view_mode') as ViewMode | null;
  if (saved === 'large' || saved === 'grid' || saved === 'list') {
    viewMode.value = saved;
  }
}

export function initSortPrefs(): void {
  const sortBy = localStorage.getItem('mu_sort_by') as LibraryFilters['sortBy'] | null;
  const sortOrder = localStorage.getItem('mu_sort_order') as 'asc' | 'desc' | null;
  if (sortBy && ['title', 'year', 'rating', 'addedAt', 'runtime'].includes(sortBy)) {
    filters.value = { ...filters.value, sortBy };
  }
  if (sortOrder === 'asc' || sortOrder === 'desc') {
    filters.value = { ...filters.value, sortOrder };
  }
}
