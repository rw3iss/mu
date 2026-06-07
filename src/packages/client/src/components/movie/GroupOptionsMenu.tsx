import { useState } from 'preact/hooks';
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
}

/**
 * Card-corner options menu for a collection/series tile. Mirrors
 * MovieOptionsMenu (shares its SCSS) but exposes the group-level actions
 * available on the GroupDetail page: Confirm (when unsure), Refresh metadata
 * (parent groups), and Ungroup.
 */
export function GroupOptionsMenu({ group, compact }: GroupOptionsMenuProps) {
	const { open, setOpen, ref } = useMenuOpen();
	const [busy, setBusy] = useState(false);

	const isUnsure = group.status === 'unsure';
	const isParent = group.type === 'parent';

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
			notifySuccess('Refreshing group metadata…');
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
		} catch {
			notifyError('Failed to ungroup');
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

			{open && (
				<div class={styles.menu} onClick={(e: Event) => e.stopPropagation()}>
					{isUnsure && (
						<button class={styles.menuItem} onClick={handleConfirm} disabled={busy}>
							Confirm Group
						</button>
					)}
					{isParent && (
						<button class={styles.menuItem} onClick={handleRefreshMetadata} disabled={busy}>
							Refresh Metadata
						</button>
					)}
					<button
						class={`${styles.menuItem} ${styles.danger}`}
						onClick={handleUngroup}
						disabled={busy}
					>
						Ungroup
					</button>
				</div>
			)}
		</div>
	);
}
