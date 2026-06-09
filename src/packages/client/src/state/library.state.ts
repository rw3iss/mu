import type { LibraryContentType } from '@mu/shared';
import { computed, signal } from '@preact/signals';
import { route } from 'preact-router';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { moviesService } from '@/services/movies.service';
import { pageGroups } from './groups.state';

// ============================================
// Types
// ============================================

export interface RemoteOrigin {
	serverId: string;
	serverName: string;
	remoteMovieId: string;
}

export interface Movie {
	id: string;
	title: string;
	year: number;
	overview: string;
	tagline?: string;
	posterUrl: string;
	thumbnailUrl?: string;
	backdropUrl: string;
	trailerUrl?: string;
	runtime: number;
	releaseDate?: string;
	contentRating?: string;
	language?: string;
	country?: string;
	genres: string[];
	rating: number;
	imdbId?: string;
	tmdbId?: number;
	imdbRating?: number;
	imdbVotes?: number;
	tmdbRating?: number;
	rtRating?: number;
	metacriticRating?: number;
	cast: Array<{ name: string; character: string; profileUrl?: string }>;
	director?: string;
	directors?: string[];
	writers?: string[];
	keywords?: string[];
	productionCompanies?: string[];
	budget?: number;
	revenue?: number;
	hidden?: boolean;
	/**
	 * 'library' = file on disk, playable.
	 * 'bookmark' = user saved an external rec, no file.
	 * 'external' = stub fetched for ranking, evictable.
	 * Undefined = legacy row (treat as 'library').
	 */
	source?: 'library' | 'bookmark' | 'external';
	addedAt: string;
	watchProgress?: number;
	watchPosition?: number;
	durationSeconds?: number;
	watched?: boolean;
	inWatchlist?: boolean;
	status?: 'idle' | 'processing' | 'processing_playable';
	remoteOrigin?: RemoteOrigin;
	playSettings?: {
		eqProfileId?: string | null;
		compressorProfileId?: string | null;
		videoProfileId?: string | null;
	} | null;
	fileInfo?: {
		containerFormat?: string;
		codecVideo?: string;
		codecAudio?: string;
		resolution?: string;
		videoWidth?: number;
		videoHeight?: number;
		videoBitDepth?: number;
		videoFrameRate?: string;
		videoProfile?: string;
		videoColorSpace?: string;
		hdr?: boolean;
		bitrate?: number;
		fileSize?: number;
		fileName?: string;
		filePath?: string;
		audioTracks: {
			index: number;
			codec: string;
			language?: string;
			title?: string;
			channels?: number;
			channelLayout?: string;
			sampleRate?: number;
			bitDepth?: number;
		}[];
		subtitleTracks: {
			index: number;
			codec?: string;
			language?: string;
			title?: string;
			forced?: boolean;
			external?: boolean;
		}[];
	};
	/** Subgroup FK — set when the movie has been grouped into a TV season / collection / etc. */
	groupId?: string | null;
	groupEpisodeOrdinal?: number | null;
}

export interface LibraryFilters {
	genres: string[];
	/** Year bounds (inclusive). null = unbounded. */
	yearMin: number | null;
	yearMax: number | null;
	/** Minimum external (IMDb) rating 0–10, and minimum vote count. */
	minRating: number | null;
	minVotes: number | null;
	/** Runtime bounds in minutes. */
	runtimeMin: number | null;
	runtimeMax: number | null;
	sortBy: 'title' | 'year' | 'rating' | 'addedAt' | 'runtime' | 'fileSize';
	sortOrder: 'asc' | 'desc';
}

export type ViewMode = 'large' | 'grid' | 'list';

// ============================================
// Signals
// ============================================

export const movies = signal<Movie[]>([]);
export const totalMovies = signal(0);
export const hiddenCount = signal(0);
export const currentPage = signal(1);
export const pageSize = signal(parseInt(localStorage.getItem('mu_page_size') || '40', 10) || 40);
export const isLoading = signal(false);
export const searchQuery = signal('');
export const viewMode = signal<ViewMode>('grid');
export const showHidden = signal(false);
export const hideWatched = signal(localStorage.getItem('mu_hide_watched') === 'true');
export const watchedCount = signal(0);
export const localOnly = signal(localStorage.getItem('mu_local_only') === 'true');
/** Server filter: 'all' | 'local' | serverId */
export const serverFilter = signal(localStorage.getItem('mu_server_filter') || 'all');
export const hasRemoteServers = signal(false);
export const remoteServerList = signal<{ id: string; name: string }[]>([]);

