import type { LibraryContentType } from '@mu/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { currentPath, currentUrl } from '@/app';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { MultiSelect, type MultiSelectOption } from '@/components/common/MultiSelect';
import { NumberFilterInput } from '@/components/common/NumberFilterInput';
import { Select } from '@/components/common/Select';
import { Tooltip } from '@/components/common/Tooltip';
import { UploadMovieModal } from '@/components/library/UploadMovieModal';
import type { BulkAction } from '@/components/movie/BulkActionsBar';
import { BulkActionsBar } from '@/components/movie/BulkActionsBar';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { useDebounce } from '@/hooks/useDebounce';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { libraryEvents } from '@/services/library-events.service';
import { moviesService } from '@/services/movies.service';
import { sourcesService } from '@/services/sources.service';
import { currentUser } from '@/state/auth.state';
import { pageGroups } from '@/state/groups.state';
import type { LibraryFilters } from '@/state/library.state';
import {
	ALL_LIBRARY_TYPES,
	currentPage,
	fetchMovies,
	filters,
	hasRemoteServers,
	hideWatched,
	initRemoteServers,
	initSortPrefs,
	initViewMode,
	isLoading,
	libraryBack,
	movies,
	pageSize,
	remoteServerList,
	restoreLibraryScroll,
	saveLibraryScroll,
	searchBackStack,
	searchMovies,
	searchQuery,
	selectedTypes,
	serverFilter,
	setFilters,
	setPageSize,
	setSelectedTypes,
	setServerFilter,
	setViewMode,
	toggleHideWatched,
	totalMovies,
	totalPages,
	viewMode,
	watchedCount,
} from '@/state/library.state';
import styles from './Library.module.scss';

const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];

