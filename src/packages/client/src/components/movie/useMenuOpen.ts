import { useEffect, useRef, useState } from 'preact/hooks';

export interface MenuPosition {
	/** Fixed-position top (px) — just below the trigger. */
	top: number;
	/** Fixed-position right inset (px) — aligns the menu's right edge to the trigger. */
	right: number;
}

/**
 * Open / close state for a pop-out menu (the three-dot options menu on a card).
 *
 * The dropdown is meant to be rendered through a portal to `document.body` and
 * positioned with `position: fixed` from `pos`, so it can never be clipped by a
 * card's `overflow: hidden` (the movie/group cards now overlay their info on the
 * poster, which clips). Plumbing handled here:
 *
 *  1. `pos` — measured from the trigger (`ref`) each time the menu opens.
 *  2. Outside-click closes the menu — counting BOTH the trigger (`ref`) and the
 *     portaled menu (`menuRef`) as "inside".
 *  3. Scroll / resize closes the menu (a fixed-position dropdown would otherwise
 *     drift away from its trigger).
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
		if (el) {
			const r = el.getBoundingClientRect();
			setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
		}

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
			document.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('resize', dismiss);
			window.removeEventListener('scroll', dismiss, true);
		};
	}, [open]);

	return { open, setOpen, ref, menuRef, pos };
}
