import { useCallback } from 'preact/hooks';
import { Modal } from './Modal';
import { Button } from './Button';
import styles from './ConfirmDialog.module.scss';

interface ConfirmDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: 'danger' | 'primary';
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
}: ConfirmDialogProps) {
	const handleConfirm = useCallback(() => {
		onConfirm();
		onClose();
	}, [onConfirm, onClose]);

	return (
		<Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
			<div class={styles.content}>
				<p class={styles.message}>{message}</p>
				<div class={styles.actions}>
					<Button variant="secondary" onClick={onClose}>
						{cancelLabel}
					</Button>
					<Button
						variant={variant === 'danger' ? 'danger' : 'primary'}
						onClick={handleConfirm}
					>
						{confirmLabel}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
