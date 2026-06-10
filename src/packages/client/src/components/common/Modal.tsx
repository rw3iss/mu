import { ComponentChildren, createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { reduceMotion } from '@/state/appearance.state';
import { Icon } from './Icon';
import styles from './Modal.module.scss';

/** Exit-animation duration — kept in sync with the `.closing` CSS below. */
const EXIT_MS = 180;

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	children: ComponentChildren;
	size?: 'sm' | 'md' | 'lg';
}

/** Selector matching every focusable descendant of the modal — used by
 *  the focus trap to bracket Tab / Shift-Tab to the modal's contents. */
const FOCUSABLE_SELECTOR =
	'a[href], area[href], input:not([disabled]), select:not([disabled]), ' +
	'textarea:not([disabled]), button:not([disabled]), iframe, object, embed, ' +
	'[tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);
	// Element that had focus *before* the modal opened — restored on close.
	const openerRef = useRef<HTMLElement | null>(null);
	// Keep the modal mounted through its exit animation. `rendered` controls
	// presence in the DOM; `closing` swaps in the exit keyframes.
	const [rendered, setRendered] = useState(isOpen);
	const [closing, setClosing] = useState(false);
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (isOpen) {
			if (exitTimer.current) {
				clearTimeout(exitTimer.current);
				exitTimer.current = null;
			}
			setClosing(false);
			setRendered(true);
			return;
		}
		// Closing: play the exit animation, then unmount. Reduce-motion skips
		// the wait so the modal disappears immediately.
		setClosing(true);
		const delay = reduceMotion.value ? 0 : EXIT_MS;
		exitTimer.current = setTimeout(() => {
			exitTimer.current = null;
			setRendered(false);
			setClosing(false);
		}, delay);
		return () => {
			if (exitTimer.current) {
				clearTimeout(exitTimer.current);
				exitTimer.current = null;
			}
		};
	}, [isOpen]);

	const handleBackdropClick = useCallback(
		(e: MouseEvent) => {
			if (e.target === overlayRef.current) {
				onClose();
			}
		},
		[onClose],
	);

	// Keep the latest onClose in a ref so the focus-trap effect doesn't
	// re-run (and re-steal focus) when callers pass a new inline closure on
	// every render — typing in a modal field was refocusing the X button.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!isOpen) return;

		// Capture the opener so we can return focus when the modal closes.
		openerRef.current = (document.activeElement as HTMLElement) ?? null;

		function handleKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				onCloseRef.current();
				return;
			}
			if (e.key !== 'Tab') return;
			// Focus trap — keep keyboard navigation inside the modal so Tab
			// can't reach the page underneath.
			const modal = modalRef.current;
			if (!modal) return;
			const focusables = modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
			if (focusables.length === 0) return;
			const first = focusables[0]!;
			const last = focusables[focusables.length - 1]!;
			const active = document.activeElement as HTMLElement | null;
			if (e.shiftKey) {
				if (active === first || !modal.contains(active)) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (active === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}

		document.addEventListener('keydown', handleKey);
		document.body.style.overflow = 'hidden';

		// Initial focus — pick the first focusable inside the modal, or
		// fall back to the modal container itself so screen readers
		// announce the dialog title.
		// Defer to next microtask so the children are mounted.
		queueMicrotask(() => {
			const modal = modalRef.current;
			if (!modal) return;
			const focusables = modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
			(focusables[0] ?? modal).focus();
		});

		return () => {
			document.removeEventListener('keydown', handleKey);
			document.body.style.overflow = '';
			// Return focus to whatever opened us, unless it's gone from DOM.
			const opener = openerRef.current;
			openerRef.current = null;
			if (opener && document.contains(opener)) {
				try {
					opener.focus();
				} catch {}
			}
		};
	}, [isOpen]);

	if (!rendered) return null;

	return createPortal(
		<div
			ref={overlayRef}
			class={`${styles.overlay} ${closing ? styles.overlayClosing : ''}`}
			onClick={handleBackdropClick}
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			<div
				ref={modalRef}
				class={`${styles.modal} ${styles[size]} ${closing ? styles.modalClosing : ''}`}
				tabIndex={-1}
			>
				{title && (
					<div class={styles.header}>
						<h2 class={styles.title}>{title}</h2>
						<button class={styles.close} onClick={onClose} aria-label="Close modal">
							<Icon name="x" size={16} />
						</button>
					</div>
				)}
				<div class={styles.body}>{children}</div>
			</div>
		</div>,
		document.body,
	);
}
