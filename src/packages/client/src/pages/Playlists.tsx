import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { useUiSetting } from '@/hooks/useUiSetting';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import type { Playlist, PlaylistMovieSummary } from '@/services/playlists.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { invalidatePlaylists } from '@/state/playlists.state';
import { newTabNav, openInNewTab } from '@/utils/navigation';
import styles from './Playlists.module.scss';

type PlaylistSortBy = 'updated' | 'created' | 'name' | 'movieCount' | 'lastPlayed';
type PlaylistSortOrder = 'asc' | 'desc';
type PlaylistViewMode = 'grid' | 'list';

interface PlaylistsProps {
	path?: string;
}

/** Max movies to show in the 3x2 preview grid */
const PREVIEW_COUNT = 6;

function formatDuration(
	runtimeMinutes: number | null | undefined,
	durationSeconds: number | null | undefined,
): string {
	// Prefer precise file duration for short movies
	const totalSec = durationSeconds ?? (runtimeMinutes ? runtimeMinutes * 60 : 0);
	if (totalSec <= 0) return '';

	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = Math.round(totalSec % 60);

	if (h > 0 && m > 0) return `${h}h ${m}m`;
	if (h > 0) return `${h}h`;
	if (totalSec < 600) {
		// Under 10 minutes — show seconds too
		return m > 0 ? `${m}m ${s}s` : `${s}s`;
	}
	return `${m}m`;
}

// ============================================
// Shared: Interactive movie poster with hover info
// ============================================

interface MoviePosterItemProps {
	movie: PlaylistMovieSummary;
	/** 'strip' = tooltip above (list view); 'grid' = overlay on poster (card view) */
	variant?: 'strip' | 'grid';
	class?: string;
}

function MoviePosterItem({ movie, variant = 'strip', class: className }: MoviePosterItemProps) {
	const poster = movie.posterUrl || movie.thumbnailUrl;

	const movieHref = `/movie/${movie.movieId}`;
	const handleClick = useCallback(
		(e: MouseEvent) => {
			// stopPropagation so a poster inside a playlist card navigates to the
			// movie, not the playlist.
			e.stopPropagation();
			e.preventDefault();
			if (e.metaKey || e.ctrlKey || e.shiftKey) openInNewTab(movieHref);
			else route(movieHref);
		},
		[movieHref],
	);
	const handleAux = useCallback(
		(e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				e.stopPropagation();
				openInNewTab(movieHref);
			}
		},
		[movieHref],
	);

	const variantClass = variant === 'grid' ? styles.posterItemGrid : styles.posterItemStrip;

	return (
		<div
			class={`${styles.posterItem} ${variantClass} ${className || ''}`}
			onClick={handleClick}
			onAuxClick={handleAux}
			role="link"
			tabIndex={0}
		>
			{poster ? (
				<img src={poster} alt={movie.title} loading="lazy" class={styles.posterImg} />
			) : (
				<div class={styles.posterFallback}>
					<span>{movie.title.charAt(0).toUpperCase()}</span>
				</div>
			)}
			<div class={styles.posterInfo}>
				<div class={styles.posterInfoTitle}>{movie.title}</div>
				<div class={styles.posterInfoMeta}>
					{movie.year && <span>{movie.year}</span>}
					{(movie.durationSeconds || movie.runtimeMinutes) && (
						<span>{formatDuration(movie.runtimeMinutes, movie.durationSeconds)}</span>
					)}
				</div>
			</div>
		</div>
	);
}

// ============================================
// Shared: Horizontal scrollable movie poster strip
// ============================================

function MovieStrip({ movies }: { movies: PlaylistMovieSummary[] }) {
	const trackRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const [offset, setOffset] = useState(0);
	const [maxOffset, setMaxOffset] = useState(0);

	const recalc = useCallback(() => {
		const track = trackRef.current;
		const wrapper = wrapperRef.current;
		if (!track || !wrapper) return;
		const max = Math.max(0, track.scrollWidth - wrapper.clientWidth);
		setMaxOffset(max);
		setOffset((prev) => Math.min(prev, max));
	}, []);

	useEffect(() => {
		recalc();
	}, [movies]);

	useEffect(() => {
		const wrapper = wrapperRef.current;
		if (!wrapper) return;
		const ro = new ResizeObserver(recalc);
		ro.observe(wrapper);
		return () => ro.disconnect();
	}, []);

	const scroll = useCallback(
		(dir: 'left' | 'right') => {
			const wrapper = wrapperRef.current;
			if (!wrapper) return;
			const step = wrapper.clientWidth * 0.8;
			setOffset((prev) => {
				const next = dir === 'left' ? prev - step : prev + step;
				return Math.max(0, Math.min(next, maxOffset));
			});
		},
		[maxOffset],
	);

	const canScrollLeft = offset > 0;
	const canScrollRight = offset < maxOffset - 1;

	if (movies.length === 0) {
		return <div class={styles.stripEmpty}>No movies yet</div>;
	}

	return (
		<div class={styles.stripWrapper} ref={wrapperRef}>
			{canScrollLeft && (
				<button
					class={`${styles.stripArrow} ${styles.stripArrowLeft}`}
					onClick={(e) => {
						e.stopPropagation();
						scroll('left');
					}}
					aria-label="Scroll left"
				>
					<Icon name="chevron-left" />
				</button>
			)}
			<div
				class={styles.stripTrack}
				ref={trackRef}
				style={{ transform: `translateX(-${offset}px)` }}
			>
				{movies.map((m) => (
					<MoviePosterItem key={m.movieId} movie={m} variant="strip" />
				))}
			</div>
			{canScrollRight && (
				<button
					class={`${styles.stripArrow} ${styles.stripArrowRight}`}
					onClick={(e) => {
						e.stopPropagation();
						scroll('right');
					}}
					aria-label="Scroll right"
				>
					<Icon name="chevron-right" />
				</button>
			)}
		</div>
	);
}

