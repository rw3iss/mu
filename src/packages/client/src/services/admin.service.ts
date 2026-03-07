import { api } from './api';

// ============================================
// Types
// ============================================

export interface ServerStatus {
  status: string;
  uptime: number;
  version: string;
  timestamp: string;
}

export interface StreamSession {
  sessionId: string;
  userId: string;
  username: string;
  movieId: string;
  movieTitle: string;
  position: number;
  startedAt: string;
  lastActivity: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  createdAt: string;
  lastLoginAt: string;
}

// ============================================
// Admin Service
// ============================================

export const adminService = {
  /**
   * Get the current server health status, including uptime and version info.
   */
  getStatus(): Promise<ServerStatus> {
    return api.get<ServerStatus>('/health');
  },

  /**
   * Get all currently active streaming sessions.
   */
  getActiveSessions(): Promise<StreamSession[]> {
    return api.get<StreamSession[]>('/stream/sessions');
  },

  /**
   * Trigger a library scan to discover new or changed media files.
   */
  triggerScan(): Promise<void> {
    return api.post<void>('/sources/scan');
  },

  /**
   * Refresh metadata for all movies in the library.
   */
  refreshAllMetadata(): Promise<void> {
    return api.post<void>('/movies/refresh-all');
  },

  /**
   * Get all registered users.
   */
  getUsers(): Promise<User[]> {
    return api.get<User[]>('/users');
  },
};
