import { resolveDisplayName } from '@mu/shared';
import type { ComponentChildren } from 'preact';
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
	// One shared view mode for all three columns (was per-section).
	const [view, setView] = useUiSetting<ViewMode>('dashboard_view', 'grid');

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
	// One card per column in grid view; list view renders short rows.
	const gridColumns = view === 'grid' ? 1 : undefined;

	return (
		<div class={`${styles.dashboard} stagger-rise`}>
			<PluginSlot name={UI.DASHBOARD_TOP} context={{}} />

			{/* Welcome row: greeting on the left, view toggle + nav on the right. */}
			<div class={styles.welcomeRow}>
				<p class={styles.welcomeText}>
					Welcome back
					{user && (
						<>
							, <span class={styles.welcomeUser}>{resolveDisplayName(user)}</span>
						</>
					)}
				</p>
				<div class={styles.welcomeActions}>
					<div class={styles.viewToggle} role="group" aria-label="Dashboard view">
						<Tooltip label="Cards">
							<button
								class={`${styles.viewBtn} ${view === 'grid' ? styles.active : ''}`}
								onClick={() => setView('grid')}
								aria-label="Card view"
								aria-pressed={view === 'grid'}
							>
								<Icon name="view-grid" size={14} />
							</button>
						</Tooltip>
						<Tooltip label="Rows">
							<button
								class={`${styles.viewBtn} ${view === 'list' ? styles.active : ''}`}
								onClick={() => setView('list')}
								aria-label="Row view"
								aria-pressed={view === 'list'}
							>
								<Icon name="view-list" size={14} />
							</button>
						</Tooltip>
					</div>
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
			</div>

			{/* Three columns: Continue Watching · Recently Added · Trending. */}
			<div class={styles.columns}>
				<DashColumn title="Continue Watching" onSeeAll={() => route('/history')}>
					<MovieGrid
						movies={continueWatching}
						isLoading={isLoading}
						viewMode={view}
						gridColumns={gridColumns}
						emptyMessage="Nothing in progress yet"
					/>
				</DashColumn>

				<DashColumn title="Recently Added" onSeeAll={() => route('/library')}>
					<MovieGrid
						movies={recentlyAdded}
						isLoading={isLoading}
						viewMode={view}
						gridColumns={gridColumns}
						emptyMessage="No movies in your library yet"
					/>
				</DashColumn>

				<DashColumn title="Trending" onSeeAll={() => route('/discover')}>
					<MovieGrid
						movies={trending}
						isLoading={isLoading}
						viewMode={view}
						gridColumns={gridColumns}
						emptyMessage="Nothing trending yet"
					/>
				</DashColumn>
			</div>

			<PluginSlot name={UI.DASHBOARD_BOTTOM} context={{}} />
		</div>
	);
}

/** One dashboard column: a titled section with a "See All" link and its body. */
function DashColumn({
	title,
	onSeeAll,
	children,
}: {
	title: string;
	onSeeAll: () => void;
	children: ComponentChildren;
}) {
	return (
		<section class={styles.column}>
			<div class={styles.sectionHeader}>
				<h2 class={styles.sectionTitle}>{title}</h2>
				<Button variant="ghost" size="sm" onClick={onSeeAll}>
					See All
				</Button>
			</div>
			{children}
		</section>
	);
}
