import { signal } from '@preact/signals';
import { api } from '@/services/api';
import { wsService } from '@/services/websocket.service';

/** Set of movie IDs currently being processed (pre-transcode) */
export const processingMovieIds = signal<Set<string>>(new Set());

/** Check if a movie is currently processing */
export function isMovieProcessing(movieId: string): boolean {
	return processingMovieIds.value.has(movieId);
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

	// When a pre-transcode job completes or fails, remove the movieId
	// (only if no other jobs remain for that movie)
	const handleDone = (data: unknown) => {
		const ev = data as { type?: string; payload?: { movieId?: string } };
		if (ev.type === 'pre-transcode' && ev.payload?.movieId) {
			// Re-fetch to get accurate state (there might be other jobs for the same movie)
			fetchProcessingMovies();
		}
	};
	wsService.on('job:completed', handleDone);
	wsService.on('job:failed', handleDone);
}
