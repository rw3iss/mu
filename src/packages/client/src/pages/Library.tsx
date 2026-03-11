import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { useDebounce } from '@/hooks/useDebounce';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { libraryEvents } from '@/services/library-events.service';
import { moviesService } from '@/services/movies.service';
import { sourcesService } from '@/services/sources.service';
import type { LibraryFilters } from '@/state/library.state';
import {
	currentPage,
	fetchMovies,
	filters,
	initSortPrefs,
	initViewMode,
	isLoading,
	movies,
	searchMovies,
	searchQuery,
	setFilters,
	setViewMode,
	totalMovies,
	totalPages,
	viewMode,
} from '@/state/library.state';
import styles from './Library.module.scss';

interface LibraryProps {
	path?: string;
}

export function Library(_props: LibraryProps) {
	const [localSearch, setLocalSearch] = useState(searchQuery.value);
	const [genres, setGenres] = useState<string[]>([]);
	const [showFilters, setShowFilters] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const debouncedSearch = useDebounce(localSearch, 300);

	useEffect(() => {
		initViewMode();
		initSortPrefs();
		fetchMovies(1);
		loadGenres();

		// Subscribe to live library events so new movies appear automatically
		libraryEvents.start();
		return () => libraryEvents.stop();
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

	const handleUpdate = useCallback(async () => {
		setIsUpdating(true);
		try {
			// Refresh the current list immediately
			await fetchMovies(currentPage.value);
			// Kick off a background scan — new movies will arrive via WebSocket
			sourcesService.scanAll().catch(() => {});
		} finally {
			setIsUpdating(false);
		}
	}, []);

	const handleSearchInput = useCallback((e: Event) => {
		setLocalSearch((e.target as HTMLInputElement).value);
	}, []);

	const handlePageChange = useCallback((page: number) => {
		fetchMovies(page);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}, []);

	const handleGenreToggle = useCallback((genre: string) => {
		const current = filters.value.genres;
		const newGenres = current.includes(genre)
			? current.filter((g) => g !== genre)
			: [...current, genre];
		setFilters({ genres: newGenres });
	}, []);

	const handleSortChange = useCallback((e: Event) => {
		const value = (e.target as HTMLSelectElement).value as LibraryFilters['sortBy'];
		setFilters({ sortBy: value });
	}, []);

	const handleToggleDirection = useCallback(() => {
		setFilters({ sortOrder: filters.value.sortOrder === 'asc' ? 'desc' : 'asc' });
	}, []);

	return (
		<div class={styles.library}>
			{/* Header */}
			<div class={styles.header}>
				<div class={styles.headerLeft}>
					<h1 class={styles.title}>Library</h1>
					<span class={styles.count}>{totalMovies.value} movies</span>
				</div>
				<Button variant="secondary" size="sm" loading={isUpdating} onClick={handleUpdate}>
					{isUpdating ? 'Updating...' : 'Update'}
				</Button>
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
					<select
						class={styles.sortSelect}
						value={filters.value.sortBy}
						onChange={handleSortChange}
					>
						<option value="addedAt">Recently Added</option>
						<option value="title">Title</option>
						<option value="year">Year</option>
						<option value="rating">Rating</option>
						<option value="runtime">Runtime</option>
					</select>

					<button
						class={styles.sortDirection}
						onClick={handleToggleDirection}
						aria-label={`Sort ${filters.value.sortOrder === 'asc' ? 'ascending' : 'descending'}`}
						title={filters.value.sortOrder === 'asc' ? 'Ascending' : 'Descending'}
					>
						{filters.value.sortOrder === 'asc' ? '\u2191' : '\u2193'}
					</button>

					<div class={styles.viewToggle}>
						<button
							class={`${styles.viewButton} ${viewMode.value === 'large' ? styles.active : ''}`}
							onClick={() => setViewMode('large')}
							aria-label="Large card view"
							title="Large cards"
						>
							{'\u2B1C'}
						</button>
						<button
							class={`${styles.viewButton} ${viewMode.value === 'grid' ? styles.active : ''}`}
							onClick={() => setViewMode('grid')}
							aria-label="Grid view"
							title="Grid"
						>
							{'\u25A6'}
						</button>
						<button
							class={`${styles.viewButton} ${viewMode.value === 'list' ? styles.active : ''}`}
							onClick={() => setViewMode('list')}
							aria-label="List view"
							title="List"
						>
							{'\u2630'}
						</button>
					</div>

					<Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
						Filters{' '}
						{filters.value.genres.length > 0 ? `(${filters.value.genres.length})` : ''}
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

			<PluginSlot name={UI.LIBRARY_TOOLBAR} context={{}} />

			{/* Movie Grid */}
			<MovieGrid
				movies={movies.value}
				isLoading={isLoading.value}
				viewMode={viewMode.value}
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
			<PluginSlot name={UI.LIBRARY_BOTTOM} context={{}} />
		</div>
	);
}