// ============================================
// Main Playlists page
// ============================================

export function Playlists(_props: PlaylistsProps) {
	const [playlists, setPlaylists] = useState<Playlist[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [showCreate, setShowCreate] = useState(false);
	const [newName, setNewName] = useState('');
	const [newDescription, setNewDescription] = useState('');
	const [newPublic, setNewPublic] = useState(false);
	const [newPublicEdit, setNewPublicEdit] = useState(false);
	const [sortBy, setSortBy] = useUiSetting<PlaylistSortBy>('playlists_sort', 'updated');
	const [sortOrder, setSortOrder] = useUiSetting<PlaylistSortOrder>(
		'playlists_sort_order',
		'desc',
	);
	const [viewMode, setViewMode] = useUiSetting<PlaylistViewMode>('playlists_view', 'list');

	const [publicPlaylists, setPublicPlaylists] = useState<Playlist[]>([]);
	// Mobile: which column is shown (columns collapse to tabs).
	const [activeList, setActiveList] = useState<'mine' | 'public'>('mine');

	useEffect(() => {
		loadPlaylists(sortBy, sortOrder);
	}, [sortBy, sortOrder]);

	useEffect(() => {
		api.get<Playlist[]>('/playlists/public?includeMovies=true')
			.then(setPublicPlaylists)
			.catch(() => {});
	}, []);

	async function loadPlaylists(sort: PlaylistSortBy, order: PlaylistSortOrder) {
		setIsLoading(true);
		try {
			const data = await api.get<Playlist[]>(
				`/playlists?includeMovies=true&sortBy=${sort}&sortOrder=${order}`,
			);
			setPlaylists(data);
		} catch {
			console.error('Failed to load playlists');
		} finally {
			setIsLoading(false);
		}
	}

	const handleSortChange = useCallback((value: PlaylistSortBy) => {
		setSortBy(value);
	}, []);

	const toggleSortOrder = useCallback(() => {
		setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
	}, [sortOrder]);

	const handleCreate = useCallback(
		async (e: Event) => {
			e.preventDefault();
			if (!newName.trim()) return;

			try {
				await api.post('/playlists', {
					name: newName.trim(),
					description: newDescription.trim(),
					isPublic: newPublic || newPublicEdit,
					publicEdit: newPublicEdit,
				});
				invalidatePlaylists();
				notifySuccess('Playlist created');
				setShowCreate(false);
				setNewName('');
				setNewDescription('');
				setNewPublic(false);
				setNewPublicEdit(false);
				loadPlaylists(sortBy);
			} catch {
				notifyError('Failed to create playlist');
			}
		},
		[newName, newDescription, newPublic, newPublicEdit],
	);

	const renderRow = (playlist: Playlist, showOwner = false) => (
		<div key={playlist.id} class={styles.listItem}>
			<div class={styles.listItemHeader}>
				<h3
					class={styles.listItemName}
					{...newTabNav(`/playlists/${playlist.id}`, () =>
						route(`/playlists/${playlist.id}`),
					)}
					role="link"
					tabIndex={0}
				>
					{playlist.name}
				</h3>
				<span class={styles.listItemCount}>
					{playlist.movieCount} {playlist.movieCount === 1 ? 'movie' : 'movies'}
					{showOwner && playlist.ownerName ? ` · by ${playlist.ownerName}` : ''}
				</span>
			</div>
			<MovieStrip movies={playlist.movies ?? []} />
		</div>
	);

	const renderCard = (playlist: Playlist, showOwner = false) => {
		const previewMovies = (playlist.movies ?? []).slice(0, PREVIEW_COUNT);
		const hasMovies = previewMovies.length > 0;
		return (
			<div
				key={playlist.id}
				class={styles.card}
				{...newTabNav(`/playlists/${playlist.id}`, () =>
					route(`/playlists/${playlist.id}`),
				)}
				role="button"
				tabIndex={0}
			>
				<div class={styles.cardPoster}>
					{hasMovies ? (
						<div class={styles.movieGrid}>
							{previewMovies.map((m) => (
								<MoviePosterItem key={m.movieId} movie={m} variant="grid" />
							))}
							{Array.from({ length: PREVIEW_COUNT - previewMovies.length }).map(
								(_, i) => (
									<div key={`empty-${i}`} class={styles.movieTileEmpty} />
								),
							)}
						</div>
					) : (
						<div class={styles.emptyPoster}>
							<span class={styles.emptyIcon}>No movies yet</span>
						</div>
					)}
				</div>
				<div class={styles.cardInfo}>
					<h3 class={styles.cardName}>{playlist.name}</h3>
					{playlist.description && (
						<p class={styles.cardDescription}>{playlist.description}</p>
					)}
					<span class={styles.cardCount}>
						{playlist.movieCount} {playlist.movieCount === 1 ? 'movie' : 'movies'}
						{showOwner && playlist.ownerName ? ` · by ${playlist.ownerName}` : ''}
					</span>
				</div>
			</div>
		);
	};

	if (isLoading) {
		return (
			<div class={styles.loading}>
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<div class={styles.playlists}>
			<div class={styles.header}>
				<h1 class={styles.title}>Playlists</h1>
				<div class={styles.headerActions}>
					<Select<PlaylistSortBy>
						value={sortBy}
						onChange={handleSortChange}
						options={[
							{ value: 'updated', label: 'Date Updated' },
							{ value: 'created', label: 'Date Created' },
							{ value: 'name', label: 'Name' },
							{ value: 'movieCount', label: 'Number of Items' },
							{ value: 'lastPlayed', label: 'Last Played' },
						]}
					/>
					<button
						class={styles.sortOrderBtn}
						onClick={toggleSortOrder}
						aria-label={sortOrder === 'desc' ? 'Sort descending' : 'Sort ascending'}
						title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
					>
						<Icon name={sortOrder === 'desc' ? 'arrow-down' : 'arrow-up'} />
					</button>
					<div class={styles.viewToggle}>
						<button
							class={`${styles.viewButton} ${viewMode === 'grid' ? styles.active : ''}`}
							onClick={() => setViewMode('grid')}
							aria-label="Grid view"
							title="Grid"
						>
							<Icon name="view-grid" />
						</button>
						<button
							class={`${styles.viewButton} ${viewMode === 'list' ? styles.active : ''}`}
							onClick={() => setViewMode('list')}
							aria-label="List view"
							title="List"
						>
							<Icon name="view-list" />
						</button>
					</div>
					<Button variant="primary" onClick={() => setShowCreate(true)}>
						+ New Playlist
					</Button>
				</div>
			</div>

			{/* Mobile tabs — columns collapse to one list at small widths */}
			<div class={styles.mobileTabs}>
				<button
					class={`${styles.mobileTab} ${activeList === 'mine' ? styles.mobileTabActive : ''}`}
					onClick={() => setActiveList('mine')}
				>
					<Icon name="view-list" size={14} /> My Playlists
				</button>
				<button
					class={`${styles.mobileTab} ${activeList === 'public' ? styles.mobileTabActive : ''}`}
					onClick={() => setActiveList('public')}
				>
					<Icon name="globe" size={14} /> Public
				</button>
			</div>

			<div class={styles.columns}>
				<section
					class={`${styles.column} ${activeList !== 'mine' ? styles.columnInactive : ''}`}
				>
					<h2 class={styles.columnTitle}>My Playlists</h2>
					{playlists.length === 0 ? (
						<div class={styles.empty}>
							<p>No playlists yet</p>
							<Button variant="secondary" onClick={() => setShowCreate(true)}>
								Create your first playlist
							</Button>
						</div>
					) : viewMode === 'grid' ? (
						<div class={styles.grid}>
							{playlists.map((playlist) => {
								const previewMovies = (playlist.movies ?? []).slice(
									0,
									PREVIEW_COUNT,
								);
								const hasMovies = previewMovies.length > 0;

								return (
									<div
										key={playlist.id}
										class={styles.card}
										{...newTabNav(`/playlists/${playlist.id}`, () =>
											route(`/playlists/${playlist.id}`),
										)}
										role="button"
										tabIndex={0}
									>
										<div class={styles.cardPoster}>
											{hasMovies ? (
												<div class={styles.movieGrid}>
													{previewMovies.map((m) => (
														<MoviePosterItem
															key={m.movieId}
															movie={m}
															variant="grid"
														/>
													))}
													{Array.from({
														length:
															PREVIEW_COUNT - previewMovies.length,
													}).map((_, i) => (
														<div
															key={`empty-${i}`}
															class={styles.movieTileEmpty}
														/>
													))}
												</div>
											) : (
												<div class={styles.emptyPoster}>
													<span class={styles.emptyIcon}>
														No movies yet
													</span>
												</div>
											)}
										</div>
										<div class={styles.cardInfo}>
											<h3 class={styles.cardName}>{playlist.name}</h3>
											{playlist.description && (
												<p class={styles.cardDescription}>
													{playlist.description}
												</p>
											)}
											<span class={styles.cardCount}>
												{playlist.movieCount}{' '}
												{playlist.movieCount === 1 ? 'movie' : 'movies'}
											</span>
										</div>
									</div>
								);
							})}
						</div>
					) : (
						<div class={styles.list}>{playlists.map((p) => renderRow(p))}</div>
					)}
				</section>

				<section
					class={`${styles.column} ${activeList !== 'public' ? styles.columnInactive : ''}`}
				>
					<h2 class={styles.columnTitle}>Public Playlists</h2>
					{publicPlaylists.length === 0 ? (
						<div class={styles.empty}>
							<p>No public playlists yet</p>
						</div>
					) : viewMode === 'grid' ? (
						<div class={styles.grid}>
							{publicPlaylists.map((pl) => renderCard(pl, true))}
						</div>
					) : (
						<div class={styles.list}>
							{publicPlaylists.map((pl) => renderRow(pl, true))}
						</div>
					)}
				</section>
			</div>

			<PluginSlot name={UI.PLAYLISTS_BOTTOM} context={{}} />

			<Modal
				isOpen={showCreate}
				onClose={() => setShowCreate(false)}
				title="Create Playlist"
				size="sm"
			>
				<form
					onSubmit={handleCreate}
					style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
				>
					<div>
						<label
							style={{
								display: 'block',
								fontSize: 'var(--font-size-sm)',
								marginBottom: 'var(--space-xs)',
								color: 'var(--color-text-secondary)',
							}}
						>
							Name
						</label>
						<input
							type="text"
							value={newName}
							onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
							placeholder="Playlist name"
							style={{
								width: '100%',
								padding: 'var(--space-sm) var(--space-md)',
								background: 'var(--color-bg-elevated)',
								border: '1px solid var(--color-border)',
								borderRadius: 'var(--radius-md)',
								color: 'var(--color-text-primary)',
								fontSize: 'var(--font-size-md)',
							}}
							autoFocus
							required
						/>
					</div>
					<div>
						<label
							style={{
								display: 'block',
								fontSize: 'var(--font-size-sm)',
								marginBottom: 'var(--space-xs)',
								color: 'var(--color-text-secondary)',
							}}
						>
							Description
						</label>
						<textarea
							value={newDescription}
							onInput={(e) =>
								setNewDescription((e.target as HTMLTextAreaElement).value)
							}
							placeholder="Optional description"
							rows={3}
							style={{
								width: '100%',
								padding: 'var(--space-sm) var(--space-md)',
								background: 'var(--color-bg-elevated)',
								border: '1px solid var(--color-border)',
								borderRadius: 'var(--radius-md)',
								color: 'var(--color-text-primary)',
								fontSize: 'var(--font-size-md)',
								resize: 'vertical',
							}}
						/>
					</div>
					<div class={styles.publicRow}>
						<div class={styles.publicInfo}>
							<span class={styles.publicLabel}>Public View</span>
							<span class={styles.publicHint}>Members can view it.</span>
						</div>
						<label
							class={`${styles.toggle} ${newPublicEdit ? styles.toggleLocked : ''}`}
							title={newPublicEdit ? 'Public Edit implies Public View' : undefined}
						>
							<input
								type="checkbox"
								checked={newPublic || newPublicEdit}
								disabled={newPublicEdit}
								onChange={(e) =>
									setNewPublic((e.target as HTMLInputElement).checked)
								}
							/>
							<span class={styles.toggleTrack} />
						</label>
					</div>
					<div class={styles.publicRow}>
						<div class={styles.publicInfo}>
							<span class={styles.publicLabel}>Public Edit</span>
							<span class={styles.publicHint}>
								Members can add and remove their own movies.
							</span>
						</div>
						<label class={styles.toggle}>
							<input
								type="checkbox"
								checked={newPublicEdit}
								onChange={(e) => {
									const on = (e.target as HTMLInputElement).checked;
									setNewPublicEdit(on);
									if (on) setNewPublic(true);
								}}
							/>
							<span class={styles.toggleTrack} />
						</label>
					</div>
					<Button type="submit" variant="primary" fullWidth>
						Create
					</Button>
				</form>
			</Modal>
		</div>
	);
}
