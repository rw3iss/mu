import { createPortal } from 'preact/compat';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { groupsService, type MovieGroup } from '@/services/groups.service';
import { invalidateGroups, pageGroups, parentGroups } from '@/state/groups.state';
import { fetchMovies } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './MovieOptionsMenu.module.scss';
import { useMenuOpen } from './useMenuOpen';

interface GroupOptionsMenuProps {
	group: MovieGroup;
	/** Renders the smaller card-corner trigger. */
	compact?: boolean;
	/** Called after the group is confirmed (e.g. to refresh a detail view). */
	onConfirmed?: () => void;
	/** Called after group metadata is refreshed (e.g. to re-fetch a detail view). */
	onRefreshed?: () => void;
	/** Called after the group is ungrouped or deleted (it no longer exists). */
	onRemoved?: () => void;
}

/**
 * Card-corner options menu for a collection/series tile. Mirrors
 * MovieOptionsMenu (shares its SCSS) but exposes the group-level actions
 * available on the GroupDetail page: Confirm (when unsure), Refresh metadata
 * (parent groups), and Ungroup.
 */
export function GroupOptionsMenu({
	group,
	compact,
	onConfirmed,
	onRefreshed,
	onRemoved,
}: GroupOptionsMenuProps) {
	const { open, setOpen, ref, menuRef, pos } = useMenuOpen();
	const [busy, setBusy] = useState(false);
	const [showDelete, setShowDelete] = useState(false);
	const [preview, setPreview] = useState<{ count: number; folder: string | null } | null>(null);

	const isUnsure = group.status === 'unsure';
	const isParent = group.type === 'parent';
	const typeLabel = group.groupType === 'collection' ? 'collection' : 'series';

	const dropFromSignals = () => {
		pageGroups.value = pageGroups.value.filter((g) => g.id !== group.id);
		parentGroups.value = parentGroups.value.filter((g) => g.id !== group.id);
	};

	const updateInSignals = (patch: Partial<MovieGroup>) => {
		const apply = (g: MovieGroup) => (g.id === group.id ? { ...g, ...patch } : g);
		pageGroups.value = pageGroups.value.map(apply);
		parentGroups.value = parentGroups.value.map(apply);
	};

	async function handleConfirm() {
		setOpen(false);
		setBusy(true);
		try {
			await groupsService.confirm(group.id);
			updateInSignals({ status: 'confirmed' });
			invalidateGroups();
			notifySuccess(`${group.name} confirmed`);
			onConfirmed?.();
		} catch {
			notifyError('Failed to confirm group');
		} finally {
			setBusy(false);
		}
	}

	async function handleRefreshMetadata() {
		setOpen(false);
		setBusy(true);
		try {
			await groupsService.refreshMetadata(group.id);
			invalidateGroups();
			notifySuccess('Group metadata refreshed');
			onRefreshed?.();
		} catch {
			notifyError('Failed to refresh group metadata');
		} finally {
			setBusy(false);
		}
	}

	async function handleUngroup() {
		setOpen(false);
		setBusy(true);
		try {
			await groupsService.reject(group.id);
			dropFromSignals();
			invalidateGroups();
			notifySuccess(`${group.name} ungrouped`);
			// Bring the freed movies back into the flat library view.
			await fetchMovies(1).catch(() => {});
			onRemoved?.();
		} catch {
			notifyError('Failed to ungroup');
		} finally {
			setBusy(false);
		}
	}

	async function handleDeleteClick() {
		setOpen(false);
		try {
			const p = await groupsService.deletePreview(group.id);
			setPreview({ count: p.count, folder: p.folder });
		} catch {
			setPreview({ count: group.totalMembers ?? 0, folder: null });
		}
		setShowDelete(true);
	}

	async function handleDeleteConfirm() {
		setShowDelete(false);
		setBusy(true);
		try {
			const res = await groupsService.deleteFromDisk(group.id);
			dropFromSignals();
			invalidateGroups();
			notifySuccess(
				`Deleted ${res.deleted} item(s) from disk${res.failed ? ` (${res.failed} failed)` : ''}`,
			);
			await fetchMovies(1).catch(() => {});
			onRemoved?.();
		} catch {
			notifyError('Failed to delete group from disk');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div
			class={`${styles.container} ${compact ? styles.compact : ''}`}
			ref={ref}
			onClick={(e: Event) => e.stopPropagation()}
		>
			<button
				class={styles.trigger}
				onClick={(e: Event) => {
					e.stopPropagation();
					setOpen(!open);
				}}
				aria-label="Group options"
				title="Options"
			>
				<svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
					<circle cx="12" cy="5" r="2" />
					<circle cx="12" cy="12" r="2" />
					<circle cx="12" cy="19" r="2" />
				</svg>
			</button>

			{open &&
				createPortal(
					<div
						ref={menuRef}
						class={`${styles.menu} ${styles.menuPortal} ${compact ? styles.compactMenu : ''}`}
						style={pos ? { top: `${pos.top}px`, right: `${pos.right}px` } : undefined}
						onClick={(e: Event) => e.stopPropagation()}
					>
						{isUnsure && (
							<button class={styles.menuItem} onClick={handleConfirm} disabled={busy}>
								Confirm Group
							</button>
						)}
						{isParent && (
							<button
								class={styles.menuItem}
								onClick={handleRefreshMetadata}
								disabled={busy}
							>
								Refresh Metadata
							</button>
						)}
						<button
							class={styles.menuItem}
							onClick={handleUngroup}
							disabled={busy}
						>
							Ungroup
						</button>
						<div class={styles.menuDivider} />
						<button
							class={`${styles.menuItem} ${styles.danger}`}
							onClick={handleDeleteClick}
							disabled={busy}
						>
							Delete from Disk
						</button>
					</div>,
					document.body,
				)}

			<ConfirmDialog
				isOpen={showDelete}
				onClose={() => setShowDelete(false)}
				onConfirm={handleDeleteConfirm}
				title={`Delete ${typeLabel} from disk`}
				confirmLabel="Delete from Disk"
				variant="danger"
				message={
					<span>
						Permanently delete{' '}
						<strong>
							{preview?.count ?? group.totalMembers ?? 0} item
							{(preview?.count ?? group.totalMembers ?? 0) === 1 ? '' : 's'}
						</strong>{' '}
						in “{group.name}” from disk?
						{preview?.folder && (
							<>
								<br />
								<br />
								Folder: <code>{preview.folder}</code>
							</>
						)}
						<br />
						<br />
						This removes the movie files from disk and cannot be undone.
					</span>
				}
			/>
		</div>
	);
}
