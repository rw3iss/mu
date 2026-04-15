import { Spinner } from '@/components/common/Spinner';
import type { Movie, ViewMode } from '@/state/library.state';
import { updateMovieInList } from '@/state/library.state';
import { MovieCard } from './MovieCard';
import styles from './MovieGrid.module.scss';
import { MovieLargeCard } from './MovieLargeCard';
import { MovieListItem } from './MovieListItem';

interface MovieGridProps {
	movies: Movie[];
	isLoading?: boolean;
	emptyMessage?: string;
	viewMode?: ViewMode;
	selectionMode?: boolean;
	selectedIds?: Set<string>;
	onToggleSelect?: (id: string) => void;
}

export function MovieGrid({
	movies,
	isLoading = false,
	emptyMessage = 'No movies found',
	viewMode = 'grid',
	selectionMode = false,
	selectedIds,
	onToggleSelect,
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

	const containerClass = selectionMode ? styles.selectionMode : '';

	if (viewMode === 'list') {
		return (
			<div class={`${styles.list} ${containerClass}`}>
				{movies.map((movie) => (
					<MovieListItem
						key={movie.id}
						movie={movie}
						onMovieUpdate={updateMovieInList}
						selectionMode={selectionMode}
						selected={selectedIds?.has(movie.id) ?? false}
						onToggleSelect={onToggleSelect}
					/>
				))}
			</div>
		);
	}

	if (viewMode === 'large') {
		return (
			<div class={`${styles.largeGrid} ${containerClass}`}>
				{movies.map((movie) => (
					<MovieLargeCard
						key={movie.id}
						movie={movie}
						onMovieUpdate={updateMovieInList}
						selectionMode={selectionMode}
						selected={selectedIds?.has(movie.id) ?? false}
						onToggleSelect={onToggleSelect}
					/>
				))}
			</div>
		);
	}

	return (
		<div class={`${styles.grid} ${containerClass}`}>
			{movies.map((movie) => (
				<MovieCard
					key={movie.id}
					movie={movie}
					onMovieUpdate={updateMovieInList}
					selectionMode={selectionMode}
					selected={selectedIds?.has(movie.id) ?? false}
					onToggleSelect={onToggleSelect}
				/>
			))}
		</div>
	);
}
