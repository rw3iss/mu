import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { currentPath, currentUrl } from '@/app';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import type { BulkAction } from '@/components/movie/BulkActionsBar';
import { BulkActionsBar } from '@/components/movie/BulkActionsBar';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { useDebounce } from '@/hooks/useDebounce';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { libraryEvents } from '@/services/library-events.service';
import { moviesService } from '@/services/movies.service';
import { sourcesService } from '@/services/sources.service';
import {
	fetchParentGroups,
	groupedOnly,
	groupsLoaded,
	groupViewEnabled,
	invalidateGroups,
	parentGroups,
	toggleGroupedOnly,
	toggleGroupView,
} from '@/state/groups.state';
import type { LibraryFilters } from '@/state/library.state';
import {
	currentPage,
	fetchMovies,
	filters,
	hasRemoteServers,
	hiddenCount,
	hideWatched,
	initRemoteServers,
	initSortPrefs,
	initViewMode,
	isLoading,
	movies,
	pageSize,
	remoteServerList,
	restoreLibraryScroll,
	saveLibraryScroll,
	searchMovies,
	searchQuery,
	serverFilter,
	setFilters,
	setPageSize,
	setServerFilter,
	setViewMode,
	showHidden,
	toggleHideWatched,
	toggleShowHidden,
	totalMovies,
	totalPages,
	viewMode,
	watchedCount,
} from '@/state/library.state';
import styles from './Library.module.scss';

const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];

/** Update URL query params without triggering a full navigation. */
function syncUrlParams(page: number, size: number, q?: string) {
	const url = new URL(window.location.href);
	if (page > 1) url.searchParams.set('page', String(page));
	else url.searchParams.delete('page');
	if (size !== 40) url.searchParams.set('pageSize', String(size));
	else url.searchParams.delete('pageSize');
	const trimmed = (q ?? '').trim();
	if (trimmed) url.searchParams.set('q', trimmed);
	else url.searchParams.delete('q');
	window.history.replaceState(null, '', url.toString());
}

/** Read page/pageSize/q from URL query params. */
function readUrlParams(): { page: number; size: number; q: string } | null {
	const url = new URL(window.location.href);
	const p = parseInt(url.searchParams.get('page') || '', 10);
	const s = parseInt(url.searchParams.get('pageSize') || '', 10);
	const q = url.searchParams.get('q') || '';
	if (p > 0 || s > 0 || q) {
		return { page: p > 0 ? p : 1, size: s > 0 ? s : pageSize.value, q };
	}
	return null;
}

/**
 * Build a window of page numbers around the current page, with ellipsis gaps.
 * Shows at most `maxButtons` page numbers plus up to 2 ellipsis indicators.
 */
function getPageNumbers(current: number, total: number, maxButtons = 10): (number | '...')[] {
	if (total <= maxButtons) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}

	const pages: (number | '...')[] = [];
	// Always show first page
	pages.push(1);

	// Calculate the window around current page
	const sideCount = Math.floor((maxButtons - 2) / 2); // pages on each side of current
	let start = Math.max(2, current - sideCount);
	let end = Math.min(total - 1, current + sideCount);

	// Adjust if window is too small on one side
	const windowSize = end - start + 1;
	const targetSize = maxButtons - 2; // minus first and last
	if (windowSize < targetSize) {
		if (start === 2) {
			end = Math.min(total - 1, start + targetSize - 1);
		} else {
			start = Math.max(2, end - targetSize + 1);
		}
	}

	if (start > 2) pages.push('...');
	for (let i = start; i <= end; i++) pages.push(i);
	if (end < total - 1) pages.push('...');

	// Always show last page
	pages.push(total);
	return pages;
}

interface LibraryProps {
	path?: string;
}

