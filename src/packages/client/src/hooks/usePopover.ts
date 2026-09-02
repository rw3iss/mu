import { type RefObject, useEffect } from 'preact/hooks';

/**
 * Shared outside-click + Escape-key dismissal for popovers, dropdowns,
 * tooltips, menus — any element that should close when the user clicks
 * away from it or presses Escape.
 *
 * Listeners only attach while `open` is true, so there's no document-
 * level overhead when the popover is closed. Cleanup is automatic on
 * `open` flipping to false or on unmount.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   const [open, setOpen] = useState(false);
 *   usePopover({ open, onClose: () => setOpen(false), ref });
 *   return <div ref={ref}>...</div>;
 *
 * @param ref - Element that anchors the popover. Clicks INSIDE this
 *              element (or any descendant, like the trigger + menu)
 *              don't dismiss; clicks anywhere else do.
 * @param open - Whether the popover is currently visible.
 * @param onClose - Called when the user clicks outside or presses Escape.
 * @param disableEscape - Skip the Escape listener. Useful when a parent
 *                        handles Escape differently (e.g. closing a
 *                        whole modal instead of one popover within it).
 */
export function usePopover({
	ref,
	open,
	onClose,
	disableEscape = false,
}: {
	ref: RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	disableEscape?: boolean;
}): void {
	useEffect(() => {
		if (!open) return;
		const handlePointer = (e: MouseEvent | TouchEvent) => {
			const el = ref.current;
			if (!el) return;
			if (!el.contains(e.target as Node)) onClose();
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('mousedown', handlePointer);
		// Touch pairing — needed on iOS Safari where mousedown synthesis
		// is unreliable inside scrollable containers.
		document.addEventListener('touchstart', handlePointer, { passive: true });
		if (!disableEscape) document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('mousedown', handlePointer);
			document.removeEventListener('touchstart', handlePointer);
			document.removeEventListener('keydown', handleKey);
		};
	}, [open, onClose, ref, disableEscape]);
}
