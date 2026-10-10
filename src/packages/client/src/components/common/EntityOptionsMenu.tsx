import { type EntityRef, type EntityType, entityMediaKind } from '@mu/shared';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { EntityRating } from '@/components/common/EntityRating';
import { Icon, type IconName } from '@/components/common/Icon';
import styles from '@/components/movie/MovieOptionsMenu.module.scss';
import { useMenuOpen } from '@/components/movie/useMenuOpen';
import {
	type MoviePlaylistInfo,
	type Playlist,
	playlistKindOf,
	playlistsService,
} from '@/services/playlists.service';
import {
	addFavorite,
	entityFavoriteKey,
	favoriteEntityKeys,
	favoriteMovieIds,
	removeFavorite,
} from '@/state/favorites.state';
import { playMedia } from '@/state/globalPlayer.state';
import { notifyError, notifySuccess, shouldNotifyPlaylist } from '@/state/notifications.state';
import {
	addEntityToPlaylist,
	ensurePlaylistsLoaded,
	getEntityMembership,
	invalidatePlaylists,
	removeEntityFromPlaylist,
} from '@/state/playlists.state';
import { addToQueue, playNext, type QueueItem } from '@/state/queue.state';

/**
 * Context every action receives. `item` is the denormalised queue entry
 * (title / art) so queue actions need no extra fetch.
 */
export interface EntityActionContext {
	entity: EntityRef;
	item: QueueItem;
	/** Primary artist (for "Go to Artist"). */
	artistId?: string | null;
	/** Parent album (for tracks: "Go to Album"). */
	albumId?: string | null;
	close: () => void;
}

export type EntityActionId =
	| 'play'
	| 'playNext'
	| 'addToQueue'
	| 'playlist'
	| 'rate'
	| 'favorite'
	| 'goArtist'
	| 'goAlbum'
	| 'goTrack';

interface EntityAction {
	id: EntityActionId;
	icon: IconName;
	label: (ctx: EntityActionContext) => string;
	visible?: (ctx: EntityActionContext) => boolean;
	/** Plain actions run and close; `playlist` / `rate` expand inline instead. */
	run?: (ctx: EntityActionContext) => void | Promise<void>;
}

function isFavorited(ref: EntityRef): boolean {
	if (ref.type === 'movie') return favoriteMovieIds.value?.has(ref.id) ?? false;
	if (ref.type === 'artist' || ref.type === 'album' || ref.type === 'track') {
		return favoriteEntityKeys.value?.has(entityFavoriteKey(ref.type, ref.id)) ?? false;
	}
	return false;
}

async function toggleFavorite(ref: EntityRef): Promise<void> {
	const on = isFavorited(ref);
	try {
		if (ref.type === 'movie') {
			if (on) await removeFavorite({ entityType: 'movie', movieId: ref.id });
			else await addFavorite({ entityType: 'movie', movieId: ref.id });
		} else if (ref.type === 'artist' || ref.type === 'album' || ref.type === 'track') {
			const input = { entityType: ref.type, entityId: ref.id };
			if (on) await removeFavorite(input);
			else await addFavorite(input);
		}
	} catch {
		notifyError('Failed to update favorites');
	}
}

const DETAIL_PATH: Partial<Record<EntityType, string>> = {
	movie: '/movie/',
	artist: '/artist/',
	album: '/album/',
	track: '/track/',
};

