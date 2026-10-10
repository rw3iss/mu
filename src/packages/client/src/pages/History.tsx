import type { AlbumSummary, TrackSummary } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { AlbumCard, CardGrid } from '@/components/music/MusicCards';
import { TrackRow } from '@/components/music/TrackRow';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import { musicService } from '@/services/music.service';
import { browseMode } from '@/state/browseMode.state';
import {
	clearHistoryCache,
	fetchHistory,
	historyEntries,
	historyLoading,
} from '@/state/history.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { playTracksFrom } from '@/utils/music';
import styles from './History.module.scss';

interface HistoryProps {
	path?: string;
}

export function History(_props: HistoryProps) {
	return browseMode.value === 'music' ? <MusicHistory /> : <MovieHistory />;
}

/**
 * Listening history in music mode: recently played albums + most played
 * tracks, from the music home summary (`/music/home`).
 */
function MusicHistory() {
	const [recent, setRecent] = useState<AlbumSummary[] | null>(null);
	const [top, setTop] = useState<TrackSummary[]>([]);

	useEffect(() => {
		musicService
			.home()
			.then((h) => {
				setRecent(h.continueListening);
				setTop(h.mostPlayed);
			})
			.catch(() => setRecent([]));
	}, []);

	const empty = recent !== null && recent.length === 0 && top.length === 0;

	return (
		<div class={styles.history}>
			<div class={styles.header}>
				<div>
					<h1 class={styles.title}>Listening History</h1>
				</div>
			</div>
			{recent === null ? null : empty ? (
				<EmptyState
					variant="dashed"
					icon="music"
					title="Nothing played yet"
					message="Albums and tracks you listen to will show up here."
				/>
			) : (
				<>
					{recent.length > 0 && (
						<section class={styles.musicSection}>
							<h2 class={styles.sectionTitle}>Recently played</h2>
							<CardGrid>
								{recent.map((a) => (
									<AlbumCard key={a.id} album={a} />
								))}
							</CardGrid>
						</section>
					)}
					{top.length > 0 && (
						<section class={styles.musicSection}>
							<h2 class={styles.sectionTitle}>Most played</h2>
							{top.map((t, i) => (
								<TrackRow
									key={t.id}
									track={t}
									index={i + 1}
									showArt
									showAlbum
									onPlay={() => playTracksFrom(top, i)}
								/>
							))}
						</section>
					)}
				</>
			)}
		</div>
	);
}

function MovieHistory() {
	// Always fetch fresh data from the server when the page mounts.
	// This replaces the cache with the authoritative server state,
	// while in-session updates via pushToHistory keep it current between visits.
	useEffect(() => {
		fetchHistory();
	}, []);

	const movies = historyEntries.value ?? [];
	const isLoading = historyLoading.value && movies.length === 0;

	async function handleClearHistory() {
		try {
			await api.delete('/history');
			clearHistoryCache();
			notifySuccess('Watch history cleared');
		} catch {
			notifyError('Failed to clear history');
		}
	}

	return (
		<div class={styles.history}>
			<div class={styles.header}>
				<div>
					<h1 class={styles.title}>Watch History</h1>
					{movies.length > 0 && (
						<span class={styles.count}>
							{movies.length} {movies.length === 1 ? 'movie' : 'movies'}
						</span>
					)}
				</div>
				{movies.length > 0 && (
					<Button variant="ghost" size="sm" onClick={handleClearHistory}>
						Clear History
					</Button>
				)}
			</div>

			<MovieGrid
				movies={movies}
				isLoading={isLoading}
				emptyMessage="No watch history yet. Start watching movies to see them here."
			/>

			<PluginSlot name={UI.HISTORY_BOTTOM} context={{}} />
		</div>
	);
}