export function Library(_props: LibraryProps) {
	// Seed from URL ?q= so deep links and header submits stay in sync.
	const initialQ =
		typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).get('q') || ''
			: '';
	const [localSearch, setLocalSearch] = useState(initialQ || searchQuery.value);
	const [genres, setGenres] = useState<string[]>([]);
	const [showFilters, setShowFilters] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [editMode, setEditMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkLoading, setBulkLoading] = useState(false);
	const [bulkStatus, setBulkStatus] = useState<{
		type: 'success' | 'error';
		message: string;
	} | null>(null);
	const debouncedSearch = useDebounce(localSearch, 300);
	const pendingScrollRef = useRef<number | null>(null);
	const initialLoadRef = useRef(true);
	// Track whether mount already synced search → state, so the URL-watcher
	// below knows when to apply external ?q= changes (e.g. header submit).
	const currentQRef = useRef(initialQ);

	useEffect(() => {
		initViewMode();
		initSortPrefs();
		initRemoteServers();

		// Determine which page to load: URL params > scroll restore > page 1
		const urlParams = readUrlParams();
		const scrollRestore = restoreLibraryScroll();

		let startPage = 1;
		let startQ = '';
		if (urlParams) {
			startPage = urlParams.page;
			startQ = urlParams.q;
			if (urlParams.size !== pageSize.value) {
				pageSize.value = urlParams.size;
			}
		} else if (scrollRestore) {
			startPage = scrollRestore.page;
			pendingScrollRef.current = scrollRestore.scrollY;
		}

		// Ensure server fetch picks up the URL q on first load.
		if (startQ !== searchQuery.value) {
			searchQuery.value = startQ;
		}

		fetchMovies(startPage).then(() => {
			syncUrlParams(startPage, pageSize.value, startQ);
			// Restore scroll after movies render
			if (pendingScrollRef.current != null) {
				requestAnimationFrame(() => {
					window.scrollTo(0, pendingScrollRef.current!);
					pendingScrollRef.current = null;
				});
			}
		});
		loadGenres();

		// Any view that renders group tiles needs the parent list — that's
		// both the collections-only mode and the mixed mode (tiles above
		// ungrouped movies). Skip the fetch only when groups are hidden
		// entirely (groupViewEnabled=false).
		if (groupViewEnabled.value) {
			void fetchParentGroups();
		}

		// Subscribe to live library events so new movies appear automatically
		libraryEvents.start();
		return () => {
			libraryEvents.stop();
			// Save scroll position on unmount (e.g., navigating to a movie detail page)
			saveLibraryScroll();
		};
	}, []);

	// External URL changes (header search submit, header clear, /search →
	// /library redirect, browser back/forward) update localSearch so the
	// existing debounced search effect picks them up. Keyed on
	// `currentUrl` (full URL including ?q=) so query-only changes — like
	// clearing the header search while already on /library — still fire
	// this effect; `currentPath` alone wouldn't tick.
	useEffect(() => {
		if (currentPath.value !== '/library') return;
		const q = new URLSearchParams(window.location.search).get('q') || '';
		if (q !== currentQRef.current) {
			currentQRef.current = q;
			setLocalSearch(q);
		}
	}, [currentUrl.value]);

	useEffect(() => {
		// Skip the initial mount — the first useEffect already loads the correct page
		if (initialLoadRef.current) {
			initialLoadRef.current = false;
			currentQRef.current = debouncedSearch;
			return;
		}
		currentQRef.current = debouncedSearch;
		searchMovies(debouncedSearch);
		syncUrlParams(1, pageSize.value, debouncedSearch);
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

	const handlePageChange = useCallback((page: number) => {
		fetchMovies(page).then(() => syncUrlParams(page, pageSize.value, searchQuery.value));
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}, []);

	const handlePageSizeChange = useCallback((size: number) => {
		setPageSize(size);
		syncUrlParams(1, size, searchQuery.value);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}, []);

	const handleGenreToggle = useCallback((genre: string) => {
		const current = filters.value.genres;
		const newGenres = current.includes(genre)
			? current.filter((g) => g !== genre)
			: [...current, genre];
		setFilters({ genres: newGenres });
	}, []);

	const handleSortChange = useCallback((value: LibraryFilters['sortBy']) => {
		setFilters({ sortBy: value });
	}, []);

	const handleToggleDirection = useCallback(() => {
		setFilters({ sortOrder: filters.value.sortOrder === 'asc' ? 'desc' : 'asc' });
	}, []);

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
				// Refresh the movie list after destructive/mutating operations
				await fetchMovies(currentPage.value);
				// Clear selection after remove/delete
				if (action === 'remove' || action === 'delete_from_disk') {
					setSelectedIds(new Set());
				}
			} catch (err: any) {
				setBulkStatus({ type: 'error', message: err?.message ?? 'Action failed' });
			} finally {
				setBulkLoading(false);
				// Auto-clear success status after 4 seconds
				setTimeout(() => setBulkStatus(null), 4000);
			}
		},
		[selectedIds],
	);

	return (
		<div class={styles.library}>
			{/* Header — title on the left, all toolbar controls on the right */}
			<div class={styles.header}>
				<div class={styles.headerLeft}>
					<h1 class={styles.title}>Library</h1>
					<span class={styles.count}>
						{totalMovies.value} movies
						{hiddenCount.value > 0 && !showHidden.value && (
							<span class={styles.hiddenCount}> ({hiddenCount.value} hidden)</span>
						)}
						{watchedCount.value > 0 && !hideWatched.value && (
							<span class={styles.hiddenCount}> ({watchedCount.value} watched)</span>
						)}
					</span>
				</div>

				<div class={styles.headerActions}>
					{(hasRemoteServers.value || remoteServerList.value.length > 0) && (
						<Select
							value={serverFilter.value}
							onChange={setServerFilter}
							options={[
								{ value: 'all', label: 'All Libraries' },
								{ value: 'local', label: 'My Library' },
								...remoteServerList.value.map((s) => ({
									value: s.id,
									label: s.name,
								})),
							]}
						/>
					)}

					<button
						class={`${styles.showHiddenBtn} ${showHidden.value ? styles.active : ''}`}
						onClick={toggleShowHidden}
						title={showHidden.value ? 'Showing all movies' : 'Show hidden movies'}
					>
						<Icon name={showHidden.value ? 'eye' : 'eye-off'} />
						<span>Hidden</span>
					</button>

					<button
						class={`${styles.showHiddenBtn} ${hideWatched.value ? styles.active : ''}`}
						onClick={toggleHideWatched}
						title={hideWatched.value ? 'Showing unwatched only' : 'Hide watched movies'}
					>
						<Icon name={hideWatched.value ? 'eye-off' : 'eye'} />
						<span>Unwatched</span>
					</button>

					<Select<LibraryFilters['sortBy']>
						value={filters.value.sortBy}
						onChange={handleSortChange}
						options={[
							{ value: 'addedAt', label: 'Recently Added' },
							{ value: 'title', label: 'Title' },
							{ value: 'year', label: 'Year' },
							{ value: 'rating', label: 'Rating' },
							{ value: 'runtime', label: 'Runtime' },
							{ value: 'fileSize', label: 'File Size' },
						]}
					/>

					<button
						class={styles.sortDirection}
						onClick={handleToggleDirection}
						aria-label={`Sort ${filters.value.sortOrder === 'asc' ? 'ascending' : 'descending'}`}
						title={filters.value.sortOrder === 'asc' ? 'Ascending' : 'Descending'}
					>
						<Icon
							name={filters.value.sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'}
						/>
					</button>

					<div class={styles.viewToggle}>
						<button
							class={`${styles.viewButton} ${viewMode.value === 'large' ? styles.active : ''}`}
							onClick={() => setViewMode('large')}
							aria-label="Large card view"
							title="Large cards"
						>
							<Icon name="view-large" />
						</button>
						<button
							class={`${styles.viewButton} ${viewMode.value === 'grid' ? styles.active : ''}`}
							onClick={() => setViewMode('grid')}
							aria-label="Grid view"
							title="Grid"
						>
							<Icon name="view-grid" />
						</button>
						<button
							class={`${styles.viewButton} ${viewMode.value === 'list' ? styles.active : ''}`}
							onClick={() => setViewMode('list')}
							aria-label="List view"
							title="List"
						>
							<Icon name="view-list" />
						</button>
					</div>

					<button
						class={`${styles.editBtn} ${groupViewEnabled.value ? styles.active : ''}`}
						onClick={() => {
							toggleGroupView();
							// The "collapse groups" toggle changes what gets
							// rendered in BOTH groupedOnly modes:
							//   - groupedOnly=true:  flips tile grid ⇄ flat movies
							//   - groupedOnly=false: flips mixed (tiles + ungrouped)
							//                        ⇄ all-individual
							// Each shape needs its own fetch.
							if (groupViewEnabled.value) {
								invalidateGroups();
								void fetchParentGroups();
							}
							// Movies always refetch — the server filter
							// (groupedOnly vs excludeGrouped vs nothing) changes
							// with this toggle.
							fetchMovies(1);
						}}
						aria-label="Toggle group view"
						title={
							groupViewEnabled.value
								? 'Collapsing groups — click to show every item individually'
								: 'Showing items individually — click to collapse groups'
						}
					>
						<Icon name="layers" />
					</button>

					<button
						class={`${styles.editBtn} ${groupedOnly.value ? styles.active : ''}`}
						onClick={() => {
							toggleGroupedOnly();
							if (groupedOnly.value) {
								// Switching into collections-only mode. If grouped
								// view is on we want the tile grid; otherwise we
								// want a flat MovieGrid of every group member.
								if (groupViewEnabled.value) {
									invalidateGroups();
									void fetchParentGroups();
								} else {
									fetchMovies(1);
								}
							} else {
								// Back to normal library: refetch movies.
								fetchMovies(1);
							}
						}}
						aria-label="Show only grouped items"
						title={
							groupedOnly.value
								? 'Showing series / collections — click to show every item individually'
								: 'Click to show series / collections as tiles'
						}
					>
						<Icon name="film" />
					</button>

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
						<Icon name="edit" />
					</button>

					<Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
						Filters{' '}
						{filters.value.genres.length > 0 ? `(${filters.value.genres.length})` : ''}
					</Button>

					<button
						class={`${styles.refreshBtn} ${isUpdating ? styles.spinning : ''}`}
						onClick={handleUpdate}
						disabled={isUpdating}
						aria-label="Refresh library"
						title="Refresh library"
					>
						<Icon name="refresh" />
					</button>
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

			{/* Bulk Actions Bar */}
			{editMode && (
				<BulkActionsBar
					selectedIds={selectedIds}
					selectedMovies={movies.value.filter((m) => selectedIds.has(m.id))}
					onAction={handleBulkAction}
					isLoading={bulkLoading}
					status={bulkStatus}
					onClearSelection={() => setSelectedIds(new Set())}
					onExitEditMode={handleExitEditMode}
				/>
			)}

			{/* Four rendering modes — driven by the two independent toggles:
			    1. groupedOnly=true  + groupViewEnabled=true  → tile-only grid of parent
			       groups (collections-only view, collapsed)
			    2. groupedOnly=true  + groupViewEnabled=false → flat MovieGrid of every
			       group member; server filters via ?groupedOnly=true
			    3. groupedOnly=false + groupViewEnabled=true  → MIXED: parent groups
			       interleaved with ungrouped movies in one sorted grid. Groups render
			       as cards that match MovieCard dimensions, sorted by their latest
			       member's addedAt (or whichever sort key is active). Server hides
			       grouped movies via ?excludeGrouped=true so we don't double-render
			       members already represented by their group card.
			    4. groupedOnly=false + groupViewEnabled=false → full library, every movie
			       individually (grouped + ungrouped). No group cards. */}
			{(() => {
				const q = searchQuery.value.trim().toLowerCase();
				const visibleParents = q
					? parentGroups.value.filter((g) => g.name.toLowerCase().includes(q))
					: parentGroups.value;
				const tilesOnly = groupedOnly.value && groupViewEnabled.value;
				const mixed = !groupedOnly.value && groupViewEnabled.value;

				if (tilesOnly) {
					if (!groupsLoaded.value && parentGroups.value.length === 0) {
						return <div class={styles.groupsLoading}>Loading collections…</div>;
					}
					if (parentGroups.value.length === 0) {
						return (
							<div class={styles.groupsEmpty}>
								No collections yet. Run{' '}
								<strong>Settings → Admin → Group Similar Items</strong> to detect
								series + collections from your library.
							</div>
						);
					}
					if (visibleParents.length === 0) {
						return (
							<div class={styles.groupsEmpty}>
								No collections match &ldquo;{searchQuery.value}&rdquo;.
							</div>
						);
					}
					// Reuse MovieGrid layout for the tile-only view so the grid
					// dimensions match. Movies array stays empty.
					return (
						<MovieGrid
							movies={[]}
							groups={visibleParents}
							sortBy={filters.value.sortBy}
							sortOrder={filters.value.sortOrder}
							isLoading={false}
							viewMode={viewMode.value}
							selectionMode={editMode}
							selectedIds={selectedIds}
							onToggleSelect={handleToggleSelect}
							emptyMessage=""
						/>
					);
				}

				return (
					<MovieGrid
						movies={movies.value}
						groups={mixed ? visibleParents : undefined}
						sortBy={filters.value.sortBy}
						sortOrder={filters.value.sortOrder}
						isLoading={isLoading.value}
						viewMode={viewMode.value}
						selectionMode={editMode}
						selectedIds={selectedIds}
						onToggleSelect={handleToggleSelect}
						emptyMessage={
							searchQuery.value
								? `No results for "${searchQuery.value}"`
								: groupedOnly.value
									? 'No movies belong to a collection yet.'
									: 'Your library is empty'
						}
					/>
				);
			})()}

			{/* Pagination */}
			{totalPages.value > 1 && (
				<div class={styles.pagination}>
					{/* First / Prev */}
					<button
						class={styles.pageBtn}
						disabled={currentPage.value <= 1}
						onClick={() => handlePageChange(1)}
						title="First page"
					>
						&#x00AB;
					</button>
					<button
						class={styles.pageBtn}
						disabled={currentPage.value <= 1}
						onClick={() => handlePageChange(currentPage.value - 1)}
						title="Previous page"
					>
						&#x2039;
					</button>

					{/* Page number buttons */}
					{getPageNumbers(currentPage.value, totalPages.value).map((p) =>
						p === '...' ? (
							<span class={styles.pageEllipsis} key={`e${Math.random()}`}>
								...
							</span>
						) : (
							<button
								key={p}
								class={`${styles.pageBtn} ${p === currentPage.value ? styles.active : ''}`}
								onClick={() => handlePageChange(p as number)}
							>
								{p}
							</button>
						),
					)}

					{/* Next / Last */}
					<button
						class={styles.pageBtn}
						disabled={currentPage.value >= totalPages.value}
						onClick={() => handlePageChange(currentPage.value + 1)}
						title="Next page"
					>
						&#x203A;
					</button>
					<button
						class={styles.pageBtn}
						disabled={currentPage.value >= totalPages.value}
						onClick={() => handlePageChange(totalPages.value)}
						title="Last page"
					>
						&#x00BB;
					</button>

					<span class={styles.pageInfo}>
						Page {currentPage.value} of {totalPages.value}
					</span>
					<Select<number>
						value={pageSize.value}
						onChange={handlePageSizeChange}
						size="sm"
						menuAlign="end"
						options={PAGE_SIZE_OPTIONS.map((n) => ({
							value: n,
							label: `${n} per page`,
						}))}
					/>
				</div>
			)}
			<PluginSlot name={UI.LIBRARY_BOTTOM} context={{}} />
		</div>
	);
}
