import { type EntityRef, entityMediaKind } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import styles from '@/components/movie/MoviePlaylists.module.scss';
import {
	type MoviePlaylistInfo,
	type Playlist,
	playlistKindOf,
} from '@/services/playlists.service';
import { notifyError, notifySuccess, shouldNotifyPlaylist } from '@/state/notifications.state';
import {
	addEntityToPlaylist,
	addMovieToPlaylist,
	ensurePlaylistsLoaded,
	getEntityMembership,
	playlists as playlistsSignal,
	removeEntityFromPlaylist,
} from '@/state/playlists.state';

export interface EntityPlaylistsProps {
	/** The item (movie / track / album / artist). Not `ref` — Preact reserves it. */
	entity: EntityRef;
	/** Remote-server movie metadata (movies only). */
	remoteInfo?: { title: string; posterUrl?: string; serverId: string };
	/** Called when the member playlist count changes, so parent can show count in header. */
	onCountChange?: (count: number) => void;
	/** If true, hide the built-in section title (parent manages it). */
	hideTitle?: boolean;
}

/**
 * Playlist membership for any entity: an "Add to playlist…" picker (filtered
 * to playlists of the entity's kind — video vs audio) plus the list of
 * playlists it already belongs to, each removable.
 */
export function EntityPlaylists({
	entity,
	remoteInfo,
	onCountChange,
	hideTitle,
}: EntityPlaylistsProps) {
	const kind = entityMediaKind(entity.type) ?? 'video';
	const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([]);
	const [memberPlaylists, setMemberPlaylists] = useState<MoviePlaylistInfo[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const key = `${entity.type}:${entity.id}`;

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setIsLoading(true);
			try {
				const [all, member] = await Promise.all([
					ensurePlaylistsLoaded(),
					getEntityMembership(entity),
				]);
				if (!cancelled) {
					setAllPlaylists(all);
					setMemberPlaylists(member);
				}
			} catch {
				if (!cancelled) notifyError('Failed to load playlists');
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		load();

		// Mirror cache updates from elsewhere (options menu, CRUD page).
		const unsub = playlistsSignal.subscribe((v) => {
			if (!cancelled && v) setAllPlaylists(v);
		});

		return () => {
			cancelled = true;
			unsub();
		};
	}, [key]);

	useEffect(() => {
		onCountChange?.(memberPlaylists.length);
	}, [memberPlaylists.length, onCountChange]);

	const memberIds = new Set(memberPlaylists.map((p) => p.id));
	const ofKind = allPlaylists.filter((p) => playlistKindOf(p) === kind);
	const availablePlaylists = ofKind.filter((p) => !memberIds.has(p.id));

	const handleAdd = async (playlistId: string) => {
		if (!playlistId) return;
		const playlist = allPlaylists.find((p) => p.id === playlistId);
		try {
			if (entity.type === 'movie' && remoteInfo) {
				await addMovieToPlaylist(playlistId, entity.id, remoteInfo);
			} else {
				await addEntityToPlaylist(playlistId, entity);
			}
			if (playlist) {
				setMemberPlaylists((prev) => [...prev, { id: playlist.id, name: playlist.name }]);
			}
			if (shouldNotifyPlaylist()) notifySuccess(`Added to ${playlist?.name ?? 'playlist'}`);
		} catch {
			notifyError('Failed to add to playlist');
		}
	};

	const handleRemove = async (playlistId: string, playlistName: string) => {
		try {
			await removeEntityFromPlaylist(playlistId, entity);
			setMemberPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
			if (shouldNotifyPlaylist()) notifySuccess(`Removed from ${playlistName}`);
		} catch {
			notifyError('Failed to remove from playlist');
		}
	};

	if (isLoading) return null;

	return (
		<div class={styles.playlistsSection}>
			{!hideTitle && <h2 class={styles.sectionTitle}>Playlists</h2>}

			{ofKind.length === 0 ? (
				<span class={styles.noPlaylists}>No playlists yet</span>
			) : (
				<Select
					value=""
					onChange={handleAdd}
					disabled={availablePlaylists.length === 0}
					placeholder={
						availablePlaylists.length === 0 ? 'In all playlists' : 'Add to playlist…'
					}
					options={availablePlaylists.map((p) => ({ value: p.id, label: p.name }))}
				/>
			)}

			{memberPlaylists.length > 0 && (
				<div class={styles.playlistList}>
					{memberPlaylists.map((p) => (
						<a
							key={p.id}
							class={styles.playlistItem}
							href={`/playlists/${p.id}`}
							onClick={(e: Event) => {
								e.preventDefault();
								route(`/playlists/${p.id}`);
							}}
						>
							<span class={styles.playlistName}>{p.name}</span>
							<button
								class={styles.removeBtn}
								onClick={(e: Event) => {
									e.preventDefault();
									e.stopPropagation();
									handleRemove(p.id, p.name);
								}}
								aria-label={`Remove from ${p.name}`}
							>
								<Icon name="x" size={12} />
							</button>
						</a>
					))}
				</div>
			)}
		</div>
	);
}
