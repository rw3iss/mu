import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { moviesService } from '@/services/movies.service';
import { sourcesService } from '@/services/sources.service';
import { closePlayer, globalMovieId } from '@/state/globalPlayer.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { isLibraryRoot, parentDir } from '@/utils/path';
import styles from './MovieOptionsMenu.module.scss';

interface DeleteMovieModalProps {
	isOpen: boolean;
	movieId: string;
	movieTitle: string;
	/** Pre-loaded file path (used to render the parent folder name in
	 * the "delete file and enclosing folder" option). When null and the
	 * modal opens, the modal fetches it from the server. */
	filePath: string | null;
	onClose: () => void;
	/** Called after a successful delete + the success message has been
	 * shown. The parent uses this to drop the movie from its list (or
	 * navigate away from a now-orphaned detail page). */
	onDeleted: () => void;
}

/**
 * Dialog for "Delete from Disk" on a movie card or detail page.
 * Lives in its own component because the markup is more involved
 * than a `<ConfirmDialog>` allows — radio between "delete file only"
 * vs "delete file + enclosing folder", and a one-line preview of the
 * folder name.
 *
 * The Player gets stopped first if the deleted movie is the one
 * currently playing, so we don't end up streaming chunks from a
 * file that no longer exists.
 */
export function DeleteMovieModal({
	isOpen,
	movieId,
	movieTitle,
	filePath,
	onClose,
	onDeleted,
}: DeleteMovieModalProps) {
	const [deleteFolder, setDeleteFolder] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [resolvedPath, setResolvedPath] = useState<string | null>(filePath);
	const [libraryRoots, setLibraryRoots] = useState<string[]>([]);

	// Reset transient state each time the modal opens so a previous
	// success/loading state doesn't leak into the next open.
	useEffect(() => {
		if (isOpen) {
			setDeleteFolder(false);
			setIsDeleting(false);
		}
	}, [isOpen]);

	// Load the configured library root paths so we can hide the
	// "delete enclosing folder" option when this movie sits directly
	// in a root (deleting that folder would wipe the library source).
	useEffect(() => {
		if (!isOpen) return;
		sourcesService
			.getAll()
			.then((sources) => setLibraryRoots(sources.map((s) => s.path)))
			.catch(() => {});
	}, [isOpen]);

	// Fetch the file path lazily if the parent didn't have it (e.g.
	// the action was triggered from a card view that doesn't carry
	// fileInfo on the cached movie object).
	useEffect(() => {
		if (!isOpen) return;
		if (resolvedPath || !movieId) return;
		moviesService
			.get(movieId)
			.then((full) => {
				if (full?.fileInfo?.filePath) setResolvedPath(full.fileInfo.filePath);
			})
			.catch(() => {});
	}, [isOpen, movieId, resolvedPath]);

	const handleDelete = useCallback(async () => {
		setIsDeleting(true);
		try {
			if (globalMovieId.value === movieId) {
				await closePlayer();
			}
			await moviesService.deleteFromDisk(movieId, deleteFolder);
			// Confirm success, notify, then close + let the parent navigate away
			// (the movie's detail page no longer exists → back to /library).
			notifySuccess(`'${movieTitle}' deleted from disk`);
			onClose();
			onDeleted();
		} catch (err: unknown) {
			notifyError(
				(err as { message?: string })?.message || 'Failed to delete movie from disk',
			);
			setIsDeleting(false);
		}
	}, [movieId, movieTitle, deleteFolder, onClose, onDeleted]);

	const folderName = resolvedPath
		? resolvedPath.replace(/\\/g, '/').split('/').slice(-2, -1)[0]
		: null;

	// The enclosing folder is protected when it IS a library root — never
	// offer to delete it. Until the path resolves we keep the option hidden
	// to stay on the safe side.
	const folderIsLibraryRoot =
		!resolvedPath || isLibraryRoot(parentDir(resolvedPath), libraryRoots);
	const canDeleteFolder = !folderIsLibraryRoot;

	return (
		<Modal isOpen={isOpen} onClose={() => !isDeleting && onClose()} title="Delete from Disk">
			<div class={styles.deleteModalBody}>
				<p>
					This will permanently delete the movie file(s) from disk and remove all cached
					data. This action cannot be undone.
				</p>
				{canDeleteFolder && (
					<label class={styles.deleteOption}>
						<input
							type="radio"
							name="deleteMode"
							checked={!deleteFolder}
							onChange={() => setDeleteFolder(false)}
						/>
						Delete movie file only
					</label>
				)}
				{canDeleteFolder && (
					<label class={styles.deleteOption}>
						<input
							type="radio"
							name="deleteMode"
							checked={deleteFolder}
							onChange={() => setDeleteFolder(true)}
						/>
						Delete file and enclosing folder
						{folderName && (
							<span
								style={{
									display: 'block',
									fontSize: '0.8em',
									opacity: 0.6,
									marginTop: '0.2rem',
									marginLeft: '1.5rem',
									wordBreak: 'break-all',
								}}
							>
								({folderName})
							</span>
						)}
					</label>
				)}
				<div class={styles.deleteActions}>
					{isDeleting && <Spinner size="sm" />}
					<Button variant="secondary" onClick={onClose} disabled={isDeleting}>
						Cancel
					</Button>
					<Button variant="danger" onClick={handleDelete} disabled={isDeleting}>
						Delete Permanently
					</Button>
				</div>
			</div>
		</Modal>
	);
}
