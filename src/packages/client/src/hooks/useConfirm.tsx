import type { ComponentChildren } from 'preact';
import { useCallback, useState } from 'preact/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export interface ConfirmOptions {
	title: string;
	message: string | ComponentChildren;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: 'danger' | 'primary';
}

interface PendingConfirm extends ConfirmOptions {
	resolve: (value: boolean) => void;
}

/**
 * Promise-based confirmation backed by the styled <ConfirmDialog> — a
 * drop-in, themed replacement for the native `confirm()`:
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (!(await confirm({ title: 'Delete?', message: '…', variant: 'danger' })))
 *     return;
 *   ...
 *   return <div>{…}{dialog}</div>;   // render `dialog` once in the tree
 *
 * Resolves `true` on confirm and `false` on cancel / backdrop / Escape.
 * Only one dialog shows at a time; a second `confirm()` before the first
 * settles replaces it (resolving the first as cancelled).
 */
export function useConfirm() {
	const [pending, setPending] = useState<PendingConfirm | null>(null);

	const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
		return new Promise<boolean>((resolve) => {
			setPending((prev) => {
				prev?.resolve(false);
				return { ...options, resolve };
			});
		});
	}, []);

	const settle = useCallback((result: boolean) => {
		setPending((prev) => {
			prev?.resolve(result);
			return null;
		});
	}, []);

	const dialog = pending ? (
		<ConfirmDialog
			isOpen
			onClose={() => settle(false)}
			onConfirm={() => settle(true)}
			title={pending.title}
			message={pending.message}
			confirmLabel={pending.confirmLabel}
			cancelLabel={pending.cancelLabel}
			variant={pending.variant}
		/>
	) : null;

	return { confirm, dialog };
}
