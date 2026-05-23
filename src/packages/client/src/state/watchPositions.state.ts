import { signal } from '@preact/signals';
import { api } from '@/services/api';

export interface WatchPosition {
	positionSeconds: number;
	durationSeconds: number | null;
	watchedAt: string;
}

/**
 * Global map of `movieId → latest resume position` for the signed-in
 * user. Hydrated from `GET /api/v1/history/positions` once on app
 * init, then kept fresh by:
 *   - Player progress ticks (every 3s during playback)
 *   - Explicit clears when playback ends or the user "starts over"
 *   - A re-fetch on window focus (so other tabs / devices propagate)
 *
 * Movie cards, the detail page, and the player all read from here,
 * so every surface that shows a movie agrees on whether to render
 * the resume bar.
 */
export const watchPositions = signal<Record<string, WatchPosition>>({});

/** True once a hydration attempt has completed (success or fail). */
export const watchPositionsLoaded = signal(false);

interface ServerResponse {
	positions: Array<{
		movieId: string;
		positionSeconds: number;
		durationSeconds: number | null;
		watchedAt: string;
	}>;
}

let inFlight: Promise<void> | null = null;

/** Hydrate the signal from the server. Cheap; one indexed query. */
export async function fetchWatchPositions(force = false): Promise<void> {
	if (!force && inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const data = await api.get<ServerResponse>('/history/positions');
			const next: Record<string, WatchPosition> = {};
			for (const p of data.positions) {
				next[p.movieId] = {
					positionSeconds: p.positionSeconds,
					durationSeconds: p.durationSeconds,
					watchedAt: p.watchedAt,
				};
			}
			watchPositions.value = next;
		} catch (err) {
			console.warn('Failed to hydrate watch positions:', err);
		} finally {
			watchPositionsLoaded.value = true;
		}
	})();
	try {
		await inFlight;
	} finally {
		inFlight = null;
	}
}

/**
 * Optimistic update — called from the player's 3s tick so cards
 * reflect playback in real time without waiting on the server.
 * The server has its own canonical state; this just keeps the UI
 * snappy.
 */
export function setLocalPosition(
	movieId: string,
	positionSeconds: number,
	durationSeconds: number | null,
): void {
	if (positionSeconds <= 0 || !movieId) return;
	watchPositions.value = {
		...watchPositions.value,
		[movieId]: {
			positionSeconds,
			durationSeconds,
			watchedAt: new Date().toISOString(),
		},
	};
}

/**
 * Remove a movie's position from the local cache. Used when the
 * player reaches end-of-stream or when the user clicks "Start over".
 * Pair with `api.delete('/history/movies/:id/position')` for the
 * server-side clear.
 */
export function clearLocalPosition(movieId: string): void {
	if (!movieId || !watchPositions.value[movieId]) return;
	const next = { ...watchPositions.value };
	delete next[movieId];
	watchPositions.value = next;
}

/**
 * Server-side clear for one movie. Updates the local cache eagerly
 * (so the resume bar disappears immediately) then hits the API.
 * Safe to call when no row exists — the endpoint is idempotent.
 */
export async function clearWatchPosition(movieId: string): Promise<void> {
	clearLocalPosition(movieId);
	try {
		await api.delete(`/history/movies/${encodeURIComponent(movieId)}/position`);
	} catch (err) {
		console.warn(`Failed to clear watch position for ${movieId}:`, err);
	}
}
