import { ComponentChildren, createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import styles from './Modal.module.scss';

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	children: ComponentChildren;
	size?: 'sm' | 'md' | 'lg';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
	const overlayRef = useRef<HTMLDivElement>(null);

	const handleBackdropClick = useCallback(
		(e: MouseEvent) => {
			if (e.target === overlayRef.current) {
				onClose();
			}
		},
		[onClose],
	);

	useEffect(() => {
		if (!isOpen) return;

		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				onClose();
			}
		}

		document.addEventListener('keydown', handleEscape);
		document.body.style.overflow = 'hidden';

		return () => {
			document.removeEventListener('keydown', handleEscape);
			document.body.style.overflow = '';
		};
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return createPortal(
		<div
			ref={overlayRef}
			class={styles.overlay}
			onClick={handleBackdropClick}
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			<div class={`${styles.modal} ${styles[size]}`}>
				{title && (
					<div class={styles.header}>
						<h2 class={styles.title}>{title}</h2>
						<button class={styles.close} onClick={onClose} aria-label="Close modal">
							{'\u2715'}
						</button>
					</div>
				)}
				<div class={styles.body}>{children}</div>
			</div>
		</div>,
		document.body,
	);
}
