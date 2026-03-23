import { signal } from '@preact/signals';
import { api } from '@/services/api';
import { wsService } from '@/services/websocket.service';

/** Set of movie IDs currently being processed (pre-transcode) */
export const processingMovieIds = signal<Set<string>>(new Set());

/** Per-movie transcode progress (0-100). Only set for actively running jobs. */
export const processingProgress = signal<Map<string, number>>(new Map());

/** Check if a movie is currently processing */
export function isMovieProcessing(movieId: string): boolean {
	return processingMovieIds.value.has(movieId);
}

/** Get transcode progress for a movie (0-100 or undefined) */
export function getMovieProgress(movieId: string): number | undefined {
	return processingProgress.value.get(movieId);
}

/** Fetch processing movie IDs from the server */
export async function fetchProcessingMovies(): Promise<void> {
	try {
		const { movieIds } = await api.get<{ movieIds: string[] }>('/jobs/processing-movies');
		processingMovieIds.value = new Set(movieIds);
	} catch {
		// Silently fail — non-critical
	}
}

/** Initialize processing state: fetch + subscribe to WebSocket events */
export function initProcessingState(): void {
	fetchProcessingMovies();

	// When a pre-transcode job starts, add the movieId
	wsService.on('job:started', (data: unknown) => {
		const ev = data as { type?: string; payload?: { movieId?: string } };
		if (ev.type === 'pre-transcode' && ev.payload?.movieId) {
			const next = new Set(processingMovieIds.value);
			next.add(ev.payload.movieId);
			processingMovieIds.value = next;
		}
	});

	// Track progress per movie
	wsService.on('job:progress', (data: unknown) => {
		const ev = data as {
			type?: string;
			payload?: { movieId?: string };
			progress?: number;
		};
		if (ev.type === 'pre-transcode' && ev.payload?.movieId && ev.progress != null) {
			const next = new Map(processingProgress.value);
			next.set(ev.payload.movieId, Math.round(ev.progress));
			processingProgress.value = next;
		}
	});

	// When a pre-transcode job completes or fails, remove the movieId and progress
	const handleDone = (data: unknown) => {
		const ev = data as { type?: string; payload?: { movieId?: string } };
		if (ev.type === 'pre-transcode' && ev.payload?.movieId) {
			const nextProgress = new Map(processingProgress.value);
			nextProgress.delete(ev.payload.movieId);
			processingProgress.value = nextProgress;
			// Re-fetch to get accurate state (there might be other jobs for the same movie)
			fetchProcessingMovies();
		}
	};
	wsService.on('job:completed', handleDone);
	wsService.on('job:failed', handleDone);
}
