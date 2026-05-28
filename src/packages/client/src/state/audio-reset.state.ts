/**
 * Audio-output recovery state.
 *
 * Chrome's AudioContext can land in a "stuck sink" state where the graph
 * renders correctly (currentTime advances, compressor sees signal) but no
 * samples reach the speakers. The fix from JS is to (a) close the
 * AudioContext and (b) swap the `<video>` element — `createMediaElementSource`
 * permanently re-routes the element, and there's no API to un-bind. A
 * fresh `<video>` lets `attach()` rebind to a (hopefully) healthy sink.
 *
 * This module is the cross-cutting bus between:
 *   - audio-engine.ts (flips `audioOutputSuspect` on heuristic detection)
 *   - useVideoEngine.ts (watches `audioResetTrigger` and runs the swap)
 *   - EffectsPanel.tsx / audio-effects.state.ts (call `requestAudioReset()`)
 */

import { signal } from '@preact/signals';

export interface AudioSuspectState {
	suspect: boolean;
	/** Short reason — surfaced in the toast for debugging. */
	reason: string | null;
}

export const audioOutputSuspect = signal<AudioSuspectState>({
	suspect: false,
	reason: null,
});

/**
 * True when the user has EQ/Compressor enabled but the active stream is
 * HLS-backed (a `blob:` MediaSource src). Chrome silences
 * `createMediaElementSource` output on MediaSource-fed elements — there
 * is no JS workaround — so the engine refuses to attach and audio stays
 * on the native (working) path. This flag lets the UI explain why the
 * effects aren't applying. Cleared when a non-HLS (direct-play) stream
 * attaches successfully.
 */
export const audioEffectsHlsBlocked = signal(false);

/**
 * Monotonic counter. Bumped by `requestAudioReset()`. `useVideoEngine`
 * subscribes via a useEffect on this signal — every increment triggers
 * one swap-and-restore cycle on the singleton video element.
 */
export const audioResetTrigger = signal(0);

export function markAudioSuspect(reason: string): void {
	const cur = audioOutputSuspect.value;
	if (cur.suspect && cur.reason === reason) return;
	audioOutputSuspect.value = { suspect: true, reason };
}

export function clearAudioSuspect(): void {
	if (!audioOutputSuspect.value.suspect) return;
	audioOutputSuspect.value = { suspect: false, reason: null };
}

export function requestAudioReset(): void {
	audioResetTrigger.value = audioResetTrigger.value + 1;
}
