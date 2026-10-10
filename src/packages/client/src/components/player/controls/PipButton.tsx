import { useCallback, useEffect, useState } from 'preact/hooks';
import { notifyError } from '@/state/notifications.state';
import { getLastPipError, isPipActive, isPipSupported, togglePictureInPicture } from '@/utils/pip';
import styles from '../PlayerControls.module.scss';
import { getActiveVideoElement } from '../useVideoEngine';

/**
 * Picture-in-Picture — rendered only where a PiP API exists (Chrome/Edge
 * desktop, Safari incl. iOS). Chrome for Android has no Web PiP API;
 * `mu.pip()` explains the situation there.
 */
export function PipButton() {
	// --- Picture-in-Picture -------------------------------------------------
	// Support is read from the live <video>, so the button only renders where a
	// PiP API actually exists. Chrome for Android has none today; the attempt
	// still runs there (diagnose with `mu.pip()`), so this lights up on its own
	// if/when the API ships.
	const [pipActive, setPipActive] = useState(false);
	const pipSupported = isPipSupported(getActiveVideoElement());

	useEffect(() => {
		const v = getActiveVideoElement();
		if (!v) return;
		const sync = () => setPipActive(isPipActive(v));
		v.addEventListener('enterpictureinpicture', sync);
		v.addEventListener('leavepictureinpicture', sync);
		// Safari signals PiP through presentation-mode changes instead.
		v.addEventListener('webkitpresentationmodechanged', sync);
		sync();
		return () => {
			v.removeEventListener('enterpictureinpicture', sync);
			v.removeEventListener('leavepictureinpicture', sync);
			v.removeEventListener('webkitpresentationmodechanged', sync);
		};
	}, []);

	const handleTogglePip = useCallback(async (e: MouseEvent) => {
		e.stopPropagation();
		const ok = await togglePictureInPicture(getActiveVideoElement());
		setPipActive(ok);
		if (!ok) {
			const reason = getLastPipError();
			if (reason) {
				console.warn('[Mu][PiP]', reason, '— run mu.pip() for full diagnostics.');
				notifyError('Picture-in-picture is not available in this browser.');
			}
		}
	}, []);

	if (!pipSupported) return null;
	return (
		<button
			class={styles.controlBtn}
			onClick={handleTogglePip}
			aria-label={pipActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}
			title={pipActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="white"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<rect x="2" y="4" width="20" height="16" rx="2" />
				<rect x="12" y="12" width="8" height="6" rx="1" fill="white" />
			</svg>
		</button>
	);
}
