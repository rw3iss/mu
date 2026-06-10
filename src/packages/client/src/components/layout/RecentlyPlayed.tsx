import { useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { getUiSetting, useUiSetting } from '@/hooks/useUiSetting';
import { currentUser } from '@/state/auth.state';
import { playMovie } from '@/state/globalPlayer.state';
import { fetchHistory, historyEntries } from '@/state/history.state';
import { newTabNav } from '@/utils/navigation';
import styles from './RecentlyPlayed.module.scss';

const MAX_ITEMS = 20;

export function RecentlyPlayed() {
	const [collapsed, setCollapsed] = useUiSetting('recently_played_collapsed', false);
	const showSetting = getUiSetting('show_recently_played', true);
	// Re-fetch when the logged-in user changes so we never render the previous
	// user's history (logout/login resets the cache to null; this refills it).
	const userId = currentUser.value?.id;

	useEffect(() => {
		if (showSetting && userId && !historyEntries.value) {
			fetchHistory();
		}
	}, [showSetting, userId]);

	if (!showSetting) return null;

	const entries = historyEntries.value;
	if (!entries || entries.length === 0) return null;

	const items = entries.slice(0, MAX_ITEMS);

	return (
		<div class={`${styles.recentlyPlayed} ${collapsed ? styles.isCollapsed : ''}`}>
			<button
				class={`${styles.toggleBtn} ${collapsed ? styles.collapsed : ''}`}
				onClick={() => setCollapsed(!collapsed)}
				title={collapsed ? 'Show recently played' : 'Hide recently played'}
			>
				<span class={styles.toggleLabel}>RECENT</span>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="6 15 12 9 18 15" />
				</svg>
			</button>

			{!collapsed && (
				<div class={styles.list}>
					{items.map((movie) => (
						<button
							key={movie.id}
							class={styles.item}
							{...newTabNav(`/movie/${movie.id}`, () => route(`/movie/${movie.id}`))}
						>
							<div class={styles.poster}>
								{movie.posterUrl ? (
									<img src={movie.posterUrl} alt={movie.title} loading="lazy" />
								) : (
									<div class={styles.posterPlaceholder} />
								)}
							</div>
							<div class={styles.info}>
								<span class={styles.title}>{movie.title}</span>
								{movie.year > 0 && <span class={styles.year}>{movie.year}</span>}
							</div>
							{/* Watch-position bar along the bottom of the row */}
							{(movie.watchPosition ?? 0) > 0 && (movie.durationSeconds ?? 0) > 0 && (
								<div class={styles.progressTrack}>
									<div
										class={styles.progressFill}
										style={{
											width: `${Math.min(100, ((movie.watchPosition ?? 0) / (movie.durationSeconds || 1)) * 100)}%`,
										}}
									/>
								</div>
							)}
							{/* Hover tooltip with larger poster */}
							<div class={styles.tooltip}>
								{movie.posterUrl && (
									<img
										src={movie.posterUrl}
										alt=""
										class={styles.tooltipPoster}
									/>
								)}
								<span class={styles.tooltipTitle}>{movie.title}</span>
							</div>
							<button
								class={styles.playBtn}
								onClick={(e) => {
									e.stopPropagation();
									playMovie(movie.id);
								}}
								title="Play"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="currentColor"
									stroke="none"
								>
									<polygon points="5 3 19 12 5 21 5 3" />
								</svg>
							</button>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
