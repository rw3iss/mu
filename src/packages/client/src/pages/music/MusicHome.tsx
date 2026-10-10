import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { EmptyState } from '@/components/common/EmptyState';
import { AlbumCard, MusicRail } from '@/components/music/MusicCards';
import { MusicUploadButton } from '@/components/music/MusicUploadModal';
import { TrackRow } from '@/components/music/TrackRow';
import { type MusicHome as MusicHomeData, musicService } from '@/services/music.service';
import { isAdmin } from '@/state/auth.state';
import { playTracksFrom } from '@/utils/music';
import styles from './MusicHome.module.scss';

interface MusicHomeProps {
	path?: string;
}

/** Music dashboard: continue listening, recently added, most played, favorites. */
export function MusicHome(_props: MusicHomeProps) {
	const [data, setData] = useState<MusicHomeData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		musicService
			.home()
			.then((d) => {
				if (!cancelled) setData(d);
			})
			.catch((err) => {
				if (!cancelled) setError((err as Error)?.message || 'Failed to load music');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const isEmpty =
		!!data &&
		data.recentlyAdded.length === 0 &&
		data.continueListening.length === 0 &&
		data.mostPlayed.length === 0 &&
		data.favorites.length === 0;

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<h1 class={styles.title}>Music</h1>
				<MusicUploadButton />
				{data && !isEmpty && (
					<button
						type="button"
						class={styles.headerLink}
						onClick={() => route('/music/library')}
					>
						Browse library
					</button>
				)}
			</header>

			{loading ? (
				<HomeSkeleton />
			) : error ? (
				<EmptyState
					variant="dashed"
					icon="warning"
					title="Music is unavailable"
					message={error}
				/>
			) : isEmpty || !data ? (
				<EmptyState
					variant="dashed"
					icon="music"
					title="Your music library is empty"
					message={
						isAdmin.value
							? 'Add a folder in Settings → Library → Music Folders and Mu will scan it.'
							: 'Ask an admin to add a music folder in Settings → Library → Music Folders.'
					}
					actionLabel={isAdmin.value ? 'Open Music Folders' : undefined}
					onAction={isAdmin.value ? () => route('/settings/music') : undefined}
				/>
			) : (
				<>
					{data.continueListening.length > 0 && (
						<MusicRail title="Continue listening">
							{data.continueListening.map((a) => (
								<AlbumCard key={a.id} album={a} />
							))}
						</MusicRail>
					)}
					{data.recentlyAdded.length > 0 && (
						<MusicRail
							title="Recently added"
							action={
								<button
									type="button"
									class={styles.headerLink}
									onClick={() =>
										route('/music/library?tab=albums&sort=added&order=desc')
									}
								>
									See all
								</button>
							}
						>
							{data.recentlyAdded.map((a) => (
								<AlbumCard key={a.id} album={a} />
							))}
						</MusicRail>
					)}
					{data.mostPlayed.length > 0 && (
						<section class={styles.section}>
							<h2 class={styles.sectionTitle}>Most played</h2>
							<div class={styles.trackList}>
								{data.mostPlayed.map((t, i) => (
									<TrackRow
										key={t.id}
										track={t}
										index={i + 1}
										showArt
										showAlbum
										onPlay={() => playTracksFrom(data.mostPlayed, i)}
									/>
								))}
							</div>
						</section>
					)}
					{data.favorites.length > 0 && (
						<MusicRail title="Favorites">
							{data.favorites.map((a) => (
								<AlbumCard key={a.id} album={a} />
							))}
						</MusicRail>
					)}
				</>
			)}
		</div>
	);
}

function HomeSkeleton() {
	return (
		<div aria-hidden="true">
			{[0, 1].map((r) => (
				<div key={r} class={styles.skeletonRail}>
					<div class={`${styles.skeletonTitle} skeleton`} />
					<div class={styles.skeletonRow}>
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} class={`${styles.skeletonTile} skeleton`} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}
