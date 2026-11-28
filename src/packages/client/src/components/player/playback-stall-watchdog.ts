/**
 * Detects a playing media element whose clock does not move although data is
 * buffered ahead. That is the signature of a dead audio output: Chrome drives
 * the playback clock from the audio sink, so a sink that accepts the stream
 * but never pulls samples (e.g. a USB DAC that failed to start at its rate)
 * freezes the video at 00:00 on a black frame, with no error event.
 *
 * Calls `onStall` once, after `stallMs` of frozen time, then stops. Returns a
 * stop function. Stops by itself when the element leaves the DOM or loses its
 * source.
 */
export function watchPlaybackStall(
	video: HTMLMediaElement,
	onStall: () => void,
	stallMs = 4000,
): () => void {
	const TICK_MS = 1000;
	let last = video.currentTime;
	let frozenMs = 0;

	const bufferedAhead = (): number => {
		const t = video.currentTime;
		for (let i = 0; i < video.buffered.length; i++) {
			if (video.buffered.start(i) <= t + 0.1 && video.buffered.end(i) > t) {
				return video.buffered.end(i) - t;
			}
		}
		return 0;
	};

	const id = window.setInterval(() => {
		if (!video.isConnected || !video.currentSrc) {
			stop();
			return;
		}
		const t = video.currentTime;
		const shouldAdvance =
			!video.paused &&
			!video.seeking &&
			!video.ended &&
			video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
			bufferedAhead() >= 1;
		if (!shouldAdvance || t !== last) {
			last = t;
			frozenMs = 0;
			return;
		}
		frozenMs += TICK_MS;
		if (frozenMs >= stallMs) {
			stop();
			onStall();
		}
	}, TICK_MS);

	function stop(): void {
		window.clearInterval(id);
	}
	return stop;
}
