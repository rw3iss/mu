import { useCallback, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { DeleteMovieModal } from './DeleteMovieModal';
import styles from './MovieOptionsMenu.module.scss';
import { useMenuOpen } from './useMenuOpen';

interface MovieOptionsMenuProps {
	movie: Movie;
	onMovieUpdate?: (movie: Movie) => void;
	/**
	 * Called after the movie is removed from the library or deleted from
	 * disk. When provided, the menu does NOT navigate away — the parent
	 * is expected to drop the movie from its list. When omitted (e.g.
	 * from MovieDetail), the menu falls back to navigating to /library.
	 */
	onMovieRemoved?: (movieId: string) => void;
	/** When true, shows inline in a card corner */
	compact?: boolean;
}

/** Async-with-feedback action UI state: idle → loading → complete → idle. */
type AsyncActionState = 'idle' | 'loading' | 'complete';

export function MovieOptionsMenu({
	movie,
	onMovieUpdate,
	onMovieRemoved,
	compact,
}: MovieOptionsMenuProps) {
	const { open, setOpen, ref: menuRef } = useMenuOpen();
	const [rescanState, setRescanState] = useState<AsyncActionState>('idle');
	const [refreshState, setRefreshState] = useState<AsyncActionState>('idle');
	const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
	const [showClearMetaConfirm, setShowClearMetaConfirm] = useState(false);
	const [showDeleteModal, setShowDeleteModal] = useState(false);

	const refreshMovie = useCallback(async () => {
		try {
			const updated = await moviesService.get(movie.id);
			onMovieUpdate?.(updated);
		} catch {
			// ignore
		}
	}, [movie.id, onMovieUpdate]);

	// ── Action handlers ────────────────────────────────────────────────

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
		[movie, onMovieUpdate, setOpen],
	);

	const handleWatchedToggle = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			try {
				if (movie.watched) {
					await moviesService.markUnwatched(movie.id);
					onMovieUpdate?.({ ...movie, watched: false });
					notifySuccess('Marked as unwatched');
				} else {
					await moviesService.markWatched(movie.id);
					onMovieUpdate?.({ ...movie, watched: true });
					notifySuccess('Marked as watched');
				}
				setOpen(false);
			} catch {
				notifyError('Failed to update watched status');
			}
		},
		[movie, onMovieUpdate, setOpen],
	);

	const handleRescan = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			setOpen(false);
			setRescanState('loading');
			try {
				const result = await moviesService.rescan(movie.id);
				const updatedCount = result.files.filter(
					(f: { updated?: boolean }) => f.updated,
				).length;
				await refreshMovie();
				setRescanState('complete');
				notifySuccess(`Re-scanned ${result.files.length} file(s), ${updatedCount} updated`);
				setTimeout(() => setRescanState('idle'), 3000);
			} catch {
				setRescanState('idle');
				notifyError('Failed to re-scan movie files');
			}
		},
		[movie.id, refreshMovie, setOpen],
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
		[movie.id, refreshMovie, setOpen],
	);

	const handleClearMetadata = useCallback(async () => {
		setShowClearMetaConfirm(false);
		try {
			await moviesService.clearMetadata(movie.id);
			await refreshMovie();
			notifySuccess('Metadata cleared');
		} catch {
			notifyError('Failed to clear metadata');
		}
	}, [movie.id, refreshMovie]);

	const handleRemove = useCallback(async () => {
		setShowRemoveConfirm(false);
		try {
			await moviesService.remove(movie.id);
			notifySuccess(`'${movie.title}' removed from library`);
			if (onMovieRemoved) {
				onMovieRemoved(movie.id);
			} else {
				route('/library');
			}
		} catch {
			notifyError('Failed to remove movie');
		}
	}, [movie.id, movie.title, onMovieRemoved]);

	const handleDeleted = useCallback(() => {
		setOpen(false);
		if (onMovieRemoved) {
			onMovieRemoved(movie.id);
		} else {
			route('/library');
		}
	}, [movie.id, onMovieRemoved, setOpen]);

	const toggleMenu = useCallback(
		(e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			setOpen(!open);
		},
		[open, setOpen],
	);

	// Helper for the two async-feedback actions (rescan + refresh
	// metadata). Their display label cycles through three values
	// driven by the AsyncActionState; the ✓ glyph stands in for the
	// idle icon while the action is still completing.
	function asyncLabel(
		state: AsyncActionState,
		labels: { idle: string; loading: string; complete: string },
	): string {
		return labels[state];
	}

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
							{rescanState === 'complete' ? '✓' : '🔍'}
						</span>
						{asyncLabel(rescanState, {
							idle: 'Re-scan File',
							loading: 'Scanning...',
							complete: 'Scanned',
						})}
					</button>
					<button
						class={styles.menuItem}
						onClick={handleRefreshMetadata}
						disabled={refreshState !== 'idle'}
					>
						<span class={styles.menuIcon}>
							{refreshState === 'complete' ? '✓' : '↻'}
						</span>
						{asyncLabel(refreshState, {
							idle: 'Refresh Metadata',
							loading: 'Refreshing...',
							complete: 'Complete',
						})}
					</button>
					<button
						class={styles.menuItem}
						onClick={(e: Event) => {
							e.stopPropagation();
							setOpen(false);
							setShowClearMetaConfirm(true);
						}}
					>
						<span class={styles.menuIcon}>{'✕'}</span>
						Clear Metadata
					</button>
					<div class={styles.menuDivider} />
					<button class={styles.menuItem} onClick={handleHideToggle}>
						<span class={styles.menuIcon}>{movie.hidden ? '👁' : '🚫'}</span>
						{movie.hidden ? 'Unhide from Library' : 'Hide from Library'}
					</button>
					<button class={styles.menuItem} onClick={handleWatchedToggle}>
						<span class={styles.menuIcon}>{movie.watched ? '↩' : '✓'}</span>
						{movie.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
					</button>
					<button
						class={`${styles.menuItem} ${styles.danger}`}
						onClick={(e: Event) => {
							e.stopPropagation();
							setOpen(false);
							setShowRemoveConfirm(true);
						}}
					>
						<span class={styles.menuIcon}>{'✕'}</span>
						Remove from Library
					</button>
					<button
						class={`${styles.menuItem} ${styles.danger}`}
						onClick={(e: Event) => {
							e.stopPropagation();
							setShowDeleteModal(true);
						}}
					>
						<span class={styles.menuIcon}>{'🗑'}</span>
						Delete from Disk
					</button>
				</div>
			)}

			<ConfirmDialog
				isOpen={showClearMetaConfirm}
				onClose={() => setShowClearMetaConfirm(false)}
				onConfirm={handleClearMetadata}
				title="Clear all metadata?"
				message={`Reset '${movie.title}' to its file-scan defaults and remove all fetched metadata. This cannot be undone.`}
				confirmLabel="Clear Metadata"
				variant="danger"
			/>

			<ConfirmDialog
				isOpen={showRemoveConfirm}
				onClose={() => setShowRemoveConfirm(false)}
				onConfirm={handleRemove}
				title="Remove from Library?"
				message={`'${movie.title}' will be removed from the library. The source file on disk is not deleted.`}
				confirmLabel="Remove"
				variant="danger"
			/>

			<DeleteMovieModal
				isOpen={showDeleteModal}
				movieId={movie.id}
				movieTitle={movie.title}
				filePath={movie.fileInfo?.filePath ?? null}
				onClose={() => setShowDeleteModal(false)}
				onDeleted={handleDeleted}
			/>
		</div>
	);
}
