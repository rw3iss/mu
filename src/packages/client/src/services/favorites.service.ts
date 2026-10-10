import type { AlbumSummary, ArtistSummary, TrackSummary } from '@mu/shared';
import { api } from './api';

export type MusicFavoriteType = 'artist' | 'album' | 'track';
export type FavoriteEntityType = 'person' | 'movie' | MusicFavoriteType;

export interface AddFavoriteInput {
	entityType: FavoriteEntityType;
	role?: string | null;
	tmdbId?: number | null;
	imdbId?: string | null;
	name?: string | null;
	profileUrl?: string | null;
	movieId?: string | null;
	/** Entity id for music types (artist/album/track). */
	entityId?: string | null;
}

export interface RemoveFavoriteInput {
	entityType: FavoriteEntityType;
	tmdbId?: number | null;
	name?: string | null;
	movieId?: string | null;
	entityId?: string | null;
}

export interface FavoritesKeys {
	personKeys: string[];
	movieIds: string[];
	/** Music favorites as `<type>:<id>` (artist/album/track). */
	entityKeys?: string[];
}

export interface FavoritePerson {
	id: string;
	name: string;
	profileUrl: string | null;
	knownForDepartment: string | null;
	tmdbId: number | null;
	popularity: number | null;
	birthday: string | null;
}

export interface FavoriteMovie {
	id: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	overview: string | null;
	tmdbId: number | null;
	runtimeMinutes: number | null;
}

export interface FavoriteEntry {
	id: string;
	entityType: FavoriteEntityType;
	entityId: string;
	key: string;
	role: string | null;
	createdAt: string;
	person?: FavoritePerson;
	movie?: FavoriteMovie;
	artist?: ArtistSummary;
	album?: AlbumSummary;
	track?: TrackSummary;
}

export const favoritesService = {
	listKeys(): Promise<FavoritesKeys> {
		return api.get<FavoritesKeys>('/favorites/keys');
	},
	list(): Promise<{ favorites: FavoriteEntry[] }> {
		return api.get<{ favorites: FavoriteEntry[] }>('/favorites');
	},
	add(input: AddFavoriteInput): Promise<{ favorite: FavoriteEntry; ok: boolean }> {
		return api.post<{ favorite: FavoriteEntry; ok: boolean }>('/favorites', input);
	},
	remove(input: RemoveFavoriteInput): Promise<{ ok: boolean }> {
		return api.delete<{ ok: boolean }>('/favorites', { body: input });
	},
};
