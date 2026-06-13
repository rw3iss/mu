import { useEffect, useRef, useState } from 'preact/hooks';

export interface MenuPosition {
	/** Fixed-position top (px) when the menu drops DOWN from the trigger. */
	top?: number;
	/** Fixed-position bottom (px) when the menu flips UP (trigger near viewport bottom). */
	bottom?: number;
	/** Fixed-position right inset (px) — aligns the menu's right edge to the trigger. */
	right: number;
	/** Cap so a very tall menu fits the viewport (and scrolls internally). */
	maxHeight?: number;
}

const MARGIN = 8;

/**
 * Open / close state for a pop-out menu (the three-dot options menu on a card).
 *
 * The dropdown is rendered through a portal to `document.body` and positioned
 * with `position: fixed` from `pos`, so it can never be clipped by a card's
 * `overflow: hidden`. Plumbing handled here:
 *
 *  1. `pos` — measured from the trigger (`ref`) on open. The menu drops DOWN by
 *     default; if it would overflow the bottom of the viewport (bottom row of
 *     cards, short windows) it FLIPS UP to anchor above the trigger. Measured
 *     after the menu renders so it accounts for the real menu height.
 *  2. Outside-click closes the menu — counting BOTH the trigger and the portaled
 *     menu as "inside".
 *  3. Scroll / resize closes the menu.
 *
 * Attach `ref` to the trigger's container and `menuRef` to the portaled menu.
 */
export function useMenuOpen() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<MenuPosition | null>(null);

	useEffect(() => {
		if (!open) {
			setPos(null);
			return;
		}

		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const right = Math.max(MARGIN, window.innerWidth - r.right);

		// Initial guess: drop down just below the trigger.
		setPos({ top: r.bottom + 4, right });

		// After the menu paints, measure its real height and flip up if the
		// down-variant would run off the bottom of the screen.
		const raf = requestAnimationFrame(() => {
			const menu = menuRef.current;
			if (!menu) return;
			const h = menu.offsetHeight;
			const spaceBelow = window.innerHeight - r.bottom - 4 - MARGIN;
			const spaceAbove = r.top - 4 - MARGIN;
			if (h > spaceBelow && spaceAbove > spaceBelow) {
				// Flip up — anchor the menu's bottom just above the trigger.
				setPos({
					bottom: window.innerHeight - r.top + 4,
					right,
					maxHeight: Math.max(120, spaceAbove),
				});
			} else if (h > spaceBelow) {
				// Not enough room either way — keep it below but cap + scroll.
				setPos({ top: r.bottom + 4, right, maxHeight: Math.max(120, spaceBelow) });
			}
		});

		const onMouseDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
			setOpen(false);
		};
		const dismiss = () => setOpen(false);

		document.addEventListener('mousedown', onMouseDown);
		window.addEventListener('resize', dismiss);
		// capture-phase so it fires for scrolls inside any ancestor too.
		window.addEventListener('scroll', dismiss, true);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('resize', dismiss);
			window.removeEventListener('scroll', dismiss, true);
		};
	}, [open]);

	return { open, setOpen, ref, menuRef, pos };
}
