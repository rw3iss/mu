/**
 * Picture-in-Picture across the three implementations that exist, plus
 * diagnostics for the ones that don't.
 *
 *   - **Standard** (`video.requestPictureInPicture`) — Chrome/Edge desktop.
 *   - **WebKit** (`webkitSetPresentationMode`) — Safari desktop, iPadOS, and
 *     iPhone since iOS 14. Works from an installed PWA.
 *   - **Chrome on Android** — does NOT implement the Web PiP API. Android's
 *     system PiP is driven by the browser itself when you background it during
 *     *fullscreen* playback; there's no JS entry point. We still *attempt* the
 *     call so we automatically light up if/when Chrome ships it, and record why
 *     it failed so `mu.pip()` can explain the situation.
 *
 * Everything here fails soft: an unsupported browser gets a disabled button,
 * never a thrown error.
 */

type WebkitVideo = HTMLVideoElement & {
	webkitSupportsPresentationMode?: (mode: string) => boolean;
	webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void;
	webkitPresentationMode?: string;
};

type PipDoc = Document & {
	pictureInPictureEnabled?: boolean;
	pictureInPictureElement?: Element | null;
	exitPictureInPicture?: () => Promise<void>;
};

/** Last failure reason, surfaced by `mu.pip()` for on-device diagnosis. */
let lastError: string | null = null;

export function getLastPipError(): string | null {
	return lastError;
}

/** True when this browser exposes the standard Web PiP API for video. */
export function hasStandardPip(video?: HTMLVideoElement | null): boolean {
	const doc = document as PipDoc;
	return (
		typeof (video as HTMLVideoElement | undefined)?.requestPictureInPicture === 'function' &&
		doc.pictureInPictureEnabled !== false
	);
}

/** True when this is a WebKit browser with the presentation-mode API. */
export function hasWebkitPip(video?: HTMLVideoElement | null): boolean {
	const v = video as WebkitVideo | null | undefined;
	return (
		typeof v?.webkitSetPresentationMode === 'function' &&
		(v.webkitSupportsPresentationMode?.('picture-in-picture') ?? true)
	);
}

/** Whether a PiP button should be offered at all. */
export function isPipSupported(video?: HTMLVideoElement | null): boolean {
	return hasStandardPip(video) || hasWebkitPip(video);
}

/** Whether a video is currently floating. */
export function isPipActive(video?: HTMLVideoElement | null): boolean {
	const doc = document as PipDoc;
	if (doc.pictureInPictureElement && doc.pictureInPictureElement === video) return true;
	return (video as WebkitVideo | null)?.webkitPresentationMode === 'picture-in-picture';
}

/**
 * Enter or leave PiP. Resolves true when the video ended up floating.
 * Never throws — the reason for any failure is kept for `mu.pip()`.
 */
export async function togglePictureInPicture(
	video: HTMLVideoElement | null | undefined,
): Promise<boolean> {
	lastError = null;
	if (!video) {
		lastError = 'No video element is mounted (nothing is playing).';
		return false;
	}

	const doc = document as PipDoc;

	// Already floating → come back inline.
	if (isPipActive(video)) {
		try {
			if (doc.pictureInPictureElement === video && doc.exitPictureInPicture) {
				await doc.exitPictureInPicture();
			} else {
				(video as WebkitVideo).webkitSetPresentationMode?.('inline');
			}
		} catch (err) {
			lastError = `Could not leave PiP: ${describe(err)}`;
		}
		return false;
	}

	// WebKit first — on iOS this is the ONLY implementation, and Safari also
	// exposes it on desktop where it behaves better with native HLS.
	if (hasWebkitPip(video)) {
		try {
			(video as WebkitVideo).webkitSetPresentationMode?.('picture-in-picture');
			return true;
		} catch (err) {
			lastError = `WebKit PiP refused: ${describe(err)}`;
			return false;
		}
	}

	// Standard API. Attempted even on Chrome for Android (where it is currently
	// absent) so this starts working the moment the API lands — and so the
	// failure is recorded rather than silently swallowed.
	if (typeof video.requestPictureInPicture === 'function') {
		if (doc.pictureInPictureEnabled === false) {
			lastError =
				'The browser exposes requestPictureInPicture() but has PiP disabled ' +
				'(document.pictureInPictureEnabled === false) — often a permissions-policy ' +
				'or enterprise-policy restriction.';
			return false;
		}
		if (video.disablePictureInPicture) {
			lastError = 'The video element has disablePictureInPicture set.';
			return false;
		}
		try {
			await video.requestPictureInPicture();
			return true;
		} catch (err) {
			// NotAllowedError here almost always means "no user gesture".
			lastError = `requestPictureInPicture() rejected: ${describe(err)}`;
			return false;
		}
	}

	lastError = unsupportedReason();
	return false;
}

/** Human-readable explanation of why PiP isn't available in this browser. */
export function unsupportedReason(): string {
	const ua = navigator.userAgent;
	const isAndroid = /Android/i.test(ua);
	const isChrome = /Chrome|CriOS/i.test(ua);

	if (isAndroid && isChrome) {
		return [
			'Chrome for Android does not implement the Picture-in-Picture Web API,',
			'so a button cannot start PiP from JavaScript.',
			'Android system PiP still works, but only Chrome itself can trigger it:',
			'play the video FULLSCREEN, then swipe/home out of the app.',
			'That also requires PiP to be allowed for this app in',
			'Android Settings → Apps → (Chrome or Mu) → Picture-in-picture.',
		].join(' ');
	}
	return 'This browser does not expose a Picture-in-Picture API for video.';
}

/** Structured snapshot for `mu.pip()`. */
export function pipDiagnostics(video?: HTMLVideoElement | null) {
	const doc = document as PipDoc;
	const v = video as WebkitVideo | null | undefined;
	return {
		supported: isPipSupported(video),
		active: isPipActive(video),
		standardApi: typeof v?.requestPictureInPicture === 'function',
		webkitApi: typeof v?.webkitSetPresentationMode === 'function',
		documentPictureInPictureEnabled: doc.pictureInPictureEnabled ?? null,
		disablePictureInPictureAttr: v?.disablePictureInPicture ?? null,
		documentPipApi: typeof (window as any).documentPictureInPicture !== 'undefined',
		hasVideoElement: !!video,
		videoReadyState: v?.readyState ?? null,
		userAgent: navigator.userAgent,
		standalonePwa:
			window.matchMedia?.('(display-mode: standalone)')?.matches ??
			(navigator as any).standalone ??
			false,
		lastError,
		reasonIfUnsupported: isPipSupported(video) ? null : unsupportedReason(),
	};
}

function describe(err: unknown): string {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
}
