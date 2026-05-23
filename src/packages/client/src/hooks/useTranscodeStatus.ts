import { useEffect } from 'preact/hooks';
import { api } from '@/services/api';
import {
	getMovieProgress,
	isMovieProcessing,
	processingMovieIds,
	processingProgress,
} from '@/state/processing.state';

export interface TranscodeStatus {
	/** True when any pre-transcode job is running for this movie. */
	isProcessing: boolean;
	/**
	 * Percent complete (0–100). Undefined while we haven't received a
	 * `job:progress` event yet (typical right after start) — callers
	 * usually render "Processing…" without a percentage in that case.
	 */
	progress: number | undefined;
}

const POLL_INTERVAL_MS = 5000;

/**
 * Reactive view of the global transcode queue scoped to one movie.
 *
 * Primary path: WebSocket events from `processing.state.ts` keep the
 * global signals fresh — most updates arrive within a frame of the
 * server emitting `job:progress`.
 *
 * Backup path: while a movie is processing AND mounted in the UI,
 * poll the job endpoint every 5s to recover if the WS drops. The
 * poll is per-movie because progress polls take a movieId; the set
 * of processing-movie-ids is already refreshed centrally via WS
 * `job:completed`/`job:failed` hooks plus a top-level `fetchProcessingMovies`.
 *
 * Auto-stops as soon as the movie is no longer processing, so an
 * idle library page doesn't hammer the server.
 */
export function useTranscodeStatus(movieId: string | null | undefined): TranscodeStatus {
	// Read both signals during render so Preact subscribes the caller.
	const ids = processingMovieIds.value;
	const progressMap = processingProgress.value;

	const isProcessing = !!movieId && ids.has(movieId);
	const progress = movieId ? progressMap.get(movieId) : undefined;

	useEffect(() => {
		if (!movieId || !isProcessing) return;
		let cancelled = false;

		const pull = async () => {
			try {
				const data = await api.get<{ progress?: number; running?: boolean }>(
					`/jobs/movies/${encodeURIComponent(movieId)}/transcode-status`,
				);
				if (cancelled) return;
				if (typeof data.progress === 'number') {
					const next = new Map(processingProgress.value);
					next.set(movieId, Math.round(data.progress));
					processingProgress.value = next;
				}
				// Server says no longer running — sync the set so the UI
				// drops the processing badge even if the WS event was lost.
				if (data.running === false && processingMovieIds.value.has(movieId)) {
					const ids = new Set(processingMovieIds.value);
					ids.delete(movieId);
					processingMovieIds.value = ids;
					const nextP = new Map(processingProgress.value);
					nextP.delete(movieId);
					processingProgress.value = nextP;
				}
			} catch {
				// Endpoint may not exist on older deploys; WS will keep us
				// honest in that case.
			}
		};

		const timer = window.setInterval(pull, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [movieId, isProcessing]);

	return { isProcessing, progress };
}

/** Non-reactive read of the same state — handy in event handlers. */
export function readTranscodeStatus(movieId: string): TranscodeStatus {
	return {
		isProcessing: isMovieProcessing(movieId),
		progress: getMovieProgress(movieId),
	};
}
