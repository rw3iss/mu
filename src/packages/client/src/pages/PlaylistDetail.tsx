import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { invalidatePlaylists } from '@/state/playlists.state';
import { newTabNav } from '@/utils/navigation';
import styles from './PlaylistDetail.module.scss';

// ============================================
// Types
// ============================================

interface PlaylistMovie {
	movieId: string;
	position: number;
	movieTitle: string;
	movieYear: number;
	moviePosterUrl: string | null;
	movieThumbnailUrl: string | null;
	movieRuntimeMinutes: number;
}

interface Playlist {
	id: string;
	name: string;
	description: string;
	userId: string;
	isPublic?: boolean;
	publicEdit?: boolean;
	ownerName?: string | null;
	movies: PlaylistMovie[];
}

interface PlaylistDetailProps {
	path?: string;
	id?: string;
}

// ============================================
// Component
// ============================================

export function PlaylistDetail({ id }: PlaylistDetailProps) {
	const [playlist, setPlaylist] = useState<Playlist | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [showEdit, setShowEdit] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [editName, setEditName] = useState('');
	const [editDescription, setEditDescription] = useState('');
	const [editPublic, setEditPublic] = useState(false);
	const [editPublicEdit, setEditPublicEdit] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [removingMovieId, setRemovingMovieId] = useState<string | null>(null);

	const loadPlaylist = useCallback(async () => {
		if (!id) return;
		setIsLoading(true);
		try {
			const data = await api.get<Playlist>(`/playlists/${id}`);
			setPlaylist(data);
		} catch (error) {
			console.error('Failed to load playlist:', error);
			notifyError('Failed to load playlist');
		} finally {
			setIsLoading(false);
		}
	}, [id]);

	useEffect(() => {
		loadPlaylist();
	}, [loadPlaylist]);

	const handleOpenEdit = useCallback(() => {
		if (!playlist) return;
		setEditName(playlist.name);
		setEditDescription(playlist.description);
		setEditPublic(!!playlist.isPublic);
		setEditPublicEdit(!!playlist.publicEdit);
		setShowEdit(true);
	}, [playlist]);

	const handleSaveEdit = useCallback(
		async (e: Event) => {
			e.preventDefault();
			if (!playlist || !editName.trim()) return;

			setIsSaving(true);
			try {
				await api.patch(`/playlists/${playlist.id}`, {
					name: editName.trim(),
					description: editDescription.trim(),
					isPublic: editPublic,
					publicEdit: editPublicEdit,
				});
				setPlaylist({
					...playlist,
					name: editName.trim(),
					description: editDescription.trim(),
					isPublic: editPublic,
					publicEdit: editPublicEdit,
				});
				invalidatePlaylists();
				setShowEdit(false);
				notifySuccess('Playlist updated');
			} catch {
				notifyError('Failed to update playlist');
			} finally {
				setIsSaving(false);
			}
		},
		[playlist, editName, editDescription, editPublic, editPublicEdit],
	);

	const handleDelete = useCallback(async () => {
		if (!playlist) return;

		try {
			await api.delete(`/playlists/${playlist.id}`);
			invalidatePlaylists();
			notifySuccess('Playlist deleted');
			route('/playlists');
		} catch {
			notifyError('Failed to delete playlist');
		}
	}, [playlist]);

	const handleRemoveMovie = useCallback(
		async (movieId: string) => {
			if (!playlist) return;

			setRemovingMovieId(movieId);
			try {
				await api.delete(`/playlists/${playlist.id}/movies/${movieId}`);
				setPlaylist({
					...playlist,
					movies: playlist.movies.filter((m) => m.movieId !== movieId),
				});
				invalidatePlaylists();
				notifySuccess('Movie removed from playlist');
			} catch {
				notifyError('Failed to remove movie');
			} finally {
				setRemovingMovieId(null);
			}
		},
		[playlist],
	);

	function formatRuntime(minutes: number): string {
		if (!minutes) return '';
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
	}

	// Loading state
	if (isLoading) {
		return (
			<div class={styles.loading}>
				<Spinner size="lg" />
			</div>
		);
	}

	// Not found state
	if (!playlist) {
		return (
			<div class={styles.notFound}>
				<h2>Playlist not found</h2>
				<Button variant="secondary" onClick={() => route('/playlists')}>
					Back to Playlists
				</Button>
			</div>
		);
	}

	const isOwner = currentUser.value?.id === playlist.userId;

	return (
		<div class={styles.playlistDetail}>
			{/* Header */}
			<div class={styles.header}>
				<div class={styles.headerInfo}>
					<button class={styles.backLink} onClick={() => route('/playlists')}>
						<Icon name="arrow-left" size={14} /> Playlists
					</button>
					<h1 class={styles.title}>{playlist.name}</h1>
					{playlist.description && (
						<p class={styles.description}>{playlist.description}</p>
					)}
					<span class={styles.movieCount}>
						{playlist.movies.length} {playlist.movies.length === 1 ? 'movie' : 'movies'}
						{!isOwner && playlist.ownerName ? ` · by ${playlist.ownerName}` : ''}
						{playlist.isPublic ? ' · Public' : ''}
					</span>
				</div>
				{isOwner && (
					<div class={styles.headerActions}>
						<Button variant="secondary" size="sm" onClick={handleOpenEdit}>
							Edit
						</Button>
						<Button
							variant="danger"
							size="sm"
							onClick={() => setShowDeleteConfirm(true)}
						>
							Delete
						</Button>
					</div>
				)}
			</div>

			{/* Movie List */}
			{playlist.movies.length === 0 ? (
				<div class={styles.empty}>
					<p>This playlist is empty</p>
					<Button variant="secondary" onClick={() => route('/library')}>
						Browse Library
					</Button>
				</div>
			) : (
				<div class={styles.movieList}>
					{playlist.movies.map((movie, index) => (
						<div key={movie.movieId} class={styles.movieItem}>
							<span class={styles.moviePosition}>{index + 1}</span>

							<div
								class={styles.moviePoster}
								{...newTabNav(`/movie/${movie.movieId}`, () =>
									route(`/movie/${movie.movieId}`),
								)}
								role="button"
								tabIndex={0}
							>
								{movie.moviePosterUrl || movie.movieThumbnailUrl ? (
									<img
										src={(movie.moviePosterUrl || movie.movieThumbnailUrl)!}
										alt={`${movie.movieTitle} poster`}
									/>
								) : (
									<span class={styles.posterPlaceholder}>
										{movie.movieTitle.charAt(0)}
									</span>
								)}
							</div>

							<div
								class={styles.movieInfo}
								{...newTabNav(`/movie/${movie.movieId}`, () =>
									route(`/movie/${movie.movieId}`),
								)}
								role="button"
								tabIndex={0}
							>
								<span class={styles.movieTitle}>{movie.movieTitle}</span>
								<div class={styles.movieMeta}>
									{movie.movieYear > 0 && <span>{movie.movieYear}</span>}
									{movie.movieRuntimeMinutes > 0 && (
										<span>{formatRuntime(movie.movieRuntimeMinutes)}</span>
									)}
								</div>
							</div>

							{isOwner && (
								<Button
									variant="ghost"
									size="sm"
									loading={removingMovieId === movie.movieId}
									onClick={() => handleRemoveMovie(movie.movieId)}
									aria-label={`Remove ${movie.movieTitle}`}
								>
									<Icon name="x" size={12} />
								</Button>
							)}
						</div>
					))}
				</div>
			)}

			<PluginSlot name={UI.PLAYLIST_DETAIL_BOTTOM} context={{ playlist }} />

			{/* Edit Modal */}
			<Modal
				isOpen={showEdit}
				onClose={() => setShowEdit(false)}
				title="Edit Playlist"
				size="sm"
			>
				<form onSubmit={handleSaveEdit} class={styles.editForm}>
					<div class={styles.formField}>
						<label class={styles.formLabel}>Name</label>
						<input
							type="text"
							value={editName}
							onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
							placeholder="Playlist name"
							class={styles.formInput}
							autoFocus
							required
						/>
					</div>
					<div class={styles.formField}>
						<label class={styles.formLabel}>Description</label>
						<textarea
							value={editDescription}
							onInput={(e) =>
								setEditDescription((e.target as HTMLTextAreaElement).value)
							}
							placeholder="Optional description"
							rows={3}
							class={styles.formTextarea}
						/>
					</div>
					<div class={styles.publicRow}>
						<div class={styles.publicInfo}>
							<span class={styles.formLabel}>Public View</span>
							<span class={styles.publicHint}>Allow other members to view it.</span>
						</div>
						<label class={styles.toggle}>
							<input
								type="checkbox"
								checked={editPublic}
								onChange={(e) =>
									setEditPublic((e.target as HTMLInputElement).checked)
								}
							/>
							<span class={styles.toggleTrack} />
						</label>
					</div>
					<div class={styles.publicRow}>
						<div class={styles.publicInfo}>
							<span class={styles.formLabel}>Public Edit</span>
							<span class={styles.publicHint}>
								Allow other members to add movies (they can remove their own
								additions).
							</span>
						</div>
						<label class={styles.toggle}>
							<input
								type="checkbox"
								checked={editPublicEdit}
								disabled={!editPublic}
								onChange={(e) =>
									setEditPublicEdit((e.target as HTMLInputElement).checked)
								}
							/>
							<span class={styles.toggleTrack} />
						</label>
					</div>
					<div class={styles.formActions}>
						<Button variant="ghost" onClick={() => setShowEdit(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={isSaving}>
							Save
						</Button>
					</div>
				</form>
			</Modal>

			{/* Delete Confirmation Modal */}
			<Modal
				isOpen={showDeleteConfirm}
				onClose={() => setShowDeleteConfirm(false)}
				title="Delete Playlist"
				size="sm"
			>
				<div class={styles.confirmContent}>
					<p class={styles.confirmText}>
						Are you sure you want to delete "{playlist.name}"? This action cannot be
						undone.
					</p>
					<div class={styles.formActions}>
						<Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
							Cancel
						</Button>
						<Button variant="danger" onClick={handleDelete}>
							Delete
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
