/**
 * dev-debug-panel integration.
 *
 * Mounts a singleton DebugPanel and registers it as a Sink with dev-loggers.
 * After this runs, any `debug('id', obj)` call from dev-loggers — including
 * those in `audio/audio-engine.ts` — shows up in the panel grouped by id.
 *
 * Toggle with **Shift+Alt+D** OR **Ctrl+Alt+D**. The second binding is
 * a fallback while we're verifying the panel renders correctly in prod.
 *
 * NOT gated on `import.meta.env.DEV` — the panel is intentionally
 * available in production so we can diagnose issues that only repro on
 * the live build. The dynamic import + the ~8 KB stylesheet payload
 * are loaded once on app boot; the toggle itself is free after that.
 */

import * as loggers from 'dev-loggers';

let mounted = false;
let panelRef: { toggle?: () => void; show?: () => void; hide?: () => void } | null = null;

export function initDebugPanel(): void {
	if (mounted) return;
	if (typeof window === 'undefined') return;

	import('dev-debug-panel')
		.then((mod) => {
			if (mounted) return;
			mounted = true;

			const { DebugPanel, ScreenPosition } = mod;

			const panel = new DebugPanel({
				loggers,
				position: ScreenPosition?.BottomRight ?? 'bottom-right',
				snap: true,
				width: 720,
				height: 460,
				// shortcut defaults to 'shift+alt+d' in v2; we also bind
				// Ctrl+Alt+D manually below for backwards-compat while
				// the panel's own listener gets verified in prod.
			});
			panelRef = panel as never;

			// Make sure the panel's root element renders above absolutely
			// everything else in the app — the player bar / overlays
			// otherwise cover it. The panel library may already do this,
			// but be explicit so we never have to debug it.
			const el = (panel as { element?: HTMLElement }).element;
			if (el && el.style) {
				el.style.zIndex = '2147483647';
			}

			// Manual fallback shortcut: Ctrl+Alt+D. Listen at capture
			// phase so other handlers (incl. our user-gesture listener)
			// can't swallow it.
			window.addEventListener(
				'keydown',
				(e: KeyboardEvent) => {
					if (!e.ctrlKey || !e.altKey || e.shiftKey) return;
					if (e.key !== 'd' && e.key !== 'D') return;
					e.preventDefault();
					const p = panelRef as
						| {
								toggle?: () => void;
								show?: () => void;
								hide?: () => void;
								isVisible?: () => boolean;
						  }
						| null;
					if (!p) return;
					if (typeof p.toggle === 'function') {
						p.toggle();
					} else if (typeof p.isVisible === 'function' && p.isVisible()) {
						p.hide?.();
					} else {
						p.show?.();
					}
				},
				{ capture: true },
			);

			// One first-load breadcrumb so the panel is non-empty when the user opens it.
			loggers.debug('app:boot', { ts: new Date().toISOString() });
		})
		.catch((err) => {
			console.warn('[debug-panel] failed to load:', err);
		});
}