/** Content-type checklist options for the Library toolbar dropdown. */
const TYPE_OPTIONS: MultiSelectOption<LibraryContentType>[] = [
	{ value: 'movie', label: 'Movies', description: 'Standalone films', icon: 'film' },
	{ value: 'series', label: 'TV Series', description: 'Shows & seasons', icon: 'monitor' },
	{
		value: 'collection',
		label: 'Collections',
		description: 'Trilogies, sagas & sets',
		icon: 'layers',
	},
];

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
	const [showUpload, setShowUpload] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [editMode, setEditMode] = useState(false);
	// Direct library upload is contributor/admin only.
	const canUpload =
		currentUser.value?.role === 'admin' || currentUser.value?.role === 'contributor';
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

	// Numeric filter inputs (year/rating/votes/runtime). Fires on `change`
	// (blur/Enter in Preact), so it doesn't refetch on every keystroke. Empty
	// clears the bound to null.
	const handleNumFilter = useCallback(
		(
			key: 'yearMin' | 'yearMax' | 'minRating' | 'minVotes' | 'runtimeMin' | 'runtimeMax',
			raw: string,
		) => {
			const trimmed = raw.trim();
			const num = trimmed === '' ? null : Number(trimmed);
			setFilters({ [key]: num != null && Number.isFinite(num) ? num : null });
		},
		[],
	);

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
					{searchQuery.value.trim() !== '' && (
						<button
							type="button"
							class={styles.backButton}
							onClick={libraryBack}
							title={
								searchBackStack.value.length > 0
									? 'Back to previous search'
									: 'Show all movies'
							}
							aria-label={
								searchBackStack.value.length > 0
									? 'Back to previous search'
									: 'Show all movies'
							}
						>
							<Icon name="arrow-left" size={18} />
						</button>
					)}
					<h1 class={styles.title}>Library</h1>
					<span class={styles.count}>
						{totalMovies.value} movies
						{watchedCount.value > 0 && !hideWatched.value && (
							<span class={styles.hiddenCount}> ({watchedCount.value} watched)</span>
						)}
					</span>
				</div>

				<div class={styles.headerActions}>
					{canUpload && (
						<Tooltip label="Upload a movie file or folder directly to the server's library">
							<button
								class={styles.showHiddenBtn}
								onClick={() => setShowUpload(true)}
								aria-label="Upload to library"
							>
								<Icon name="upload" />
								<span>Upload</span>
							</button>
						</Tooltip>
					)}

					<MultiSelect<LibraryContentType>
						options={TYPE_OPTIONS}
						selected={selectedTypes.value}
						onChange={(types) => {
							setSelectedTypes(types);
							fetchMovies(1);
						}}
						allOption={{ label: 'All', description: 'Everything in the library' }}
						leadingIcon="layers"
						menuAlign="start"
						aria-label="Filter by type"
						triggerLabel={(sel) =>
							sel.length === 0
								? 'Nothing'
								: sel.length === ALL_LIBRARY_TYPES.length
									? 'All types'
									: sel.length === 1
										? (TYPE_OPTIONS.find((o) => o.value === sel[0])?.label ??
											'1 type')
										: `${sel.length} types`
						}
					/>

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
						<div class={styles.filterLabelRow}>
							<h3 class={styles.filterLabel}>Genres</h3>
							<div
								class={styles.modeToggle}
								role="group"
								aria-label="Genre match mode"
								title="Or: any selected genre · And: must include all"
							>
								<button
									class={`${styles.modeBtn} ${filters.value.genreMode !== 'and' ? styles.modeActive : ''}`}
									onClick={() => setFilters({ genreMode: 'or' })}
								>
									Or
								</button>
								<button
									class={`${styles.modeBtn} ${filters.value.genreMode === 'and' ? styles.modeActive : ''}`}
									onClick={() => setFilters({ genreMode: 'and' })}
								>
									And
								</button>
							</div>
						</div>
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

					<div class={styles.filterFieldsRow}>
						<div class={styles.filterGroup}>
							<h3 class={styles.filterLabel}>Year</h3>
							<div class={styles.filterNumRow}>
								<NumberFilterInput
									class={styles.numInput}
									placeholder="From"
									aria-label="Year from"
									value={filters.value.yearMin}
									onCommit={(raw) => handleNumFilter('yearMin', raw)}
								/>
								<span class={styles.filterDash}>–</span>
								<NumberFilterInput
									class={styles.numInput}
									placeholder="To"
									aria-label="Year to"
									value={filters.value.yearMax}
									onCommit={(raw) => handleNumFilter('yearMax', raw)}
								/>
							</div>
						</div>

						<div class={styles.filterGroup}>
							<h3 class={styles.filterLabel}>Min rating</h3>
							<NumberFilterInput
								decimal
								min="0"
								max="10"
								step="0.1"
								class={styles.numInput}
								placeholder="0–10"
								aria-label="Minimum rating"
								value={filters.value.minRating}
								onCommit={(raw) => handleNumFilter('minRating', raw)}
							/>
						</div>

						<div class={styles.filterGroup}>
							<h3 class={styles.filterLabel}>Min votes</h3>
							<NumberFilterInput
								min="0"
								step="100"
								class={styles.numInput}
								placeholder="e.g. 1000"
								aria-label="Minimum votes"
								value={filters.value.minVotes}
								onCommit={(raw) => handleNumFilter('minVotes', raw)}
							/>
						</div>

						<div class={styles.filterGroup}>
							<h3 class={styles.filterLabel}>Runtime (min)</h3>
							<div class={styles.filterNumRow}>
								<NumberFilterInput
									min="0"
									class={styles.numInput}
									placeholder="Min"
									aria-label="Minimum runtime"
									value={filters.value.runtimeMin}
									onCommit={(raw) => handleNumFilter('runtimeMin', raw)}
								/>
								<span class={styles.filterDash}>–</span>
								<NumberFilterInput
									min="0"
									class={styles.numInput}
									placeholder="Max"
									aria-label="Maximum runtime"
									value={filters.value.runtimeMax}
									onCommit={(raw) => handleNumFilter('runtimeMax', raw)}
								/>
							</div>
						</div>
					</div>
				</div>
			)}

			<UploadMovieModal
				isOpen={showUpload}
				onClose={() => setShowUpload(false)}
				onUploaded={() => fetchMovies(1)}
			/>

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

			{/* The Library always renders the MIXED, grouped view: the server
			    (?interleaveGroups=true) unions ungrouped movies with collapsed
			    parent-group stacks, sorts them together, paginates, and returns
			    this page's groups inline as `pageGroups`. The type-filter
			    dropdown narrows which of {movies, series, collections} appear.
			    With no type selected, nothing is fetched — show a prompt. */}
			{selectedTypes.value.length === 0 ? (
				<div class={styles.groupsEmpty}>
					No types selected. Choose at least one type from the dropdown to show results.
				</div>
			) : (
				<MovieGrid
					movies={movies.value}
					// Groups are paginated + interleaved server-side and returned
					// per-page (pageGroups) — not the full set.
					groups={pageGroups.value}
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
							: 'Your library is empty'
					}
				/>
			)}

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
