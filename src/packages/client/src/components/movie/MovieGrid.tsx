import { Spinner } from '@/components/common/Spinner';
import type { MovieGroup } from '@/services/groups.service';
import type { LibraryFilters, Movie, ViewMode } from '@/state/library.state';
import { removeMovieFromList, updateMovieInList } from '@/state/library.state';
import { GroupListItem } from './GroupListItem';
import { GroupTile } from './GroupTile';
import { MovieCard } from './MovieCard';
import styles from './MovieGrid.module.scss';
import { MovieLargeCard } from './MovieLargeCard';
import { MovieListItem } from './MovieListItem';

type GridItem = { kind: 'movie'; movie: Movie } | { kind: 'group'; group: MovieGroup };

interface MovieGridProps {
	movies: Movie[];
	/**
	 * Optional list of parent groups to render as cards interleaved with
	 * movies. Sort key matches the library's current sortBy. Used by
	 * the library mixed-view (groupViewEnabled=true, groupedOnly=false).
	 */
	groups?: MovieGroup[];
	sortBy?: LibraryFilters['sortBy'];
	sortOrder?: LibraryFilters['sortOrder'];
	isLoading?: boolean;
	emptyMessage?: string;
	viewMode?: ViewMode;
	selectionMode?: boolean;
	selectedIds?: Set<string>;
	onToggleSelect?: (id: string) => void;
	/**
	 * Called when a card's options menu removes the movie (Remove from
	 * Library / Delete from Disk). Defaults to removing the movie from
	 * the global library state, which Library/Home pages subscribe to.
	 * Search supplies its own callback so it updates its local results.
	 */
	onMovieRemoved?: (movieId: string) => void;
}

/** Pull the sort key off either kind of item, normalising to a comparable. */
function itemSortKey(item: GridItem, sortBy: LibraryFilters['sortBy']): number | string | null {
	if (item.kind === 'movie') {
		switch (sortBy) {
			case 'title':
				return item.movie.title?.toLowerCase() ?? '';
			case 'year':
				return item.movie.year ?? 0;
			case 'addedAt':
				return item.movie.addedAt ?? '';
			case 'rating':
				return item.movie.rating ?? 0;
			case 'runtime':
				return item.movie.runtime ?? 0;
			case 'fileSize':
				return item.movie.fileInfo?.fileSize ?? 0;
			default:
				return item.movie.addedAt ?? '';
		}
	}
	// Group sort keys — best-effort, derived from the parent or its members.
	switch (sortBy) {
		case 'title':
			return item.group.name?.toLowerCase() ?? '';
		case 'year':
			return item.group.earliestYear ?? 0;
		case 'addedAt':
			return item.group.latestMemberAddedAt ?? item.group.updatedAt ?? '';
		// Rating, runtime, fileSize: groups have no sensible equivalent —
		// fall through to the latest-member-added-at proxy so they still
		// sort stably alongside movies.
		default:
			return item.group.latestMemberAddedAt ?? item.group.updatedAt ?? '';
	}
}

function interleave(
	movies: Movie[],
	groups: MovieGroup[] | undefined,
	sortBy: LibraryFilters['sortBy'],
	sortOrder: LibraryFilters['sortOrder'],
): GridItem[] {
	const items: GridItem[] = movies.map((m) => ({ kind: 'movie' as const, movie: m }));
	if (groups && groups.length > 0) {
		for (const g of groups) items.push({ kind: 'group' as const, group: g });
		const dir = sortOrder === 'asc' ? 1 : -1;
		items.sort((a, b) => {
			const ka = itemSortKey(a, sortBy);
			const kb = itemSortKey(b, sortBy);
			if (ka == null && kb == null) return 0;
			if (ka == null) return 1;
			if (kb == null) return -1;
			if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir;
			return String(ka).localeCompare(String(kb)) * dir;
		});
	}
	return items;
}

export function MovieGrid({
	movies,
	groups,
	sortBy = 'addedAt',
	sortOrder = 'desc',
	isLoading = false,
	emptyMessage = 'No movies found',
	viewMode = 'grid',
	selectionMode = false,
	selectedIds,
	onToggleSelect,
	onMovieRemoved = removeMovieFromList,
}: MovieGridProps) {
	if (isLoading) {
		return (
			<div class={styles.loading}>
				<Spinner size="lg" />
			</div>
		);
	}

	const items = interleave(movies, groups, sortBy, sortOrder);

	if (items.length === 0) {
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
				{items.map((item) =>
					item.kind === 'group' ? (
						<GroupListItem key={`g:${item.group.id}`} group={item.group} />
					) : (
						<MovieListItem
							key={item.movie.id}
							movie={item.movie}
							onMovieUpdate={updateMovieInList}
							onMovieRemoved={onMovieRemoved}
							selectionMode={selectionMode}
							selected={selectedIds?.has(item.movie.id) ?? false}
							onToggleSelect={onToggleSelect}
						/>
					),
				)}
			</div>
		);
	}

	if (viewMode === 'large') {
		return (
			<div class={`${styles.largeGrid} ${containerClass}`}>
				{items.map((item) =>
					item.kind === 'group' ? (
						<GroupTile key={`g:${item.group.id}`} group={item.group} />
					) : (
						<MovieLargeCard
							key={item.movie.id}
							movie={item.movie}
							onMovieUpdate={updateMovieInList}
							onMovieRemoved={onMovieRemoved}
							selectionMode={selectionMode}
							selected={selectedIds?.has(item.movie.id) ?? false}
							onToggleSelect={onToggleSelect}
						/>
					),
				)}
			</div>
		);
	}

	return (
		<div class={`${styles.grid} ${containerClass}`}>
			{items.map((item) =>
				item.kind === 'group' ? (
					<GroupTile key={`g:${item.group.id}`} group={item.group} />
				) : (
					<MovieCard
						key={item.movie.id}
						movie={item.movie}
						onMovieUpdate={updateMovieInList}
						onMovieRemoved={onMovieRemoved}
						selectionMode={selectionMode}
						selected={selectedIds?.has(item.movie.id) ?? false}
						onToggleSelect={onToggleSelect}
					/>
				),
			)}
		</div>
	);
}
