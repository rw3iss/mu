import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Icon } from '@/components/common/Icon';
import { openInviteModal } from '@/components/player/session/session-ui.state';
import { moviesService } from '@/services/movies.service';
import {
	type MoviePlaylistInfo,
	type Playlist,
	playlistsService,
} from '@/services/playlists.service';
import { sharedSessionService } from '@/services/shared-session.service';
import { currentUser } from '@/state/auth.state';
import { playMovie } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import {
	notifyError,
	notifyInfo,
	notifySuccess,
	notifyWarning,
	shouldNotifyPlaylist,
} from '@/state/notifications.state';
import {
	addMovieToPlaylist,
	ensurePlaylistsLoaded,
	getCachedMembership,
	getMembership,
	playlists as playlistsSignal,
	removeMovieFromPlaylist,
} from '@/state/playlists.state';
import { processingMovieIds } from '@/state/processing.state';
import { activeSession } from '@/state/shared-session.state';
import {
	ensureWatchlistLoaded,
	isInWatchlist as isInWatchlistSync,
	toggleWatchlist as toggleWatchlistMutation,
	watchlistIds,
} from '@/state/watchlist.state';
import { DeleteMovieModal } from './DeleteMovieModal';
import { DownloadOfflineModal } from './DownloadOfflineModal';
import { MetadataSearchModal } from './MetadataSearchModal';
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
	const { open, setOpen, ref: containerRef, menuRef: dropdownRef, pos } = useMenuOpen();
	const [rescanState, setRescanState] = useState<AsyncActionState>('idle');
	const [refreshState, setRefreshState] = useState<AsyncActionState>('idle');
	const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
	const [showClearMetaConfirm, setShowClearMetaConfirm] = useState(false);
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [showDownloadModal, setShowDownloadModal] = useState(false);
	const [showMetadataSearch, setShowMetadataSearch] = useState(false);
	const [playlistFlyoutOpen, setPlaylistFlyoutOpen] = useState(false);
	const [opsOpen, setOpsOpen] = useState(false);
	const [playlistsListing, setPlaylistsListing] = useState<Playlist[]>([]);
	const [publicListing, setPublicListing] = useState<Playlist[]>([]);
	const [playlistsMembership, setPlaylistsMembership] = useState<MoviePlaylistInfo[]>(
		() => getCachedMembership(movie.id) ?? [],
	);
	const [playlistsLoading, setPlaylistsLoading] = useState(false);
	const [pendingPlaylistId, setPendingPlaylistId] = useState<string | null>(null);
	const [inWatchlist, setInWatchlist] = useState(
		() => isInWatchlistSync(movie.id) || (movie.inWatchlist ?? false),
	);
	const [watchlistPending, setWatchlistPending] = useState(false);
	const flyoutCloseTimerRef = useRef<number | null>(null);

	// Subscribe to the cached playlists signal so the menu reflects
	// updates from elsewhere (e.g. detail-page MoviePlaylists, CRUD page).
	useEffect(() => {
		setPlaylistsListing(playlistsSignal.value ?? []);
		const unsub = playlistsSignal.subscribe((v) => {
			setPlaylistsListing(v ?? []);
		});
		return unsub;
	}, []);

	// Subscribe to the watchlist cache so the option label flips
	// whenever any other surface mutates the set.
	useEffect(() => {
		const unsub = watchlistIds.subscribe((ids) => {
			if (ids) setInWatchlist(ids.has(movie.id));
		});
		return unsub;
	}, [movie.id]);

	// On menu open, ensure both the watchlist and playlists caches are
	// warm so the labels and submenu render with correct membership info.
	useEffect(() => {
		if (!open) return;
		ensureWatchlistLoaded().catch(() => {});
		ensurePlaylistsLoaded()
			.then((list) => setPlaylistsListing(list))
			.catch(() => {});
		getMembership(movie.id)
			.then((m) => setPlaylistsMembership(m))
			.catch(() => {});
	}, [movie.id, open]);

	// Cleanup any pending flyout-close timer on unmount.
	useEffect(() => {
		return () => {
			if (flyoutCloseTimerRef.current !== null) {
				clearTimeout(flyoutCloseTimerRef.current);
			}
		};
	}, []);

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
					// Optimistic: watched also clears the resume position server-side,
					// so drop it locally too (hides Resume + the position bar at once).
					onMovieUpdate?.({ ...movie, watched: true, watchPosition: 0 });
					notifySuccess('Marked as watched');
				}
				setOpen(false);
				// Re-fetch so every server-derived field (position, progress,
				// history) is authoritative — the optimistic patch only covers
				// the obvious ones.
				await refreshMovie();
			} catch {
				notifyError('Failed to update watched status');
			}
		},
		[movie, onMovieUpdate, setOpen, refreshMovie],
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
				const bumped = result.prioritized ? ' · processing moved to front of queue' : '';
				notifySuccess(
					`Re-scanned ${result.files.length} file(s), ${updatedCount} updated${bumped}`,
				);
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
			notifyInfo('Refreshing metadata. This may take up to a minute…');
			try {
				const result = await moviesService.refreshMetadata(movie.id);
				await refreshMovie();
				setRefreshState('complete');
				const src = result?.source;
				if (!src) {
					notifyWarning(result?.message || 'No metadata found for this movie.');
				} else if (src === 'omdb') {
					notifySuccess(
						'Metadata loaded from OMDb (TMDB unavailable). Refresh again later to try TMDB.',
					);
				} else {
					notifySuccess('Metadata loaded.');
				}
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

	// ── "Add to playlist" flyout ───────────────────────────────────────

	const cancelFlyoutClose = useCallback(() => {
		if (flyoutCloseTimerRef.current !== null) {
			clearTimeout(flyoutCloseTimerRef.current);
			flyoutCloseTimerRef.current = null;
		}
	}, []);

	const scheduleFlyoutClose = useCallback(() => {
		cancelFlyoutClose();
		flyoutCloseTimerRef.current = window.setTimeout(() => {
			setPlaylistFlyoutOpen(false);
			setOpsOpen(false);
			flyoutCloseTimerRef.current = null;
		}, 140);
	}, [cancelFlyoutClose]);

	// "Operations" submenu — hover/click open, mutually exclusive with playlists.
	const openOps = useCallback(() => {
		cancelFlyoutClose();
		setPlaylistFlyoutOpen(false);
		setOpsOpen(true);
	}, [cancelFlyoutClose]);

	const openPlaylistFlyout = useCallback(async () => {
		cancelFlyoutClose();
		setOpsOpen(false);
		setPlaylistFlyoutOpen(true);

		// First-open lazy fetch (no-op if already cached)
		setPlaylistsLoading(true);
		try {
			const me = currentUser.value?.id;
			const [list, member, pub] = await Promise.all([
				ensurePlaylistsLoaded(),
				getMembership(movie.id),
				playlistsService.listPublic().catch(() => [] as Playlist[]),
			]);
			setPlaylistsListing(list);
			setPlaylistsMembership(member);
			// Other members' public playlists that accept contributions.
			setPublicListing(pub.filter((p) => p.publicEdit && p.userId !== me));
		} catch {
			notifyError('Failed to load playlists');
		} finally {
			setPlaylistsLoading(false);
		}
	}, [cancelFlyoutClose, movie.id]);

	const handleTogglePlaylistMembership = useCallback(
		async (e: Event, playlist: Playlist) => {
			e.stopPropagation();
			if (pendingPlaylistId) return;

			const isMember = playlistsMembership.some((m) => m.id === playlist.id);
			setPendingPlaylistId(playlist.id);
			try {
				if (isMember) {
					await removeMovieFromPlaylist(playlist.id, movie.id);
					setPlaylistsMembership((prev) => prev.filter((m) => m.id !== playlist.id));
					if (shouldNotifyPlaylist()) notifySuccess(`Removed from ${playlist.name}`);
				} else {
					await addMovieToPlaylist(playlist.id, movie.id);
					setPlaylistsMembership((prev) => [
						...prev,
						{ id: playlist.id, name: playlist.name },
					]);
					if (shouldNotifyPlaylist()) notifySuccess(`Added to ${playlist.name}`);
				}
			} catch {
				notifyError(
					isMember ? 'Failed to remove from playlist' : 'Failed to add to playlist',
				);
			} finally {
				setPendingPlaylistId(null);
			}
		},
		[movie.id, pendingPlaylistId, playlistsMembership],
	);

	// ── Watchlist toggle ───────────────────────────────────────────────

	const handleWatchlistToggle = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			if (watchlistPending) return;

			setWatchlistPending(true);
			try {
				const next = await toggleWatchlistMutation(movie.id);
				setInWatchlist(next);
				onMovieUpdate?.({ ...movie, inWatchlist: next });
				notifySuccess(next ? 'Added to watchlist' : 'Removed from watchlist');
				setOpen(false);
			} catch {
				notifyError('Failed to update watchlist');
			} finally {
				setWatchlistPending(false);
			}
		},
		[movie, onMovieUpdate, setOpen, watchlistPending],
	);

	const handleStartSharedSession = useCallback(
		async (e: Event) => {
			e.stopPropagation();
			setOpen(false);
			if (activeSession.value) {
				notifyError('End your current shared session first');
				return;
			}
			try {
				// Load the movie into the player, then start the session on it.
				await playMovie(movie.id);
				await sharedSessionService.startSession(movie.id);
				openInviteModal();
			} catch {
				notifyError('Failed to start shared session');
			}
		},
		[movie.id, setOpen],
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

	// "Download for Offline" shows only for a real, fully-processed library
	// file (not a bookmark/external stub, and not mid-transcode). fileInfo is
	// populated on the detail page, so the item naturally appears there.
	const isProcessing =
		movie.status === 'processing' ||
		movie.status === 'processing_playable' ||
		processingMovieIds.value.has(movie.id);
	// Any played-from-disk library movie can be downloaded (by movieId) — works
	// from card menus too, where fileInfo isn't loaded. Bookmarks/externals have
	// no file; processing ones aren't ready yet.
	const canDownload = movie.source !== 'bookmark' && movie.source !== 'external' && !isProcessing;

	return (
		<div class={`${styles.container} ${compact ? styles.compact : ''}`} ref={containerRef}>
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

			{open &&
				createPortal(
					<div
						ref={dropdownRef}
						class={`${styles.menu} ${styles.menuPortal} ${compact ? styles.compactMenu : ''}`}
						style={
							pos
								? {
										top: pos.top != null ? `${pos.top}px` : undefined,
										bottom: pos.bottom != null ? `${pos.bottom}px` : undefined,
										right: `${pos.right}px`,
										maxHeight:
											pos.maxHeight != null
												? `${pos.maxHeight}px`
												: undefined,
										overflowY: pos.maxHeight != null ? 'auto' : undefined,
									}
								: undefined
						}
						onClick={(e: Event) => e.stopPropagation()}
					>
						<button class={styles.menuItem} onClick={handleWatchedToggle}>
							<span class={styles.menuIcon}>
								<Icon name={movie.watched ? 'refresh' : 'check'} />
							</span>
							{movie.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
						</button>
						<button class={styles.menuItem} onClick={handleStartSharedSession}>
							<span class={styles.menuIcon}>
								<Icon name="film" />
							</span>
							Start Shared Session
						</button>
						<button
							class={styles.menuItem}
							onClick={handleWatchlistToggle}
							disabled={watchlistPending}
						>
							<span class={styles.menuIcon}>
								<Icon name={inWatchlist ? 'star-filled' : 'star'} />
							</span>
							{inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
						</button>
						<div
							class={styles.flyoutAnchor}
							onMouseEnter={openPlaylistFlyout}
							onMouseLeave={scheduleFlyoutClose}
						>
							<button
								class={`${styles.menuItem} ${styles.submenuTrigger}`}
								onClick={openPlaylistFlyout}
								aria-haspopup="menu"
								aria-expanded={playlistFlyoutOpen}
							>
								<span class={styles.menuIcon}>
									<Icon name="list-plus" />
								</span>
								<span class={styles.submenuLabel}>Add to playlist</span>
								<span class={styles.submenuChevron} aria-hidden="true">
									<Icon name="chevron-right" />
								</span>
							</button>
							{playlistFlyoutOpen && (
								<div
									class={styles.flyoutWrapper}
									role="menu"
									onMouseEnter={cancelFlyoutClose}
									onMouseLeave={scheduleFlyoutClose}
									onClick={(e: Event) => e.stopPropagation()}
								>
									<div class={styles.flyoutInner}>
										{(() => {
											const renderRow = (p: Playlist) => {
												const isMember = playlistsMembership.some(
													(m) => m.id === p.id,
												);
												const pending = pendingPlaylistId === p.id;
												return (
													<button
														key={p.id}
														class={`${styles.menuItem} ${styles.flyoutItem}`}
														onClick={(e: Event) =>
															handleTogglePlaylistMembership(e, p)
														}
														disabled={pending}
														title={
															isMember
																? `Remove from ${p.name}`
																: `Add to ${p.name}`
														}
													>
														<span
															class={`${styles.menuIcon} ${styles.submenuCheck}`}
														>
															{pending ? (
																'…'
															) : isMember ? (
																<Icon name="check" />
															) : null}
														</span>
														<span class={styles.submenuLabel}>
															{p.name}
														</span>
													</button>
												);
											};
											if (playlistsLoading && playlistsListing.length === 0) {
												return (
													<div class={styles.submenuEmpty}>Loading…</div>
												);
											}
											return (
												<>
													{playlistsListing.length === 0 ? (
														<div class={styles.submenuEmpty}>
															No playlists yet
														</div>
													) : (
														playlistsListing.map(renderRow)
													)}
													{publicListing.length > 0 && (
														<>
															<div class={styles.flyoutSectionLabel}>
																Public playlists
															</div>
															{publicListing.map(renderRow)}
														</>
													)}
												</>
											);
										})()}
									</div>
								</div>
							)}
						</div>
						<button
							class={`${styles.menuItem}`}
							onClick={handleRefreshMetadata}
							disabled={refreshState !== 'idle'}
						>
							<span class={styles.menuIcon}>
								<Icon name={refreshState === 'complete' ? 'check' : 'refresh'} />
							</span>
							{asyncLabel(refreshState, {
								idle: 'Refresh Metadata',
								loading: 'Refreshing...',
								complete: 'Complete',
							})}
						</button>
						{canDownload && (
							<button
								class={styles.menuItem}
								onClick={(e: Event) => {
									e.stopPropagation();
									setOpen(false);
									setShowDownloadModal(true);
								}}
							>
								<span class={styles.menuIcon}>
									<Icon name="download" />
								</span>
								Download for Offline
							</button>
						)}
						<div
							class={styles.flyoutAnchor}
							onMouseEnter={openOps}
							onMouseLeave={scheduleFlyoutClose}
						>
							<button
								class={`${styles.menuItem} ${styles.submenuTrigger}`}
								onClick={openOps}
								aria-haspopup="menu"
								aria-expanded={opsOpen}
							>
								<span class={styles.menuIcon}>
									<Icon name="settings" />
								</span>
								<span class={styles.submenuLabel}>Other</span>
								<span class={styles.submenuChevron} aria-hidden="true">
									<Icon name="chevron-right" />
								</span>
							</button>
							{opsOpen && (
								<div
									class={styles.flyoutWrapper}
									role="menu"
									onMouseEnter={cancelFlyoutClose}
									onMouseLeave={scheduleFlyoutClose}
									onClick={(e: Event) => e.stopPropagation()}
								>
									<div class={styles.flyoutInner}>
										<button
											class={`${styles.menuItem} ${styles.flyoutItem}`}
											onClick={handleRescan}
											disabled={rescanState !== 'idle'}
										>
											<span class={styles.menuIcon}>
												<Icon
													name={
														rescanState === 'complete'
															? 'check'
															: 'search'
													}
												/>
											</span>
											{asyncLabel(rescanState, {
												idle: 'Rescan File',
												loading: 'Scanning...',
												complete: 'Scanned',
											})}
										</button>
										<button
											class={`${styles.menuItem} ${styles.flyoutItem}`}
											onClick={(e: Event) => {
												e.stopPropagation();
												setOpen(false);
												setShowMetadataSearch(true);
											}}
										>
											<span class={styles.menuIcon}>
												<Icon name="search" />
											</span>
											Search for Metadata
										</button>
										<button
											class={`${styles.menuItem} ${styles.flyoutItem}`}
											onClick={(e: Event) => {
												e.stopPropagation();
												setOpen(false);
												setShowClearMetaConfirm(true);
											}}
										>
											<span class={styles.menuIcon}>
												<Icon name="x" />
											</span>
											Clear Metadata
										</button>
										<button
											class={`${styles.menuItem} ${styles.flyoutItem}`}
											onClick={handleHideToggle}
										>
											<span class={styles.menuIcon}>
												<Icon name={movie.hidden ? 'eye' : 'eye-off'} />
											</span>
											{movie.hidden
												? 'Unhide from Library'
												: 'Hide from Library'}
										</button>
										<button
											class={`${styles.menuItem} ${styles.flyoutItem} ${styles.danger}`}
											onClick={(e: Event) => {
												e.stopPropagation();
												setOpen(false);
												setShowRemoveConfirm(true);
											}}
										>
											<span class={styles.menuIcon}>
												<Icon name="x-circle" />
											</span>
											Remove from Library
										</button>
										<button
											class={`${styles.menuItem} ${styles.flyoutItem} ${styles.danger}`}
											onClick={(e: Event) => {
												e.stopPropagation();
												setShowDeleteModal(true);
											}}
										>
											<span class={styles.menuIcon}>
												<Icon name="trash" />
											</span>
											Delete from Disk
										</button>
									</div>
								</div>
							)}
						</div>
					</div>,
					document.body,
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

			<DownloadOfflineModal
				isOpen={showDownloadModal}
				movie={movie}
				onClose={() => setShowDownloadModal(false)}
			/>

			<MetadataSearchModal
				isOpen={showMetadataSearch}
				movieId={movie.id}
				initialQuery={movie.title}
				onClose={() => setShowMetadataSearch(false)}
				onAssigned={refreshMovie}
			/>
		</div>
	);
}
