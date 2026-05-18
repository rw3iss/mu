/**
 * dev-debug-panel integration.
 *
 * Mounts a singleton DebugPanel and registers it as a Sink with dev-loggers.
 * After this runs, any `debug('id', obj)` call from dev-loggers — including
 * those in `audio/audio-engine.ts` — shows up in the panel grouped by id.
 *
 * The panel is hidden by default. Toggle with **Shift+Alt+D**.
 *
 * Disabled in production builds. The gate is `import.meta.env.DEV` (Vite),
 * which evaluates true during `vite dev` and false in `vite build`. The
 * panel imports an ~8 KB stylesheet — keeping it dev-only avoids shipping
 * an overlay in production bundles.
 */

import * as loggers from 'dev-loggers';

let mounted = false;

export function initDebugPanel(): void {
	if (mounted) return;
	if (typeof window === 'undefined') return;
	if (!(import.meta as { env?: { DEV?: boolean } }).env?.DEV) return;

	// Dynamic import so the panel + its SCSS payload don't enter the prod
	// bundle. Vite tree-shakes the whole branch when DEV is false.
	import('dev-debug-panel')
		.then(({ DebugPanel, ScreenPosition }) => {
			if (mounted) return;
			mounted = true;
			new DebugPanel({
				loggers,
				position: ScreenPosition.BottomRight,
				snap: true,
				width: 640,
				height: 420,
				// shortcut defaults to 'shift+alt+d'
			});
			// One first-load breadcrumb so the panel is non-empty when the user opens it.
			loggers.debug('app:boot', { ts: new Date().toISOString() });
		})
		.catch((err) => {
			console.warn('[debug-panel] failed to load:', err);
		});
}
