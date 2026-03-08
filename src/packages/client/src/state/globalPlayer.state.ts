import { signal, computed, effect } from '@preact/signals';
import { route } from 'preact-router';
import {
  currentSession,
  startStream,
  endStream,
  initPlayerSettings,
  currentTime,
  volume,
  isMuted,
  isPlaying,
  duration,
} from '@/state/player.state';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import type { StreamSession } from '@/state/player.state';

// ============================================
// Types
// ============================================

export type PlayerMode = 'hidden' | 'full' | 'mini';

interface PersistedPlayerState {
  movieId: string;
  currentTime: number;
  volume: number;
  isMuted: boolean;
  playerMode: PlayerMode;
}

const STORAGE_KEY = 'mu_player_state';

// ============================================
// Signals
// ============================================

export const globalMovieId = signal<string | null>(null);
export const globalMovie = signal<Movie | null>(null);
export const playerMode = signal<PlayerMode>('hidden');

// Computed
export const isPlayerActive = computed(() => playerMode.value !== 'hidden');

// ============================================
// Persistence
// ============================================

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveState(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!globalMovieId.value) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const state: PersistedPlayerState = {
      movieId: globalMovieId.value,
      currentTime: currentTime.value,
      volume: volume.value,
      isMuted: isMuted.value,
      playerMode: playerMode.value,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable
    }
  }, 1000);
}

let disposeEffects: (() => void) | null = null;

function setupPersistenceEffects(): void {
  if (disposeEffects) return;
  const dispose1 = effect(() => {
    void currentTime.value;
    void volume.value;
    void isMuted.value;
    void playerMode.value;
    void globalMovieId.value;
    saveState();
  });
  disposeEffects = dispose1;
}

// ============================================
// Actions
// ============================================

/**
 * Start playing a movie. Handles stream setup and routing.
 * If already playing this movie, just switches to full mode.
 * If playing a different movie, stops old stream first.
 */
export async function playMovie(movieId: string): Promise<void> {
  initPlayerSettings();

  // Already playing this movie - just maximize
  if (globalMovieId.value === movieId && currentSession.value) {
    playerMode.value = 'full';
    route(`/player/${movieId}`, true);
    return;
  }

  // Playing a different movie - stop old stream
  if (globalMovieId.value && currentSession.value) {
    await endStream();
  }

  // Set up new movie
  globalMovieId.value = movieId;
  playerMode.value = 'full';

  // Fetch movie data (non-blocking for UI)
  moviesService.get(movieId)
    .then((m) => { globalMovie.value = m; })
    .catch(() => { globalMovie.value = null; });

  // Route to player page
  route(`/player/${movieId}`, true);
}

/**
 * Minimize: shrink to mini-player bar, navigate away from player page.
 */
export function minimizePlayer(): void {
  if (!globalMovieId.value) return;
  playerMode.value = 'mini';
  const movieId = globalMovieId.value;
  route(`/movie/${movieId}`);
}

/**
 * Maximize: go back to full player page.
 */
export function maximizePlayer(): void {
  if (!globalMovieId.value) return;
  playerMode.value = 'full';
  route(`/player/${globalMovieId.value}`, true);
}

/**
 * Close: end stream, hide player entirely.
 */
export async function closePlayer(): Promise<void> {
  const movieId = globalMovieId.value;
  playerMode.value = 'hidden';
  globalMovieId.value = null;
  globalMovie.value = null;

  await endStream();
  localStorage.removeItem(STORAGE_KEY);

  // If on player page, navigate away
  if (movieId && window.location.pathname.startsWith('/player/')) {
    route(`/movie/${movieId}`);
  }
}

/**
 * Start a stream for the current globalMovieId.
 * Called by the GlobalPlayer component when it needs to initialize.
 */
export async function startGlobalStream(): Promise<StreamSession | null> {
  const movieId = globalMovieId.value;
  if (!movieId) return null;

  try {
    const session = await startStream(movieId);
    return session;
  } catch (err) {
    console.error('Failed to start global stream:', err);
    playerMode.value = 'hidden';
    globalMovieId.value = null;
    return null;
  }
}

/**
 * Initialize global player on app load.
 * Restores persisted state if available.
 */
export function initGlobalPlayer(): void {
  setupPersistenceEffects();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const saved: PersistedPlayerState = JSON.parse(raw);
    if (!saved.movieId) return;

    // Restore volume/mute
    volume.value = saved.volume;
    isMuted.value = saved.isMuted;

    // Restore movie and mode
    globalMovieId.value = saved.movieId;
    // Always restore to mini mode
    playerMode.value = 'mini';

    // Fetch movie metadata
    moviesService.get(saved.movieId)
      .then((m) => { globalMovie.value = m; })
      .catch(() => {
        playerMode.value = 'hidden';
        globalMovieId.value = null;
        localStorage.removeItem(STORAGE_KEY);
      });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}