/**
 * Stack of previous distinct searches the Library "back" arrow can return to.
 * Maintained by the header search input (TopBar) as the user settles on
 * different searches; consumed by the back arrow next to the Library title.
 */
export const searchBackStack = signal<string[]>([]);

/**
 * Navigate the Library to a search query (or clear it). Replaces history while
 * already on /library so auto-search-as-you-type doesn't spam browser history;
 * pushes a real entry when arriving at /library from another page.
 */
export function navToLibrary(value: string): void {
	const trimmed = value.trim();
	const target = trimmed ? `/library?q=${encodeURIComponent(trimmed)}` : '/library';
	const current = window.location.pathname + window.location.search;
	if (current === target) return;
	const onLibrary = window.location.pathname === '/library';
	route(target, onLibrary);
}

/**
 * Library "back" action: return to the previous distinct search, or — when the
 * stack is empty — clear the search and show all results. The URL change is
 * picked up by both the Library page and the header input, so no local state
 * needs threading. Used by the back arrow beside the Library title.
 */
export function libraryBack(): void {
	const stack = searchBackStack.value;
	if (stack.length > 0) {
		const prev = stack[stack.length - 1]!;
		searchBackStack.value = stack.slice(0, -1);
		navToLibrary(prev);
	} else {
		navToLibrary('');
	}
}

/**
 * Library content-type filter (the toolbar checklist dropdown). Persisted
 * per-user. Default: all types selected (no `type` param sent → server
 * returns everything). An empty array means "show nothing" — the page
 * clears results and skips the request entirely until a type is chosen.
 */
export const ALL_LIBRARY_TYPES: readonly LibraryContentType[] = ['movie', 'series', 'collection'];

export const selectedTypes = signal<LibraryContentType[]>(
	normalizeTypes(getUiSetting<LibraryContentType[]>('library_types', [...ALL_LIBRARY_TYPES])),
);

function normalizeTypes(types: LibraryContentType[]): LibraryContentType[] {
	// Keep canonical order + drop anything unrecognised / duplicated.
	return ALL_LIBRARY_TYPES.filter((t) => types.includes(t));
}

export function setSelectedTypes(types: LibraryContentType[]): void {
	const norm = normalizeTypes(types);
	selectedTypes.value = norm;
	setUiSetting('library_types', norm);
}

export const filters = signal<LibraryFilters>({
	genres: [],
	yearMin: null,
	yearMax: null,
	minRating: null,
	minVotes: null,
	runtimeMin: null,
	runtimeMax: null,
	sortBy: (localStorage.getItem('mu_sort_by') as LibraryFilters['sortBy']) || 'addedAt',
	sortOrder: (localStorage.getItem('mu_sort_order') as LibraryFilters['sortOrder']) || 'desc',
});

export const totalPages = computed(() => Math.ceil(totalMovies.value / pageSize.value));

// ============================================
// Actions
// ============================================

