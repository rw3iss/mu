import { signal } from '@preact/signals';
import {
	type MoviePlaylistInfo,
	type Playlist,
	playlistsService,
} from '@/services/playlists.service';

// ============================================
// Signals
// ============================================

/** Cached list of all playlists, sorted by most-recently-updated first. Null = not loaded. */
export const playlists = signal<Playlist[] | null>(null);

/** True while the initial list fetch is in flight. */
export const playlistsLoading = signal<boolean>(false);

// ============================================
// Internal caches (kept out of signals — these are query caches, not UI state)
// ============================================

let listInflight: Promise<Playlist[]> | null = null;
const membershipCache = new Map<string, MoviePlaylistInfo[]>();
const membershipInflight = new Map<string, Promise<MoviePlaylistInfo[]>>();

// ============================================
// Helpers
// ============================================

function recencyTime(p: Playlist): number {
	return new Date(p.updatedAt || p.createdAt || 0).getTime();
}

function sortByRecency(list: Playlist[]): Playlist[] {
	return [...list].sort((a, b) => recencyTime(b) - recencyTime(a));
}

// ============================================
// List cache
// ============================================

/**
 * Lazily load and cache the playlist list. Returns the cached value on
 * subsequent calls. Concurrent callers share a single in-flight request.
 */
export async function ensurePlaylistsLoaded(): Promise<Playlist[]> {
	if (playlists.value !== null) return playlists.value;
	if (listInflight) return listInflight;

	playlistsLoading.value = true;
	listInflight = playlistsService
		.list()
		.then((list) => {
			const sorted = sortByRecency(list);
			playlists.value = sorted;
			return sorted;
		})
		.finally(() => {
			playlistsLoading.value = false;
			listInflight = null;
		});
	return listInflight;
}

/** Drop all cached playlists + memberships. Used after CRUD on management pages. */
export function invalidatePlaylists(): void {
	playlists.value = null;
	listInflight = null;
	membershipCache.clear();
	membershipInflight.clear();
}

// ============================================
// Per-movie membership cache
// ============================================

/**
 * Get the playlists that contain the given movie. Cached per-movie; concurrent
 * callers share a single in-flight request.
 */
export async function getMembership(movieId: string): Promise<MoviePlaylistInfo[]> {
	const cached = membershipCache.get(movieId);
	if (cached) return cached;
	const inflight = membershipInflight.get(movieId);
	if (inflight) return inflight;

	const promise = playlistsService
		.getByMovie(movieId)
		.then((list) => {
			membershipCache.set(movieId, list);
			return list;
		})
		.finally(() => {
			membershipInflight.delete(movieId);
		});
	membershipInflight.set(movieId, promise);
	return promise;
}

/** Synchronously read the cached membership, or null if not yet fetched. */
export function getCachedMembership(movieId: string): MoviePlaylistInfo[] | null {
	return membershipCache.get(movieId) ?? null;
}

export function invalidateMembership(movieId: string): void {
	membershipCache.delete(movieId);
	membershipInflight.delete(movieId);
}

// ============================================
// Mutations — wrap the service so the cache stays consistent
// ============================================

function bumpRecency(list: Playlist[], playlistId: string, deltaCount: number): Playlist[] {
	const now = new Date().toISOString();
	const updated = list.map((p) =>
		p.id === playlistId
			? { ...p, updatedAt: now, movieCount: Math.max(0, p.movieCount + deltaCount) }
			: p,
	);
	return sortByRecency(updated);
}

/** Add a movie to a playlist and update local caches. */
export async function addMovieToPlaylist(
	playlistId: string,
	movieId: string,
	remoteInfo?: { title: string; posterUrl?: string; serverId: string },
): Promise<void> {
	await playlistsService.addMovie(playlistId, movieId, remoteInfo);

	// Update membership cache for this movie
	const target = playlists.value?.find((p) => p.id === playlistId);
	const member = membershipCache.get(movieId);
	if (member && target && !member.some((m) => m.id === playlistId)) {
		membershipCache.set(movieId, [...member, { id: target.id, name: target.name }]);
	}

	// Bump the playlist's recency so it floats to the top of the list
	if (playlists.value) {
		playlists.value = bumpRecency(playlists.value, playlistId, +1);
	}
}

/** Remove a movie from a playlist and update local caches. */
export async function removeMovieFromPlaylist(playlistId: string, movieId: string): Promise<void> {
	await playlistsService.removeMovie(playlistId, movieId);

	const member = membershipCache.get(movieId);
	if (member) {
		membershipCache.set(
			movieId,
			member.filter((m) => m.id !== playlistId),
		);
	}

	if (playlists.value) {
		playlists.value = bumpRecency(playlists.value, playlistId, -1);
	}
}
