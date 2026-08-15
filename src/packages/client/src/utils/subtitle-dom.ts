/**
 * Hard-teardown of every subtitle artefact attached to the player's <video>.
 *
 * Removing the `<track>` children alone is NOT enough: HLS.js (and in-band
 * CEA-608/WebVTT playlists) register TextTracks *programmatically*, so they
 * have no DOM element to remove. Those tracks keep their cues — and the browser
 * keeps painting the active one — which is how a previous movie's subtitles
 * stay "locked" on screen after switching movies.
 *
 * So we do all three: revoke + remove the elements, force every TextTrack to
 * `disabled` (stops cue processing entirely, unlike `hidden`), and drop any
 * cues still attached to tracks we can't remove.
 */
export function clearVideoSubtitles(video: HTMLVideoElement | null | undefined): void {
	if (!video) return;

	// 1. Remove <track> elements + free their blob URLs.
	for (const el of Array.from(video.querySelectorAll('track'))) {
		if (el.src?.startsWith('blob:')) {
			try {
				URL.revokeObjectURL(el.src);
			} catch {}
		}
		try {
			el.track.mode = 'disabled';
		} catch {}
		el.remove();
	}

	// 2. Disable + empty whatever TextTracks remain (HLS-added ones survive
	//    step 1 because they were never DOM children).
	const tracks = video.textTracks;
	for (let i = 0; i < tracks.length; i++) {
		const tt = tracks[i];
		if (!tt) continue;
		try {
			tt.mode = 'disabled';
		} catch {}
		const cues = tt.cues;
		if (!cues) continue;
		for (let c = cues.length - 1; c >= 0; c--) {
			const cue = cues[c];
			if (!cue) continue;
			try {
				tt.removeCue(cue);
			} catch {}
		}
	}
}
