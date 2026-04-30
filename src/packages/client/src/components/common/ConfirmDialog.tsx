import type { ComponentChildren } from 'preact';
import { useCallback } from 'preact/hooks';
import { Button } from './Button';
import styles from './ConfirmDialog.module.scss';
import { Modal } from './Modal';

interface ConfirmDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	/** Plain string or arbitrary children (paragraphs, formatting). */
	message: string | ComponentChildren;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: 'danger' | 'primary';
	/**
	 * When provided (even as `false`), the dialog does NOT auto-close on
	 * confirm — the parent owns close so it can keep the dialog open
	 * during async work and close after the work settles. The confirm
	 * button shows a spinner while the value is `true`, and both buttons
	 * are disabled.
	 *
	 * When omitted (undefined), the dialog auto-closes immediately after
	 * `onConfirm()` returns, matching the original fire-and-forget API.
	 */
	loading?: boolean;
}

export function ConfirmDialog({
	isOpen,
	onClose,
	onConfirm,
	title,
	message,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	variant = 'primary',
	loading,
}: ConfirmDialogProps) {
	const isControlled = loading !== undefined;
	const handleConfirm = useCallback(() => {
		onConfirm();
		if (!isControlled) onClose();
	}, [onConfirm, onClose, isControlled]);

	return (
		<Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
			<div class={styles.content}>
				{typeof message === 'string' ? (
					<p class={styles.message}>{message}</p>
				) : (
					<div class={styles.message}>{message}</div>
				)}
				<div class={styles.actions}>
					<Button variant="secondary" onClick={onClose} disabled={loading === true}>
						{cancelLabel}
					</Button>
					<Button
						variant={variant === 'danger' ? 'danger' : 'primary'}
						onClick={handleConfirm}
						loading={loading === true}
					>
						{confirmLabel}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
