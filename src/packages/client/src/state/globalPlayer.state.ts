import { computed, effect, signal } from '@preact/signals';
import { route } from 'preact-router';
import { moviesService } from '@/services/movies.service';
import { streamService } from '@/services/stream.service';
import {
	closeEffectsPanel,
	fetchProfiles,
	loadCompProfile,
	loadEqProfile,
	profiles,
} from '@/state/audio-effects.state';
import { pushToHistory } from '@/state/history.state';
import type { Movie } from '@/state/library.state';
import { notifyError } from '@/state/notifications.state';
import type { StreamSession } from '@/state/player.state';
import {
	currentSession,
	currentTime,
	endStream,
	initPlayerSettings,
	isMuted,
	isPlaying,
	startStream,
	streamError,
	volume,
} from '@/state/player.state';
import { sharedVideoEngine } from '@/state/videoEngineRef';

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
	isPlaying: boolean;
	/** Persisted session data so we can resume without creating a new server session. */
	session?: StreamSession | null;
}

const STORAGE_KEY = 'mu_player_state';

// ============================================
// Signals
// ============================================

export const globalMovieId = signal<string | null>(null);
export const globalMovie = signal<Movie | null>(null);
export const playerMode = signal<PlayerMode>('hidden');

/**
 * Set during initGlobalPlayer when restoring from localStorage.
 * Tells GlobalPlayer whether to auto-play after loading the restored session.
 * null means "no restore in progress — use default behavior (auto-play)".
 */
export const restoredAutoplay = signal<boolean | null>(null);

/**
 * When set to a number, overrides the server-provided startPosition on the next stream init.
 * Consumed (reset to null) by GlobalPlayer after applying.
 */
export const forceStartPosition = signal<number | null>(null);

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
			isPlaying: isPlaying.value,
			session: currentSession.value,
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
export async function playMovie(
	movieId: string,
	opts?: { fromBeginning?: boolean },
): Promise<void> {
	initPlayerSettings();
	closeEffectsPanel();

	if (opts?.fromBeginning) {
		forceStartPosition.value = 0;
	}

	const wasMini = playerMode.value === 'mini';

	// Already loaded this movie - ensure it's playing
	if (globalMovieId.value === movieId && currentSession.value) {
		if (!wasMini) {
			playerMode.value = 'full';
			route(`/player/${movieId}`);
		}
		const engine = sharedVideoEngine.value;
		if (engine) {
			engine.setIntendedPlaying(true);
			const video = engine.videoRef.current;
			if (opts?.fromBeginning && video) {
				video.currentTime = 0;
			}
			if (video?.paused) video.play().catch(() => {});
		}
		// Update history cache for the re-played movie
		const movie = globalMovie.value;
		if (movie) {
			pushToHistory(movie);
		}
		return;
	}

	// Playing a different movie - stop old stream
	if (globalMovieId.value && currentSession.value) {
		await endStream();
	}

	// Set up new movie — keep mini mode if already minimized
	globalMovieId.value = movieId;
	if (!wasMini) {
		playerMode.value = 'full';
	}

	// Fetch movie data (non-blocking for UI)
	moviesService
		.get(movieId)
		.then((m) => {
			globalMovie.value = m;
			// Push to history cache as soon as we have the movie metadata
			pushToHistory(m);
			// Apply movie-specific play settings (EQ/compressor profiles, volume)
			applyPlaySettings(m);
		})
		.catch(() => {
			globalMovie.value = null;
		});

	// Only navigate to player page if not in mini mode
	if (!wasMini) {
		route(`/player/${movieId}`);
	}
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

	streamError.value = null;

	try {
		const session = await startStream(movieId);
		return session;
	} catch (err: any) {
		console.error('Failed to start global stream:', err);
		const message = err?.body?.message || err?.message || 'Failed to start playback';
		streamError.value = message;
		return null;
	}
}

/**
 * Apply movie-specific play settings (EQ/compressor profiles).
 * Called after movie metadata is fetched during playMovie().
 */
async function applyPlaySettings(movie: Movie): Promise<void> {
	const settings = movie.playSettings;
	if (!settings) return;

	const { eqProfileId, compressorProfileId } = settings;
	if (!eqProfileId && !compressorProfileId) return;

	// Ensure profiles are loaded
	if (profiles.value.length === 0) {
		await fetchProfiles();
	}

	if (eqProfileId) {
		const found = profiles.value.find((p) => p.id === eqProfileId);
		if (found) {
			loadEqProfile(eqProfileId);
		} else {
			notifyError(`EQ profile no longer exists and will be removed from play settings.`);
			moviesService
				.update(movie.id, {
					playSettings: JSON.stringify({ eqProfileId: null }),
				})
				.catch(() => {});
		}
	}

	if (compressorProfileId) {
		const found = profiles.value.find((p) => p.id === compressorProfileId);
		if (found) {
			loadCompProfile(compressorProfileId);
		} else {
			notifyError(
				`Compressor profile no longer exists and will be removed from play settings.`,
			);
			moviesService
				.update(movie.id, {
					playSettings: JSON.stringify({ compressorProfileId: null }),
				})
				.catch(() => {});
		}
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
		moviesService
			.get(saved.movieId)
			.then((m) => {
				globalMovie.value = m;
			})
			.catch(() => {
				playerMode.value = 'hidden';
				globalMovieId.value = null;
				localStorage.removeItem(STORAGE_KEY);
			});

		// Tell GlobalPlayer whether to auto-play after restoring
		restoredAutoplay.value = saved.isPlaying ?? false;

		// Restore session — verify it's still valid on the server
		if (saved.session?.sessionId) {
			const session = { ...saved.session, startPosition: saved.currentTime };
			// Optimistically restore so GlobalPlayer doesn't create a new session
			currentSession.value = session;

			// Verify the session is still alive by pinging updateProgress.
			// If the server returns 404, the session was ended — create a new one.
			streamService.updateProgress(session.sessionId, saved.currentTime).catch(() => {
				// Session no longer exists on server — clear it so GlobalPlayer
				// creates a fresh one on its next effect cycle.
				console.warn('[GlobalPlayer] Persisted session expired, will create new one');
				currentSession.value = null;
			});
		}
	} catch {
		localStorage.removeItem(STORAGE_KEY);
	}
}
