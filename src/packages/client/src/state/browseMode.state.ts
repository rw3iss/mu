import type { BrowseMode } from '@mu/shared';
import { computed } from '@preact/signals';
import { getUiSettingSignal, setUiSetting } from '@/hooks/useUiSetting';
import { features } from './features.state';

/**
 * Header Movies | Music browse mode. Persisted under the `browse_mode` UI
 * setting; forced when only one feature is enabled. The URL wins: visiting a
 * music route switches to music, a movie route switches to movies.
 * See docs/music-support-plan.md §6.1.
 */
const KEY = 'browse_mode';
const stored = getUiSettingSignal<BrowseMode>(KEY, 'movies');

/** Both features on → the header toggle is shown. */
export const canToggleBrowseMode = computed(() => features.value.movies && features.value.music);

export const browseMode = computed<BrowseMode>(() => {
	const f = features.value;
	if (f.music && !f.movies) return 'music';
	if (!f.music) return 'movies';
	return stored.value === 'music' ? 'music' : 'movies';
});

export const isMusicMode = computed(() => browseMode.value === 'music');

export function setBrowseMode(mode: BrowseMode): void {
	if (stored.value !== mode) setUiSetting(KEY, mode);
}

function under(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

const MUSIC_ROOTS = ['/music', '/album', '/artist', '/track'];
const MOVIE_ROOTS = ['/library', '/discover', '/movie', '/person', '/group', '/watchlist'];

/** Which mode a path belongs to (null = shared page like /playlists or /). */
export function modeForPath(path: string): BrowseMode | null {
	const p = path.split('?')[0] ?? path;
	if (MUSIC_ROOTS.some((r) => under(p, r))) return 'music';
	if (MOVIE_ROOTS.some((r) => under(p, r))) return 'movies';
	return null;
}

/** Called on every route change — a pasted /album/… link flips the mode. */
export function syncBrowseModeFromPath(path: string): void {
	const m = modeForPath(path);
	if (m) setBrowseMode(m);
}

/** The mode's home page. */
export function homePathFor(mode: BrowseMode): string {
	return mode === 'music' ? '/music' : '/';
}

/**
 * The equivalent page in the other mode: library ↔ library, discover ↔
 * discover, home ↔ home; detail pages go to the target mode's home; shared
 * pages (/playlists, /favorites, …) stay put and re-filter by mode.
 */
export function equivalentPath(path: string, target: BrowseMode): string {
	const p = path.split('?')[0] ?? path;
	const shared = p !== '/' && modeForPath(p) === null;
	if (shared) return p;
	if (target === 'music') {
		if (under(p, '/library')) return '/music/library';
		if (under(p, '/discover')) return '/music/discover';
		return '/music';
	}
	if (under(p, '/music/library')) return '/library';
	if (under(p, '/music/discover')) return '/discover';
	return '/';
}
