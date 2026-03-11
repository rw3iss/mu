import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import type { MoviePlaylistInfo, Playlist } from '@/services/playlists.service';
import { playlistsService } from '@/services/playlists.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './MoviePlaylists.module.scss';

function shouldNotifyPlaylist(): boolean {
	const stored = localStorage.getItem('mu_notify_playlist');
	return stored !== 'false';
}

interface MoviePlaylistsProps {
	movieId: string;
}

export function MoviePlaylists({ movieId }: MoviePlaylistsProps) {
	const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([]);
	const [memberPlaylists, setMemberPlaylists] = useState<MoviePlaylistInfo[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setIsLoading(true);
			try {
				const [all, member] = await Promise.all([
					playlistsService.list(),
					playlistsService.getByMovie(movieId),
				]);
				if (!cancelled) {
					setAllPlaylists(all);
					setMemberPlaylists(member);
				}
			} catch {
				notifyError('Failed to load playlists');
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, [movieId]);

	const memberIds = new Set(memberPlaylists.map((p) => p.id));
	const availablePlaylists = allPlaylists.filter((p) => !memberIds.has(p.id));

	const handleAdd = async (e: Event) => {
		const select = e.target as HTMLSelectElement;
		const playlistId = select.value;
		if (!playlistId) return;

		select.value = '';
		try {
			await playlistsService.addMovie(playlistId, movieId);
			const playlist = allPlaylists.find((p) => p.id === playlistId);
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
			await playlistsService.removeMovie(playlistId, movieId);
			setMemberPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
			if (shouldNotifyPlaylist()) notifySuccess(`Removed from ${playlistName}`);
		} catch {
			notifyError('Failed to remove from playlist');
		}
	};

	if (isLoading) return null;

	return (
		<div class={styles.playlistsSection}>
			<h2 class={styles.sectionTitle}>Playlists</h2>

			{allPlaylists.length === 0 ? (
				<span class={styles.noPlaylists}>No playlists yet</span>
			) : (
				<select
					class={styles.playlistSelect}
					onChange={handleAdd}
					value=""
					disabled={availablePlaylists.length === 0}
				>
					<option value="" disabled>
						{availablePlaylists.length === 0
							? 'In all playlists'
							: 'Add to playlist...'}
					</option>
					{availablePlaylists.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
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
								{'\u2715'}
							</button>
						</a>
					))}
				</div>
			)}
		</div>
	);
}
