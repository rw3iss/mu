import { useEffect, useRef } from 'preact/hooks';

/**
 * Run `callback` on every animation frame while `enabled` is true.
 *
 * The callback is held in a ref so it can read the latest closure on
 * each frame (signal values, props, etc.) without needing to be in the
 * effect's deps. Toggling `enabled` cleanly cancels the rAF and resumes
 * a fresh loop without the callback aliasing through stale closures.
 *
 * Companion to {@link useCanvasAnimator} — that hook owns the canvas
 * lifecycle (DPR, ResizeObserver, draw loop). This one is for plain
 * polling at frame rate (e.g. reading a meter value into local state
 * to drive a non-canvas visual).
 */
export function useAnimationFrame(callback: () => void, enabled: boolean): void {
	const cbRef = useRef(callback);
	cbRef.current = callback;

	useEffect(() => {
		if (!enabled) return;
		let rafId = 0;
		const tick = () => {
			cbRef.current();
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => {
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, [enabled]);
}
