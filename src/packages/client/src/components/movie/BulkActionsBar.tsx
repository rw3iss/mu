import { useCallback, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import type { Movie } from '@/state/library.state';
import styles from './BulkActionsBar.module.scss';

export type BulkAction =
	| 'rescan'
	| 'refresh_metadata'
	| 'clear_metadata'
	| 'hide'
	| 'unhide'
	| 'mark_watched'
	| 'mark_unwatched'
	| 'remove'
	| 'delete_from_disk';

interface BulkActionsBarProps {
	selectedIds: Set<string>;
	selectedMovies: Movie[];
	onAction: (action: BulkAction, options?: Record<string, unknown>) => Promise<void>;
	isLoading: boolean;
	status: { type: 'success' | 'error'; message: string } | null;
	onClearSelection: () => void;
	onExitEditMode: () => void;
}

export function BulkActionsBar({
	selectedIds,
	selectedMovies: _selectedMovies,
	onAction,
	isLoading,
	status,
	onClearSelection,
	onExitEditMode,
}: BulkActionsBarProps) {
	const count = selectedIds.size;

	// Confirmation modal state
	const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null);
	const [deleteFolder, setDeleteFolder] = useState(false);

	const handleAction = useCallback(
		async (action: BulkAction, opts?: Record<string, unknown>) => {
			setConfirmAction(null);
			await onAction(action, opts);
		},
		[onAction],
	);

	const triggerAction = useCallback(
		(action: BulkAction) => {
			if (
				action === 'clear_metadata' ||
				action === 'remove' ||
				action === 'delete_from_disk'
			) {
				setDeleteFolder(false);
				setConfirmAction(action);
			} else {
				handleAction(action);
			}
		},
		[handleAction],
	);

	const confirmLabelMap: Record<string, string> = {
		clear_metadata: 'Clear Metadata',
		remove: 'Remove from Library',
		delete_from_disk: 'Delete from Disk',
	};
	const confirmLabel = confirmAction ? (confirmLabelMap[confirmAction] ?? '') : '';

	return (
		<>
			<div class={styles.bar}>
				<div class={styles.left}>
					<button class={styles.exitBtn} onClick={onExitEditMode} title="Exit edit mode">
						<Icon name="x" />
					</button>
					{count > 0 ? (
						<span class={styles.countLabel}>
							{count} {count === 1 ? 'movie' : 'movies'} selected
						</span>
					) : (
						<span class={styles.hintLabel}>Click movies to select them</span>
					)}
					{count > 0 && (
						<button class={styles.clearBtn} onClick={onClearSelection}>
							Clear
						</button>
					)}
				</div>

				<div class={styles.actions}>
					{count > 0 && (
						<>
							<button
								class={styles.actionBtn}
								onClick={() => triggerAction('rescan')}
								disabled={isLoading}
								title="Re-Scan selected movies"
							>
								<Icon name="search" /> Re-Scan
							</button>
							<button
								class={styles.actionBtn}
								onClick={() => triggerAction('refresh_metadata')}
								disabled={isLoading}
								title="Refresh metadata for selected movies"
							>
								<Icon name="refresh" /> Refresh Metadata
							</button>
							<button
								class={styles.actionBtn}
								onClick={() => triggerAction('clear_metadata')}
								disabled={isLoading}
								title="Clear metadata for selected movies"
							>
								<Icon name="x" /> Clear Metadata
							</button>
							<div class={styles.divider} />
							<button
								class={styles.actionBtn}
								onClick={() => triggerAction('hide')}
								disabled={isLoading}
								title="Hide selected movies from library"
							>
								<Icon name="eye-off" /> Hide
							</button>
							<button
								class={styles.actionBtn}
								onClick={() => triggerAction('mark_watched')}
								disabled={isLoading}
								title="Mark selected movies as watched"
							>
								<Icon name="check" /> Mark Watched
							</button>
							<div class={styles.divider} />
							<button
								class={`${styles.actionBtn} ${styles.danger}`}
								onClick={() => triggerAction('remove')}
								disabled={isLoading}
								title="Remove selected movies from library"
							>
								Remove from Library
							</button>
							<button
								class={`${styles.actionBtn} ${styles.danger}`}
								onClick={() => triggerAction('delete_from_disk')}
								disabled={isLoading}
								title="Delete selected movies from disk"
							>
								<Icon name="trash" /> Delete from Disk
							</button>
						</>
					)}
				</div>

				<div class={styles.right}>
					{isLoading && <Spinner size="sm" />}
					{!isLoading && status && (
						<span class={`${styles.status} ${styles[status.type]}`}>
							{status.message}
						</span>
					)}
				</div>
			</div>

			{/* Confirmation modal */}
			<Modal
				isOpen={confirmAction !== null}
				onClose={() => setConfirmAction(null)}
				title={`Confirm: ${confirmLabel}`}
				size="sm"
			>
				<div class={styles.modalBody}>
					{confirmAction === 'clear_metadata' && (
						<>
							<p>
								Clear all metadata for <strong>{count}</strong>{' '}
								{count === 1 ? 'movie' : 'movies'}? Titles will be reset to their
								filenames. This cannot be undone.
							</p>
							<div class={styles.modalActions}>
								<Button variant="secondary" onClick={() => setConfirmAction(null)}>
									Cancel
								</Button>
								<Button
									variant="danger"
									onClick={() => handleAction('clear_metadata')}
								>
									Clear Metadata
								</Button>
							</div>
						</>
					)}

					{confirmAction === 'remove' && (
						<>
							<p>
								Remove <strong>{count}</strong> {count === 1 ? 'movie' : 'movies'}{' '}
								from the library? The files will not be deleted from disk.
							</p>
							<div class={styles.modalActions}>
								<Button variant="secondary" onClick={() => setConfirmAction(null)}>
									Cancel
								</Button>
								<Button variant="danger" onClick={() => handleAction('remove')}>
									Remove from Library
								</Button>
							</div>
						</>
					)}

					{confirmAction === 'delete_from_disk' && (
						<>
							<p>
								Permanently delete <strong>{count}</strong>{' '}
								{count === 1 ? 'movie' : 'movies'} from disk? This cannot be undone.
							</p>
							<div class={styles.deleteOptions}>
								<label class={styles.radioLabel}>
									<input
										type="radio"
										name="bulkDeleteMode"
										checked={!deleteFolder}
										onChange={() => setDeleteFolder(false)}
									/>
									Delete movie file only
								</label>
								<label class={styles.radioLabel}>
									<input
										type="radio"
										name="bulkDeleteMode"
										checked={deleteFolder}
										onChange={() => setDeleteFolder(true)}
									/>
									Delete file and enclosing folder
								</label>
							</div>
							<div class={styles.modalActions}>
								<Button variant="secondary" onClick={() => setConfirmAction(null)}>
									Cancel
								</Button>
								<Button
									variant="danger"
									onClick={() =>
										handleAction('delete_from_disk', {
											deleteEnclosingFolder: deleteFolder,
										})
									}
								>
									Delete Permanently
								</Button>
							</div>
						</>
					)}
				</div>
			</Modal>
		</>
	);
}
