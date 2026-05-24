/**
 * dev-loggers/panel integration.
 *
 * Mounts the in-page debug panel from the (now-unified) `dev-loggers`
 * package. After this runs, any `debug('id', obj)` call from dev-loggers
 * — including those in `audio/audio-engine.ts` — shows up in the panel
 * grouped by id.
 *
 * Toggle with **Ctrl+Alt+D** (`Shift+Alt+D` is the library default; we
 * pick the Ctrl variant for parity with the previous binding here).
 *
 * NOT gated on `import.meta.env.DEV` — the panel is intentionally
 * available in production so we can diagnose issues that only repro on
 * the live build. The dynamic import keeps it off the critical path.
 */

import * as loggers from 'dev-loggers';

let dispose: (() => void) | null = null;

export function initDebugPanel(): void {
	if (dispose) return;
	if (typeof window === 'undefined') return;

	import('dev-loggers/panel')
		.then(({ mountDebugPanel, ScreenPosition }) => {
			if (dispose) return;
			dispose = mountDebugPanel({
				loggers,
				position: ScreenPosition.BottomRight,
				snap: true,
				shortcut: 'ctrl+alt+d',
			});

			// One first-load breadcrumb so the panel is non-empty when first opened.
			loggers.debug('app:boot', { ts: new Date().toISOString() });
		})
		.catch((err) => {
			console.warn('[debug-panel] failed to load:', err);
		});
}

/** Tear down the panel — used by HMR + tests; production never calls this. */
export function destroyDebugPanel(): void {
	dispose?.();
	dispose = null;
}