/** Every action, keyed by id. Which ones show is decided per entity type below. */
const ACTIONS: Record<EntityActionId, EntityAction> = {
	play: {
		id: 'play',
		icon: 'play',
		label: () => 'Play',
		run: async ({ entity }) => {
			try {
				await playMedia(entity);
			} catch (err) {
				notifyError((err as Error)?.message || 'Playback is not available');
			}
		},
	},
	playNext: {
		id: 'playNext',
		icon: 'arrow-up',
		label: () => 'Play Next',
		run: ({ item }) => {
			playNext(item);
			notifySuccess(`"${item.title}" plays next`);
		},
	},
	addToQueue: {
		id: 'addToQueue',
		icon: 'list-plus',
		label: () => 'Add to Queue',
		run: ({ item }) => {
			addToQueue(item);
			notifySuccess(`Added "${item.title}" to the queue`);
		},
	},
	playlist: { id: 'playlist', icon: 'list-plus', label: () => 'Add to Playlist' },
	rate: { id: 'rate', icon: 'star', label: () => 'Rate' },
	favorite: {
		id: 'favorite',
		icon: 'star',
		label: ({ entity }) => (isFavorited(entity) ? 'Remove from Favorites' : 'Add to Favorites'),
		run: ({ entity }) => toggleFavorite(entity),
	},
	goArtist: {
		id: 'goArtist',
		icon: 'arrow-right',
		label: () => 'Go to Artist',
		visible: ({ artistId }) => !!artistId,
		run: ({ artistId }) => {
			route(`/artist/${artistId}`);
		},
	},
	goAlbum: {
		id: 'goAlbum',
		icon: 'disc',
		label: () => 'Go to Album',
		visible: ({ albumId }) => !!albumId,
		run: ({ albumId }) => {
			route(`/album/${albumId}`);
		},
	},
	goTrack: {
		id: 'goTrack',
		icon: 'info',
		label: () => 'Track Details',
		run: ({ entity }) => {
			route(`/track/${entity.id}`);
		},
	},
};

/** Action registry: which actions apply to which entity type, in menu order. */
export const ENTITY_ACTIONS: Record<EntityType, EntityActionId[]> = {
	track: [
		'play',
		'playNext',
		'addToQueue',
		'playlist',
		'rate',
		'favorite',
		'goTrack',
		'goAlbum',
		'goArtist',
	],
	album: ['play', 'playNext', 'addToQueue', 'playlist', 'rate', 'favorite', 'goArtist'],
	artist: ['play', 'playNext', 'addToQueue', 'rate', 'favorite'],
	movie: ['play', 'playNext', 'addToQueue', 'playlist', 'favorite'],
	person: ['favorite'],
};

interface EntityOptionsMenuProps extends Omit<EntityActionContext, 'close'> {
	/** Subset / reorder of the registry's actions for this surface. */
	actions?: EntityActionId[];
	/** Smaller trigger for rows and cards. */
	compact?: boolean;
	class?: string;
}

/**
 * Three-dot menu for any entity, driven by {@link ENTITY_ACTIONS}. Music rows
 * and cards use this; movies keep their richer MovieOptionsMenu.
 */
