import { route } from 'preact-router';

/** Open an in-app href in a new browser tab. */
export function openInNewTab(href: string): void {
	window.open(href, '_blank', 'noopener');
}

/** A click that should open a new tab: middle button, or ctrl/cmd/shift held. */
export function isNewTabClick(e: MouseEvent): boolean {
	return e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey;
}

/**
 * Handlers that add "open in a new tab" to a navigable element that ISN'T a real
 * `<a>` — e.g. cards/rows whose root is a `<div>`/`<button>` with nested
 * interactive children (play / options / favorite buttons that stopPropagation).
 *
 * Plain left-click runs `onPlain` (the element's existing SPA navigation);
 * middle-click and ctrl/cmd/shift-click open `href` in a new tab instead. Spread
 * the result onto the element. Keeping the element a `<div>` avoids the
 * "nested <button> inside <a> triggers the anchor's navigation" trap.
 */
export function newTabNav(
	href: string,
	onPlain: (e: MouseEvent) => void,
): { onClick: (e: MouseEvent) => void; onAuxClick: (e: MouseEvent) => void } {
	return {
		onClick: (e: MouseEvent) => {
			if (e.button === 0 && (e.metaKey || e.ctrlKey || e.shiftKey)) {
				e.preventDefault();
				openInNewTab(href);
				return;
			}
			onPlain(e);
		},
		onAuxClick: (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				openInNewTab(href);
			}
		},
	};
}

/**
 * onClick for a REAL `<a href>` that SPA-navigates on a plain left-click but
 * lets the browser handle middle / modifier clicks natively (background tab).
 * Optionally runs `onNavigate` instead of the default `route(href)` on plain
 * clicks (for nav that needs side effects, e.g. resetting scroll).
 */
export function spaLinkClick(href: string, onNavigate?: () => void) {
	return (e: MouseEvent) => {
		if (e.defaultPrevented) return;
		// Middle button or any modifier → let the browser open a new tab.
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		if (onNavigate) onNavigate();
		else route(href);
	};
}
