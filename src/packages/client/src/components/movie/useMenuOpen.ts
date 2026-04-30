import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Open / close state for an inline pop-out menu (e.g. the
 * three-dot options menu on a movie card). Handles two pieces
 * of plumbing every such menu needs:
 *
 * 1. Outside-click closes the menu.
 * 2. While open, raises the nearest "card" ancestor (anything with
 *    `role="button"`) above its siblings so the menu doesn't get
 *    clipped or overlap-hidden by neighbouring cards in the grid.
 *
 * The ref returned must be attached to the menu's outermost element
 * so the outside-click handler knows what counts as "inside".
 */
export function useMenuOpen() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;

		const card = ref.current?.closest('[role="button"]') as HTMLElement | null;
		if (card) {
			card.style.zIndex = '50';
			card.style.position = 'relative';
		}

		const onMouseDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onMouseDown);
		return () => {
			document.removeEventListener('mousedown', onMouseDown);
			if (card) card.style.zIndex = '';
		};
	}, [open]);

	return { open, setOpen, ref };
}
