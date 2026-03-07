import { api } from './api';

// ============================================
// Types
// ============================================

export interface Playlist {
  id: string;
  name: string;
  description: string;
  movieCount: number;
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

// ============================================
// Playlists Service
// ============================================

export const playlistsService = {
  /**
   * List all playlists for the current user.
   */
  list(): Promise<Playlist[]> {
    return api.get<Playlist[]>('/playlists');
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
