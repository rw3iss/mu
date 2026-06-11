/**
 * Relative playback time for a pointer position over a seek bar.
 * Measures the bar's LIVE bounding rect on every call, so it stays correct
 * when the bar is resized (split-mode drag, window resize, zoom).
 */
export function timeFromPointer(
	bar: HTMLElement | null,
	clientX: number,
	durationSeconds: number,
): number | undefined {
	if (!bar) return undefined;
	const rect = bar.getBoundingClientRect();
	if (rect.width <= 0) return undefined;
	const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	return fraction * durationSeconds;
}
