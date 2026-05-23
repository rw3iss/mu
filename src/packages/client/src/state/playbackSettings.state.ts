import { signal } from '@preact/signals';
import { api } from '@/services/api';

export interface PlaybackSettings {
	/** Minimum cumulative watch seconds before a position is recorded. */
	watchedThresholdSeconds: number;
	/**
	 * Tail tolerance: once playback is within this many seconds of a
	 * movie's runtime, the server treats it as "watched in full" and
	 * deletes the history row. The client UI also hides the resume bar
	 * for any cached row that's already inside this window — defense
	 * in depth in case a stale row leaks through.
	 */
	completedTailSeconds: number;
}

const DEFAULTS: PlaybackSettings = {
	watchedThresholdSeconds: 30,
	completedTailSeconds: 300,
};

export const playbackSettings = signal<PlaybackSettings>(DEFAULTS);

let inFlight: Promise<void> | null = null;

/**
 * Fetch the server's current playback settings into the signal.
 * Cheap (one row read per setting). Called once on app init and
 * after a settings save so the UI gate matches the server immediately.
 */
export async function fetchPlaybackSettings(): Promise<void> {
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const data = await api.get<PlaybackSettings>('/settings/playback');
			playbackSettings.value = {
				watchedThresholdSeconds:
					typeof data.watchedThresholdSeconds === 'number'
						? data.watchedThresholdSeconds
						: DEFAULTS.watchedThresholdSeconds,
				completedTailSeconds:
					typeof data.completedTailSeconds === 'number'
						? data.completedTailSeconds
						: DEFAULTS.completedTailSeconds,
			};
		} catch {
			// Keep defaults — non-fatal.
		}
	})();
	try {
		await inFlight;
	} finally {
		inFlight = null;
	}
}
