import { signal } from '@preact/signals';
import {
	type AddFavoriteInput,
	type FavoriteEntry,
	favoritesService,
	type RemoveFavoriteInput,
} from '@/services/favorites.service';

/**
 * Per-user favorite identity caches. Person keys are namespaced
 * ("tmdb:287" / "name:brad-pitt"). Movie ids are local DB ids.
 * Single full-set hydration on first need keeps `isFavorite()`
 * synchronous and O(1) across cast lists, headers, and grids.
 */
export const favoritePersonKeys = signal<Set<string> | null>(null);
export const favoriteMovieIds = signal<Set<string> | null>(null);
export const favoritesLoading = signal<boolean>(false);

let keysInflight: Promise<void> | null = null;

export async function ensureFavoritesLoaded(): Promise<void> {
	if (favoritePersonKeys.value !== null && favoriteMovieIds.value !== null) return;
	if (keysInflight) return keysInflight;
	favoritesLoading.value = true;
	keysInflight = favoritesService
		.listKeys()
		.then((res) => {
			favoritePersonKeys.value = new Set(res.personKeys);
			favoriteMovieIds.value = new Set(res.movieIds);
		})
		.catch(() => {
			// Initialize with empty sets so isFavorite() stops returning
			// indeterminate; refresh on next mutation.
			favoritePersonKeys.value = new Set();
			favoriteMovieIds.value = new Set();
		})
		.finally(() => {
			favoritesLoading.value = false;
			keysInflight = null;
		});
	return keysInflight;
}

export function invalidateFavorites(): void {
	favoritePersonKeys.value = null;
	favoriteMovieIds.value = null;
	keysInflight = null;
}

export function isPersonFavorited(key: string): boolean {
	return favoritePersonKeys.value?.has(key) ?? false;
}

export function isMovieFavorited(movieId: string): boolean {
	return favoriteMovieIds.value?.has(movieId) ?? false;
}

function mutatePerson(key: string, op: 'add' | 'remove'): void {
	const cur = favoritePersonKeys.value;
	if (!cur) return;
	const next = new Set(cur);
	if (op === 'add') next.add(key);
	else next.delete(key);
	favoritePersonKeys.value = next;
}

function mutateMovie(id: string, op: 'add' | 'remove'): void {
	const cur = favoriteMovieIds.value;
	if (!cur) return;
	const next = new Set(cur);
	if (op === 'add') next.add(id);
	else next.delete(id);
	favoriteMovieIds.value = next;
}

export async function addFavorite(input: AddFavoriteInput): Promise<FavoriteEntry | null> {
	// Optimistic update — flip the key before the network call so the
	// star fills in instantly. Revert on failure.
	if (input.entityType === 'person') {
		const key = input.tmdbId ? `tmdb:${input.tmdbId}` : `name:${slugifyName(input.name ?? '')}`;
		if (favoritePersonKeys.value?.has(key)) return null;
		mutatePerson(key, 'add');
		try {
			const { favorite } = await favoritesService.add(input);
			return favorite;
		} catch (err) {
			mutatePerson(key, 'remove');
			throw err;
		}
	}
	if (input.entityType === 'movie' && input.movieId) {
		if (favoriteMovieIds.value?.has(input.movieId)) return null;
		mutateMovie(input.movieId, 'add');
		try {
			const { favorite } = await favoritesService.add(input);
			return favorite;
		} catch (err) {
			mutateMovie(input.movieId, 'remove');
			throw err;
		}
	}
	return null;
}

export async function removeFavorite(input: RemoveFavoriteInput): Promise<void> {
	if (input.entityType === 'person') {
		const key = input.tmdbId ? `tmdb:${input.tmdbId}` : `name:${slugifyName(input.name ?? '')}`;
		if (!favoritePersonKeys.value?.has(key)) return;
		mutatePerson(key, 'remove');
		try {
			await favoritesService.remove(input);
		} catch (err) {
			mutatePerson(key, 'add');
			throw err;
		}
	} else if (input.entityType === 'movie' && input.movieId) {
		if (!favoriteMovieIds.value?.has(input.movieId)) return;
		mutateMovie(input.movieId, 'remove');
		try {
			await favoritesService.remove(input);
		} catch (err) {
			mutateMovie(input.movieId, 'add');
			throw err;
		}
	}
}

export function slugifyName(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export function personKeyFor(opts: { tmdbId?: number | null; name?: string | null }): string {
	if (opts.tmdbId) return `tmdb:${opts.tmdbId}`;
	if (opts.name) return `name:${slugifyName(opts.name)}`;
	return 'name:unknown';
}
