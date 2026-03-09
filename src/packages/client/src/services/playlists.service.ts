import { api } from './api';

// ============================================
// Types
// ============================================

export interface PlaylistMovieSummary {
  movieId: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  runtimeMinutes: number | null;
  durationSeconds: number | null;
  addedAt: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  movieCount: number;
  movies?: PlaylistMovieSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistMovie {
  id: string;
  title: string;
  posterUrl: string;
  year: number;
  addedAt: string;
}

export interface PlaylistDetail extends Playlist {
  movies: PlaylistMovie[];
}

export interface MoviePlaylistInfo {
  id: string;
  name: string;
}

// ============================================
// Playlists Service
// ============================================

export const playlistsService = {
  /**
   * List all playlists for the current user.
   * Pass includeMovies=true to get movie summaries (title, year, poster) with each playlist.
   */
  list(options?: { includeMovies?: boolean }): Promise<Playlist[]> {
    const params = options?.includeMovies ? '?includeMovies=true' : '';
    return api.get<Playlist[]>(`/playlists${params}`);
  },

  /**
   * Get a single playlist by ID, including its movies.
   */
  get(id: string): Promise<PlaylistDetail> {
    return api.get<PlaylistDetail>(`/playlists/${id}`);
  },

  /**
   * Create a new playlist.
   * @param name - The playlist name.
   * @param description - An optional description for the playlist.
   */
  create(name: string, description?: string): Promise<PlaylistDetail> {
    return api.post<PlaylistDetail>('/playlists', { name, description });
  },

  /**
   * Update an existing playlist's name or description.
   * @param id - The playlist ID.
   * @param data - Fields to update.
   */
  update(id: string, data: { name?: string; description?: string }): Promise<PlaylistDetail> {
    return api.patch<PlaylistDetail>(`/playlists/${id}`, data);
  },

  /**
   * Delete a playlist.
   * @param id - The playlist ID to remove.
   */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/playlists/${id}`);
  },

  /**
   * Get all playlists that contain a given movie.
   */
  getByMovie(movieId: string): Promise<MoviePlaylistInfo[]> {
    return api.get<MoviePlaylistInfo[]>(`/playlists/by-movie/${movieId}`);
  },

  /**
   * Add a movie to a playlist.
   * @param playlistId - The playlist ID.
   * @param movieId - The movie ID to add.
   */
  addMovie(playlistId: string, movieId: string): Promise<void> {
    return api.post<void>(`/playlists/${playlistId}/movies`, { movieId });
  },

  /**
   * Remove a movie from a playlist.
   * @param playlistId - The playlist ID.
   * @param movieId - The movie ID to remove.
   */
  removeMovie(playlistId: string, movieId: string): Promise<void> {
    return api.delete<void>(`/playlists/${playlistId}/movies/${movieId}`);
  },
};
