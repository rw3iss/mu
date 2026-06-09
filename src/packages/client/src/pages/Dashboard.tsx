import { resolveDisplayName } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Tooltip } from '@/components/common/Tooltip';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { useUiSetting } from '@/hooks/useUiSetting';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { moviesService } from '@/services/movies.service';
import { currentUser } from '@/state/auth.state';
import type { Movie, ViewMode } from '@/state/library.state';
import { notifyError } from '@/state/notifications.state';
import { newTabNav } from '@/utils/navigation';
import styles from './Dashboard.module.scss';

interface DashboardProps {
	path?: string;
}

export function Dashboard(_props: DashboardProps) {
	const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
	const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
	const [trending, setTrending] = useState<Movie[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [cwView, setCwView] = useUiSetting<ViewMode>('dashboard_cw_view', 'grid');

	useEffect(() => {
		async function load() {
			setIsLoading(true);
			try {
				const [cwRes, raRes, trRes] = await Promise.allSettled([
					moviesService.getContinueWatching(),
					moviesService.getRecentlyAdded(12),
					moviesService.getTrending(12),
				]);

				const failed: string[] = [];
				if (cwRes.status === 'fulfilled') setContinueWatching(cwRes.value.movies);
				else failed.push('Continue Watching');
				if (raRes.status === 'fulfilled') setRecentlyAdded(raRes.value.movies);
				else failed.push('Recently Added');
				if (trRes.status === 'fulfilled') setTrending(trRes.value.movies);
				else failed.push('Trending');

				if (failed.length > 0) {
					console.error('Dashboard sections failed:', failed);
					notifyError(`Couldn't load ${failed.join(', ')}. Try refreshing.`);
				}
			} catch (error) {
				console.error('Failed to load dashboard:', error);
				notifyError('Failed to load the dashboard. Try refreshing.');
			} finally {
				setIsLoading(false);
			}
		}

		load();
	}, []);

	const user = currentUser.value;

	return (
		<div class={`${styles.dashboard} stagger-rise`}>
			<PluginSlot name={UI.DASHBOARD_TOP} context={{}} />

			{/* Compact welcome row: single-line text + inline link buttons.
			    Mobile hides the inline buttons (the bottom nav already has
			    Library + Discover tabs). */}
			<div class={styles.welcomeRow}>
				<p class={styles.welcomeText}>
					Welcome back
					{user && (
						<>
							, <span class={styles.welcomeUser}>{resolveDisplayName(user)}</span>
						</>
					)}
				</p>
				<span class={styles.welcomeLinks}>
					<button
						class={styles.welcomeLink}
						{...newTabNav('/library', () => route('/library'))}
					>
						Browse Library
					</button>
					<button
						class={styles.welcomeLink}
						{...newTabNav('/discover', () => route('/discover'))}
					>
						Discover
					</button>
				</span>
			</div>

			{/* Continue Watching */}
			{continueWatching.length > 0 && (
				<section class={styles.section}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>Continue Watching</h2>
						<div class={styles.sectionActions}>
							<div
								class={styles.viewToggle}
								role="group"
								aria-label="Continue watching view"
							>
								<Tooltip label="Grid">
									<button
										class={`${styles.viewBtn} ${cwView === 'grid' ? styles.active : ''}`}
										onClick={() => setCwView('grid')}
										aria-label="Grid view"
										aria-pressed={cwView === 'grid'}
									>
										<Icon name="view-grid" size={14} />
									</button>
								</Tooltip>
								<Tooltip label="List">
									<button
										class={`${styles.viewBtn} ${cwView === 'list' ? styles.active : ''}`}
										onClick={() => setCwView('list')}
										aria-label="List view"
										aria-pressed={cwView === 'list'}
									>
										<Icon name="view-list" size={14} />
									</button>
								</Tooltip>
							</div>
							<Button variant="ghost" size="sm" onClick={() => route('/history')}>
								See All
							</Button>
						</div>
					</div>
					<MovieGrid movies={continueWatching} isLoading={isLoading} viewMode={cwView} />
				</section>
			)}

			{/* Recently Added */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h2 class={styles.sectionTitle}>Recently Added</h2>
					<Button variant="ghost" size="sm" onClick={() => route('/library')}>
						See All
					</Button>
				</div>
				<MovieGrid
					movies={recentlyAdded}
					isLoading={isLoading}
					emptyMessage="No movies in your library yet"
				/>
			</section>

			{/* Trending */}
			{trending.length > 0 && (
				<section class={styles.section}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>Trending</h2>
						<Button variant="ghost" size="sm" onClick={() => route('/discover')}>
							See All
						</Button>
					</div>
					<MovieGrid movies={trending} isLoading={isLoading} />
				</section>
			)}

			<PluginSlot name={UI.DASHBOARD_BOTTOM} context={{}} />
		</div>
	);
}
