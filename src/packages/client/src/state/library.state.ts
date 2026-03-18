import { computed, signal } from '@preact/signals';
import { moviesService } from '@/services/movies.service';

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
	addedAt: string;
	watchProgress?: number;
	watchPosition?: number;
	durationSeconds?: number;
	inWatchlist?: boolean;
	status?: 'idle' | 'processing';
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
}

export interface LibraryFilters {
	genres: string[];
	yearRange: [number, number] | null;
	ratingRange: [number, number] | null;
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
export const pageSize = signal(40);
export const isLoading = signal(false);
export const searchQuery = signal('');
export const viewMode = signal<ViewMode>('grid');
export const showHidden = signal(false);
export const localOnly = signal(localStorage.getItem('mu_local_only') === 'true');
/** Server filter: 'all' | 'local' | serverId */
export const serverFilter = signal(localStorage.getItem('mu_server_filter') || 'all');
export const hasRemoteServers = signal(false);
export const remoteServerList = signal<{ id: string; name: string }[]>([]);

export const filters = signal<LibraryFilters>({
	genres: [],
	yearRange: null,
	ratingRange: null,
	sortBy: (localStorage.getItem('mu_sort_by') as LibraryFilters['sortBy']) || 'addedAt',
	sortOrder: (localStorage.getItem('mu_sort_order') as LibraryFilters['sortOrder']) || 'desc',
});

export const totalPages = computed(() => Math.ceil(totalMovies.value / pageSize.value));

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

		if (showHidden.value) {
			params.showHidden = 'true';
		}

		const sf = serverFilter.value;
		if (sf && sf !== 'all') {
			params.server = sf;
		}

		const response = await moviesService.list(params);
		movies.value = response.movies;
		totalMovies.value = response.total;
		hiddenCount.value = response.hiddenCount ?? 0;

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

export function toggleShowHidden(): void {
	showHidden.value = !showHidden.value;
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
