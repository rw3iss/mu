import { computed, signal } from '@preact/signals';

/**
 * Per-tab share-watch state.
 *
 * Stored in sessionStorage (NOT localStorage) so opening a share link in a new
 * tab never pollutes an existing logged-in session on the same browser.
 */

const STORAGE_KEY = 'mu_share_token';

function readInitial(): string | null {
	try {
		return sessionStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

export const shareToken = signal<string | null>(readInitial());
export const shareMovieId = signal<string | null>(null);
export const shareMode = computed(() => shareToken.value !== null);

/**
 * Music share link (`/listen/:token`) being played. Lives only while the
 * listen page is mounted (never stored), so a logged-in user's normal music
 * pages in the same tab are unaffected once they leave it.
 */
export const listenToken = signal<string | null>(null);

/** Any anonymous public playback (movie share or music listen link). */
export const publicMode = computed(() => shareToken.value !== null || listenToken.value !== null);

export function setShareToken(token: string, movieId: string): void {
	try {
		sessionStorage.setItem(STORAGE_KEY, token);
	} catch {}
	shareToken.value = token;
	shareMovieId.value = movieId;
}

export function clearShareToken(): void {
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch {}
	shareToken.value = null;
	shareMovieId.value = null;
}
