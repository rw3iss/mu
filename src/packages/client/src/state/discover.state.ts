import { signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import {
	type DiscoverFilters,
	discoverService,
	type IncludeMode,
	type ScoredMovie,
} from '@/services/discover.service';

/**
 * Persistent client state for the Discover page. Multiple seeds
 * are supported (collection / multi-select) — empty array = no
 * seed = personalised recommendations.
 */
export const seedMovieIds = signal<string[]>([]);
/**
 * Person seeds (namespaced keys, e.g. `tmdb:287`). Server resolves
 * each into in-library credit movie ids. Independent of
 * seedMovieIds — both are merged on the server.
 */
export const personSeedKeys = signal<string[]>([]);
/** Labels for displayed person seed chips. */
export const personSeedLabels = signal<Record<string, string>>({});
/** Person keys the server could NOT resolve to owned credits. */
export const unresolvedPersonKeys = signal<string[]>([]);
export const seedLabels = signal<Record<string, string>>({});
export const filters = signal<DiscoverFilters>({});
export const includeMode = signal<IncludeMode>('owned');
/**
 * When true, the server blends the user's taste profile (favorites,
 * ratings, watch history) into the recommendation. When false AND
 * there are no seeds, the server returns a filter-only cold browse.
 * Persisted to localStorage so the user's preference sticks across
 * sessions.
 */
export const useProfile = signal<boolean>(getUiSetting<boolean>('discover_use_profile', true));
export const results = signal<ScoredMovie[]>([]);
export const isLoading = signal<boolean>(false);
export const errorMessage = signal<string | null>(null);
export const usedSources = signal<string[]>([]);
export const enrichmentsQueued = signal<number>(0);

/**
 * Save the scroll position the next time the user navigates away
 * from /discover — and restore it on mount. Mirrors the Library
 * page's saveLibraryScroll / restoreLibraryScroll pattern but uses
 * sessionStorage so the position only sticks for the current tab.
 */
const SCROLL_KEY = 'mu_discover_scroll';

export function saveDiscoverScroll(): void {
	try {
		sessionStorage.setItem(
			SCROLL_KEY,
			JSON.stringify({ scrollY: window.scrollY, savedAt: Date.now() }),
		);
	} catch {}
}

export function restoreDiscoverScroll(): number | null {
	try {
		const raw = sessionStorage.getItem(SCROLL_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { scrollY?: number; savedAt?: number };
		if (typeof parsed.scrollY !== 'number') return null;
		// Stale scroll (older than 30 min) → ignore.
		if (parsed.savedAt && Date.now() - parsed.savedAt > 30 * 60 * 1000) return null;
		return parsed.scrollY;
	} catch {
		return null;
	}
}

export function clearDiscoverScroll(): void {
	try {
		sessionStorage.removeItem(SCROLL_KEY);
	} catch {}
}

export function setIncludeMode(mode: IncludeMode): void {
	includeMode.value = mode;
}

export function setUseProfile(next: boolean): void {
	useProfile.value = next;
	setUiSetting('discover_use_profile', next);
}

export function setSeed(movieId: string | null, label?: string): void {
	if (!movieId) {
		seedMovieIds.value = [];
		seedLabels.value = {};
	} else {
		seedMovieIds.value = [movieId];
		seedLabels.value = label ? { [movieId]: label } : {};
	}
}

export function addSeed(movieId: string, label?: string): void {
	if (seedMovieIds.value.includes(movieId)) return;
	seedMovieIds.value = [...seedMovieIds.value, movieId];
	if (label) seedLabels.value = { ...seedLabels.value, [movieId]: label };
}

export function removeSeed(movieId: string): void {
	seedMovieIds.value = seedMovieIds.value.filter((id) => id !== movieId);
	const next = { ...seedLabels.value };
	delete next[movieId];
	seedLabels.value = next;
}

export function addPersonSeed(key: string, label?: string): void {
	if (personSeedKeys.value.includes(key)) return;
	personSeedKeys.value = [...personSeedKeys.value, key];
	if (label) personSeedLabels.value = { ...personSeedLabels.value, [key]: label };
}

export function removePersonSeed(key: string): void {
	personSeedKeys.value = personSeedKeys.value.filter((k) => k !== key);
	const next = { ...personSeedLabels.value };
	delete next[key];
	personSeedLabels.value = next;
}

export function clearSeeds(): void {
	seedMovieIds.value = [];
	personSeedKeys.value = [];
	personSeedLabels.value = {};
	unresolvedPersonKeys.value = [];
	seedLabels.value = {};
}

export function setFilters(next: DiscoverFilters): void {
	filters.value = next;
}

export function clearFilters(): void {
	filters.value = {};
}

/**
 * In-flight controller so rapid filter changes (or refresh spamming)
 * cancel the previous request instead of racing N responses. The
 * losing request still resolves on the server but its `.then()` is
 * skipped here.
 */
let inFlightController: AbortController | null = null;
/** Debounce handle for the auto-fetch subscribers. */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const FETCH_DEBOUNCE_MS = 220;

export async function runDiscover(): Promise<void> {
	// Cancel any in-flight request before kicking off a new one.
	inFlightController?.abort();
	const controller = new AbortController();
	inFlightController = controller;

	isLoading.value = true;
	errorMessage.value = null;
	try {
		const seeds = seedMovieIds.value;
		const pKeys = personSeedKeys.value;
		const response = await discoverService.fetch(
			{
				seedMovieIds: seeds.length > 0 ? seeds : undefined,
				personKeys: pKeys.length > 0 ? pKeys : undefined,
				filters: filters.value,
				limit: 36,
				include: includeMode.value,
				useProfile: useProfile.value,
			},
			{ signal: controller.signal },
		);
		if (controller.signal.aborted) return;
		results.value = response.results;
		usedSources.value = response.usedSources;
		enrichmentsQueued.value = response.enrichmentsQueued ?? 0;
		unresolvedPersonKeys.value = response.unresolvedPersonKeys ?? [];
	} catch (err: any) {
		// Aborted requests aren't errors — they're voluntary cancellations.
		if (err?.name === 'AbortError' || controller.signal.aborted) return;
		errorMessage.value = err?.message ?? 'Failed to fetch recommendations';
		results.value = [];
		usedSources.value = [];
		enrichmentsQueued.value = 0;
		unresolvedPersonKeys.value = [];
	} finally {
		if (inFlightController === controller) {
			isLoading.value = false;
			inFlightController = null;
		}
	}
}

/**
 * Debounced wrapper: coalesces bursts of filter/seed/mode changes
 * into a single fetch ~220ms after the last edit. Used by the
 * Discover page's signal subscribers so typing in the cast/director
 * field doesn't fire one request per keystroke.
 */
export function scheduleDiscover(): void {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void runDiscover();
	}, FETCH_DEBOUNCE_MS);
}
