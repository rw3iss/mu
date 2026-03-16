import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { moviesService } from '@/services/movies.service';
import { closePlayer, globalMovieId } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './MovieOptionsMenu.module.scss';

interface MovieOptionsMenuProps {
	movie: Movie;
	onMovieUpdate?: (movie: Movie) => void;
	/** When true, shows inline in a card corner */
	compact?: boolean;
}

export function MovieOptionsMenu({ movie, onMovieUpdate, compact }: MovieOptionsMenuProps) {
	const [open, setOpen] = useState(false);
	const [rescanState, setRescanState] = useState<'idle' | 'loading' | 'complete'>('idle');
	const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'complete'>('idle');
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [deleteFolder, setDeleteFolder] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on outside click + raise parent card z-index while open
	useEffect(() => {
		if (!open) return;

		// Raise the nearest card/row ancestor so the menu overlays sibling cards
		const card = menuRef.current?.closest('[role="button"]') as HTMLElement | null;
		if (card) {
			card.style.zIndex = '50';
			card.style.position = 'relative';
		}

		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
				setConfirmingRemove(false);
			}
		};
		document.addEventListener('mousedown', handleClick);
		return () => {
			document.removeEventListener('mousedown', handleClick);
			if (card) {
				card.style.zIndex = '';
			}
		};
	}, [open]);

	const refreshMovie = useCallback(async () => {
		try {
			const updated = await moviesService.get(movie.id);
			onMovieUpdate?.(updated);
		} catch {
			// ignore
		}
	}, [movie.id, onMovieUpdate]);

	const handleHideToggle = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			try {
				const newHidden = !movie.hidden;
				await moviesService.update(movie.id, { hidden: newHidden });
				onMovieUpdate?.({ ...movie, hidden: newHidden });
				notifySuccess(newHidden ? 'Movie hidden from library' : 'Movie unhidden');
				setOpen(false);
			} catch {
				notifyError('Failed to update movie');
			}
		},
		[movie, onMovieUpdate],
	);

	const handleRescan = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			setOpen(false);
			setRescanState('loading');
			try {
				const result = await moviesService.rescan(movie.id);
				const updatedCount = result.files.filter((f: any) => f.updated).length;
				await refreshMovie();
				setRescanState('complete');
				notifySuccess(`Re-scanned ${result.files.length} file(s), ${updatedCount} updated`);
				setTimeout(() => setRescanState('idle'), 3000);
			} catch {
				setRescanState('idle');
				notifyError('Failed to re-scan movie files');
			}
		},
		[movie.id, refreshMovie],
	);

	const handleRefreshMetadata = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			setOpen(false);
			setRefreshState('loading');
			try {
				await moviesService.refreshMetadata(movie.id);
				await refreshMovie();
				setRefreshState('complete');
				notifySuccess('Metadata refreshed');
				setTimeout(() => setRefreshState('idle'), 3000);
			} catch {
				setRefreshState('idle');
				notifyError('Failed to refresh metadata');
			}
		},
		[movie.id, refreshMovie],
	);

	const handleRemove = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			try {
				await moviesService.remove(movie.id);
				notifySuccess(`'${movie.title}' removed from library`);
				setOpen(false);
				route('/library');
			} catch {
				notifyError('Failed to remove movie');
			}
		},
		[movie.id],
	);

	const handleDeleteFromDisk = useCallback(async () => {
		setIsDeleting(true);
		try {
			if (globalMovieId.value === movie.id) {
				await closePlayer();
			}
			await moviesService.deleteFromDisk(movie.id, deleteFolder);
			notifySuccess(`'${movie.title}' deleted from disk`);
			setShowDeleteModal(false);
			setOpen(false);
			route('/library');
		} catch (err: any) {
			notifyError(err?.message || 'Failed to delete movie from disk');
		} finally {
			setIsDeleting(false);
		}
	}, [movie.id, deleteFolder]);

	const toggleMenu = useCallback(
		(e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			setOpen(!open);
			setConfirmingRemove(false);
		},
		[open],
	);

	return (
		<div class={`${styles.container} ${compact ? styles.compact : ''}`} ref={menuRef}>
			<button
				class={styles.trigger}
				onClick={toggleMenu}
				aria-label="Movie options"
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
					<button
						class={styles.menuItem}
						onClick={handleRescan}
						disabled={rescanState !== 'idle'}
					>
						<span class={styles.menuIcon}>
							{rescanState === 'complete' ? '\u2713' : '\u{1F50D}'}
						</span>
						{rescanState === 'loading'
							? 'Scanning...'
							: rescanState === 'complete'
								? 'Scanned'
								: 'Re-scan File'}
					</button>
					<button
						class={styles.menuItem}
						onClick={handleRefreshMetadata}
						disabled={refreshState !== 'idle'}
					>
						<span class={styles.menuIcon}>
							{refreshState === 'complete' ? '\u2713' : '\u21BB'}
						</span>
						{refreshState === 'loading'
							? 'Refreshing...'
							: refreshState === 'complete'
								? 'Complete'
								: 'Refresh Metadata'}
					</button>
					<div class={styles.menuDivider} />
					<button class={styles.menuItem} onClick={handleHideToggle}>
						<span class={styles.menuIcon}>
							{movie.hidden ? '\u{1F441}' : '\u{1F6AB}'}
						</span>
						{movie.hidden ? 'Unhide from Library' : 'Hide from Library'}
					</button>
					{confirmingRemove ? (
						<div class={styles.confirmRow}>
							<span>Remove?</span>
							<button class={styles.confirmYes} onClick={handleRemove}>
								Yes
							</button>
							<button
								class={styles.confirmNo}
								onClick={(e: Event) => {
									e.stopPropagation();
									setConfirmingRemove(false);
								}}
							>
								Cancel
							</button>
						</div>
					) : (
						<button
							class={`${styles.menuItem} ${styles.danger}`}
							onClick={(e: Event) => {
								e.stopPropagation();
								setConfirmingRemove(true);
							}}
						>
							<span class={styles.menuIcon}>{'\u2715'}</span>
							Remove from Library
						</button>
					)}
					<button
						class={`${styles.menuItem} ${styles.danger}`}
						onClick={(e: Event) => {
							e.stopPropagation();
							setDeleteFolder(false);
							setShowDeleteModal(true);
						}}
					>
						<span class={styles.menuIcon}>{'\u{1F5D1}'}</span>
						Delete from Disk
					</button>
				</div>
			)}

			<Modal
				isOpen={showDeleteModal}
				onClose={() => setShowDeleteModal(false)}
				title="Delete from Disk"
			>
				<div class={styles.deleteModalBody}>
					<p>
						This will permanently delete the movie file(s) from disk and remove all
						cached data. This action cannot be undone.
					</p>
					<label class={styles.deleteOption}>
						<input
							type="radio"
							name="deleteMode"
							checked={!deleteFolder}
							onChange={() => setDeleteFolder(false)}
						/>
						Delete movie file only
					</label>
					<label class={styles.deleteOption}>
						<input
							type="radio"
							name="deleteMode"
							checked={deleteFolder}
							onChange={() => setDeleteFolder(true)}
						/>
						Delete file and enclosing folder
					</label>
					<div class={styles.deleteActions}>
						<Button
							variant="secondary"
							onClick={() => setShowDeleteModal(false)}
							disabled={isDeleting}
						>
							Cancel
						</Button>
						<Button
							variant="danger"
							onClick={handleDeleteFromDisk}
							loading={isDeleting}
						>
							Delete Permanently
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