export function EntityOptionsMenu({
	entity,
	item,
	artistId,
	albumId,
	actions,
	compact,
	class: className,
}: EntityOptionsMenuProps) {
	const { open, setOpen, ref, menuRef, pos } = useMenuOpen();
	const [expanded, setExpanded] = useState<'playlist' | 'rate' | null>(null);
	const [lists, setLists] = useState<Playlist[] | null>(null);
	const [membership, setMembership] = useState<MoviePlaylistInfo[]>([]);
	const [pending, setPending] = useState<string | null>(null);
	const kind = entityMediaKind(entity.type) ?? 'video';

	useEffect(() => {
		if (!open) setExpanded(null);
	}, [open]);

	useEffect(() => {
		if (expanded !== 'playlist') return;
		let cancelled = false;
		Promise.all([ensurePlaylistsLoaded(), getEntityMembership(entity).catch(() => [])])
			.then(([all, member]) => {
				if (cancelled) return;
				setLists(all.filter((p) => playlistKindOf(p) === kind));
				setMembership(member);
			})
			.catch(() => !cancelled && setLists([]));
		return () => {
			cancelled = true;
		};
	}, [expanded, entity.type, entity.id]);

	const ctx: EntityActionContext = {
		entity,
		item,
		artistId,
		albumId,
		close: () => setOpen(false),
	};
	const ids = actions ?? ENTITY_ACTIONS[entity.type] ?? [];
	const visible = ids
		.map((id) => ACTIONS[id])
		.filter((a) => !a.visible || a.visible(ctx))
		.filter((a) => a.id !== 'goTrack' || !!DETAIL_PATH[entity.type]);

	const togglePlaylist = async (p: Playlist) => {
		const isMember = membership.some((m) => m.id === p.id);
		setPending(p.id);
		try {
			if (isMember) {
				await removeEntityFromPlaylist(p.id, entity);
				setMembership((m) => m.filter((x) => x.id !== p.id));
				if (shouldNotifyPlaylist()) notifySuccess(`Removed from ${p.name}`);
			} else {
				await addEntityToPlaylist(p.id, entity);
				setMembership((m) => [...m, { id: p.id, name: p.name }]);
				if (shouldNotifyPlaylist()) notifySuccess(`Added to ${p.name}`);
			}
		} catch {
			notifyError('Failed to update playlist');
		} finally {
			setPending(null);
		}
	};

	const createAndAdd = async () => {
		const name = window.prompt('New playlist name')?.trim();
		if (!name) return;
		try {
			const created = await playlistsService.create(name, '', kind);
			invalidatePlaylists();
			await addEntityToPlaylist(created.id, entity);
			setMembership((m) => [...m, { id: created.id, name: created.name }]);
			setLists((l) => [...(l ?? []), created as unknown as Playlist]);
			notifySuccess(`Added to ${created.name}`);
		} catch {
			notifyError('Failed to create playlist');
		}
	};

	return (
		<div
			class={`${styles.container} ${compact ? styles.compact : ''} ${className ?? ''}`}
			ref={ref}
			onClick={(e: Event) => e.stopPropagation()}
		>
			<button
				type="button"
				class={styles.trigger}
				onClick={(e: Event) => {
					e.stopPropagation();
					e.preventDefault();
					setOpen(!open);
				}}
				aria-label="More options"
				aria-haspopup="menu"
				aria-expanded={open}
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
						role="menu"
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
						{visible.map((a) => {
							const expandable = a.id === 'playlist' || a.id === 'rate';
							const isOpen = expandable && expanded === a.id;
							return (
								<div key={a.id}>
									<button
										type="button"
										role="menuitem"
										class={`${styles.menuItem} ${expandable ? styles.submenuTrigger : ''}`}
										aria-expanded={expandable ? isOpen : undefined}
										onClick={async () => {
											if (expandable) {
												setExpanded(
													isOpen ? null : (a.id as 'playlist' | 'rate'),
												);
												return;
											}
											setOpen(false);
											await a.run?.(ctx);
										}}
									>
										<span class={styles.menuIcon}>
											<Icon
												name={
													a.id === 'favorite' && isFavorited(entity)
														? 'star-filled'
														: a.icon
												}
											/>
										</span>
										<span class={styles.submenuLabel}>{a.label(ctx)}</span>
										{expandable && (
											<span class={styles.submenuChevron} aria-hidden="true">
												<Icon
													name={isOpen ? 'chevron-down' : 'chevron-right'}
												/>
											</span>
										)}
									</button>
									{isOpen && a.id === 'rate' && (
										<div
											class={styles.flyoutItem}
											style={{ padding: '6px 14px' }}
										>
											<EntityRating entity={entity} size="sm" hideSummary />
										</div>
									)}
									{isOpen && a.id === 'playlist' && (
										<div role="group" aria-label="Playlists">
											{lists === null ? (
												<div class={styles.submenuEmpty}>Loading…</div>
											) : (
												<>
													{lists.length === 0 && (
														<div class={styles.submenuEmpty}>
															No playlists yet
														</div>
													)}
													{lists.map((p) => {
														const isMember = membership.some(
															(m) => m.id === p.id,
														);
														return (
															<button
																type="button"
																key={p.id}
																class={`${styles.menuItem} ${styles.flyoutItem}`}
																disabled={pending === p.id}
																onClick={() => togglePlaylist(p)}
															>
																<span
																	class={`${styles.menuIcon} ${styles.submenuCheck}`}
																>
																	{pending === p.id ? (
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
													})}
													<button
														type="button"
														class={`${styles.menuItem} ${styles.flyoutItem}`}
														onClick={createAndAdd}
													>
														<span class={styles.menuIcon}>
															<Icon name="plus" />
														</span>
														<span class={styles.submenuLabel}>
															New playlist…
														</span>
													</button>
												</>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>,
					document.body,
				)}
		</div>
	);
}