export async function fetchMovies(page = 1): Promise<void> {
	currentPage.value = page;

	// No type selected → show nothing and skip the request entirely. Keeps the
	// API simple (we never send an empty `type`) and avoids a pointless call.
	if (selectedTypes.value.length === 0) {
		movies.value = [];
		pageGroups.value = [];
		totalMovies.value = 0;
		isLoading.value = false;
		return;
	}

	isLoading.value = true;

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

		if (filters.value.yearMin != null) params.yearFrom = String(filters.value.yearMin);
		if (filters.value.yearMax != null) params.yearTo = String(filters.value.yearMax);
		if (filters.value.minRating != null) params.minRating = String(filters.value.minRating);
		if (filters.value.minVotes != null) params.minVotes = String(filters.value.minVotes);
		if (filters.value.runtimeMin != null) params.minRuntime = String(filters.value.runtimeMin);
		if (filters.value.runtimeMax != null) params.maxRuntime = String(filters.value.runtimeMax);

		// The Library shows ALL movies, including ones marked hidden (the Hidden
		// toggle was removed) — always request them.
		params.showHidden = 'true';

		if (hideWatched.value) {
			params.hideWatched = 'true';
		}

		// The Library always renders series / collections as collapsed group
		// "stacks" (never flattened to individual members), so we always use the
		// interleaved view: the server unions ungrouped movies with group stacks
		// in one sorted, paginated list and returns the page's groups inline.
		params.interleaveGroups = 'true';

		// Type filter. All types selected → send nothing (server returns all).
		// A subset → send the explicit list; the empty case returned early above.
		if (selectedTypes.value.length < ALL_LIBRARY_TYPES.length) {
			params.type = selectedTypes.value.join(',');
		}

		const sf = serverFilter.value;
		if (sf && sf !== 'all') {
			params.server = sf;
		}

		const response = await moviesService.list(params);
		movies.value = response.movies;
		// Page's interleaved group stacks (mixed view). Empty for other modes.
		pageGroups.value = response.groups ?? [];
		totalMovies.value = response.total;
		hiddenCount.value = response.hiddenCount ?? 0;
		watchedCount.value = response.watchedCount ?? 0;

		// Track remote servers
		const rs = (response as any).remoteServers;
		if (rs?.length > 0) {
			hasRemoteServers.value = true;
			remoteServerList.value = rs.map((s: any) => ({ id: s.id, name: s.name }));
		}
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

export function updateMovieInList(updated: Movie): void {
	movies.value = movies.value.map((m) => (m.id === updated.id ? { ...m, ...updated } : m));
}

export function removeMovieFromList(movieId: string): void {
	movies.value = movies.value.filter((m) => m.id !== movieId);
}

export function toggleShowHidden(): void {
	showHidden.value = !showHidden.value;
	fetchMovies(1);
}

export function toggleHideWatched(): void {
	hideWatched.value = !hideWatched.value;
	localStorage.setItem('mu_hide_watched', String(hideWatched.value));
	fetchMovies(1);
}

export function toggleLocalOnly(): void {
	localOnly.value = !localOnly.value;
	localStorage.setItem('mu_local_only', String(localOnly.value));
	fetchMovies(1);
}

export function setServerFilter(value: string): void {
	serverFilter.value = value;
	localStorage.setItem('mu_server_filter', value);
	// Sync legacy localOnly for compatibility
	localOnly.value = value === 'local';
	localStorage.setItem('mu_local_only', String(value === 'local'));
	fetchMovies(1);
}

export async function initRemoteServers(): Promise<void> {
	try {
		const { api } = await import('@/services/api');
		const servers =
			await api.get<{ id: string; name: string; url: string; enabled: boolean }[]>(
				'/remote/servers',
			);
		const enabled = servers.filter((s) => s.enabled);
		if (enabled.length > 0) {
			hasRemoteServers.value = true;
			remoteServerList.value = enabled.map((s) => ({ id: s.id, name: s.name }));
		}
	} catch {
		// Remote servers not available
	}
}

export function setPageSize(size: number): void {
	pageSize.value = size;
	localStorage.setItem('mu_page_size', String(size));
	fetchMovies(1);
}

/** Save the current library scroll position so we can restore it on back-nav. */
export function saveLibraryScroll(): void {
	try {
		sessionStorage.setItem(
			'mu_library_scroll',
			JSON.stringify({ page: currentPage.value, scrollY: window.scrollY }),
		);
	} catch {}
}

/** Restore saved scroll position (returns the saved page, or null). */
export function restoreLibraryScroll(): { page: number; scrollY: number } | null {
	try {
		const raw = sessionStorage.getItem('mu_library_scroll');
		if (!raw) return null;
		const saved = JSON.parse(raw);
		if (saved && typeof saved.page === 'number') return saved;
	} catch {}
	return null;
}

export function initSortPrefs(): void {
	const sortBy = localStorage.getItem('mu_sort_by') as LibraryFilters['sortBy'] | null;
	const sortOrder = localStorage.getItem('mu_sort_order') as 'asc' | 'desc' | null;
	if (sortBy && ['title', 'year', 'rating', 'addedAt', 'runtime', 'fileSize'].includes(sortBy)) {
		filters.value = { ...filters.value, sortBy };
	}
	if (sortOrder === 'asc' || sortOrder === 'desc') {
		filters.value = { ...filters.value, sortOrder };
	}
}
