import { useCallback, useEffect, useState } from 'preact/hooks';
import type { BulkAction } from '@/components/movie/BulkActionsBar';
import { BulkActionsBar } from '@/components/movie/BulkActionsBar';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { moviesService } from '@/services/movies.service';
import { type Movie, setViewMode, viewMode } from '@/state/library.state';
import styles from './Search.module.scss';

interface SearchProps {
	path?: string;
	q?: string;
}

export function Search({ q }: SearchProps) {
	const [results, setResults] = useState<Movie[]>([]);
	const [totalResults, setTotalResults] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [editMode, setEditMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkLoading, setBulkLoading] = useState(false);
	const [bulkStatus, setBulkStatus] = useState<{
		type: 'success' | 'error';
		message: string;
	} | null>(null);

	// Extract query from URL search params if not passed as prop
	const query =
		q ||
		(typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).get('q') || ''
			: '');

	useEffect(() => {
		if (!query) {
			setResults([]);
			setTotalResults(0);
			return;
		}

		async function search() {
			setIsLoading(true);
			try {
				const response = await moviesService.search(query);
				setResults(response.movies);
				setTotalResults(response.total);
			} catch (error) {
				console.error('Search failed:', error);
			} finally {
				setIsLoading(false);
			}
		}

		search();
	}, [query]);

	const handleToggleSelect = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const handleExitEditMode = useCallback(() => {
		setEditMode(false);
		setSelectedIds(new Set());
		setBulkStatus(null);
	}, []);

	const handleBulkAction = useCallback(
		async (action: BulkAction, options?: Record<string, unknown>) => {
			if (selectedIds.size === 0) return;
			setBulkLoading(true);
			setBulkStatus(null);
			try {
				const ids = Array.from(selectedIds);
				const result = await moviesService.bulkAction(action, ids, options as any);
				const failed = result.errors.length;
				if (failed === 0) {
					setBulkStatus({
						type: 'success',
						message: `Done: ${result.processed} updated`,
					});
				} else {
					setBulkStatus({
						type: 'error',
						message: `${result.processed} succeeded, ${failed} failed`,
					});
				}
				// Refresh search results
				const response = await moviesService.search(query);
				setResults(response.movies);
				setTotalResults(response.total);
				if (action === 'remove' || action === 'delete_from_disk') {
					setSelectedIds(new Set());
				}
			} catch (err: any) {
				setBulkStatus({ type: 'error', message: err?.message ?? 'Action failed' });
			} finally {
				setBulkLoading(false);
				setTimeout(() => setBulkStatus(null), 4000);
			}
		},
		[selectedIds, query],
	);

	return (
		<div class={styles.search}>
			<div class={styles.header}>
				<div class={styles.headerLeft}>
					<h1 class={styles.title}>{query ? `Results for "${query}"` : 'Search'}</h1>
					{totalResults > 0 && (
						<span class={styles.count}>
							{totalResults} {totalResults === 1 ? 'movie' : 'movies'} found
						</span>
					)}
				</div>
				<div class={styles.controls}>
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
					<button
						class={`${styles.editBtn} ${editMode ? styles.active : ''}`}
						onClick={() => {
							if (editMode) {
								handleExitEditMode();
							} else {
								setEditMode(true);
								setBulkStatus(null);
							}
						}}
						aria-label="Toggle edit mode"
						title="Select movies for bulk actions"
					>
						{'\u270E'}
					</button>
				</div>
			</div>

			{!query ? (
				<div class={styles.empty}>
					<p>Enter a search term to find movies</p>
				</div>
			) : (
				<>
					{editMode && (
						<BulkActionsBar
							selectedIds={selectedIds}
							selectedMovies={results.filter((m) => selectedIds.has(m.id))}
							onAction={handleBulkAction}
							isLoading={bulkLoading}
							status={bulkStatus}
							onClearSelection={() => setSelectedIds(new Set())}
							onExitEditMode={handleExitEditMode}
						/>
					)}
					<MovieGrid
						movies={results}
						isLoading={isLoading}
						viewMode={viewMode.value}
						selectionMode={editMode}
						selectedIds={selectedIds}
						onToggleSelect={handleToggleSelect}
						onMovieRemoved={(id) =>
							setResults((prev) => prev.filter((m) => m.id !== id))
						}
						emptyMessage={`No results for "${query}"`}
					/>
				</>
			)}
		</div>
	);
}
