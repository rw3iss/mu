import { signal } from '@preact/signals';

/**
 * True once the user has actually interacted with the page (pointer,
 * keyboard, or touch). Used to gate work that creates an
 * `AudioContext` — Chrome rejects context.resume() without a credited
 * user gesture, and once a `MediaElementSource` is bound to a video
 * element it cannot be un-bound, so we must NOT call audioEngine
 * attach()/setEqEnabled/setCompressorEnabled at page-load time when
 * restoring persisted preferences.
 */
export const hasUserGestured = signal<boolean>(false);

let installed = false;
const waiters: Array<() => void> = [];

export function installUserGestureListener(): void {
	if (installed || typeof document === 'undefined') return;
	installed = true;
	const handler = () => {
		if (hasUserGestured.value) return;
		hasUserGestured.value = true;
		document.removeEventListener('pointerdown', handler, { capture: true });
		document.removeEventListener('keydown', handler, { capture: true });
		document.removeEventListener('touchstart', handler, { capture: true });
		// Drain waiters synchronously so the resume() inside the
		// audio-engine attach() still sees us inside the same gesture
		// frame (Chrome only credits the gesture for a single task).
		const queue = waiters.splice(0, waiters.length);
		for (const fn of queue) {
			try {
				fn();
			} catch {}
		}
	};
	document.addEventListener('pointerdown', handler, { capture: true });
	document.addEventListener('keydown', handler, { capture: true });
	document.addEventListener('touchstart', handler, { capture: true });
}

/**
 * Run `fn` immediately if the user has already interacted, otherwise
 * queue it to run synchronously inside the next user-gesture handler
 * (BEFORE any signal effects, so `resume()` still has gesture credit).
 */
export function whenUserGestured(fn: () => void): void {
	if (hasUserGestured.value) {
		fn();
		return;
	}
	waiters.push(fn);
}
