/**
 * Copy text to the clipboard, with a legacy fallback for insecure contexts
 * (where `navigator.clipboard` is unavailable). Resolves to whether the copy
 * is believed to have succeeded. Never throws.
 *
 * Consolidates the ad-hoc clipboard + `execCommand` fallbacks previously
 * duplicated across ShareMovieModal, FileInfoGrid, the soundtrack rows, etc.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Fall through to the legacy path below.
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		ta.style.pointerEvents = 'none';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}
