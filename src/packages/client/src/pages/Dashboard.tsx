import { resolveDisplayName } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Tooltip } from '@/components/common/Tooltip';
import { HorizontalMoviePager } from '@/components/movie/HorizontalMoviePager';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { useUiSetting } from '@/hooks/useUiSetting';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { moviesService, type NewTitleStats } from '@/services/movies.service';
import { wsService } from '@/services/websocket.service';
import { currentUser } from '@/state/auth.state';
import type { Movie, ViewMode } from '@/state/library.state';
import { notifyError } from '@/state/notifications.state';
import { newTabNav } from '@/utils/navigation';
import styles from './Dashboard.module.scss';

interface DashboardProps {
	path?: string;
}

/**
 * Build the dashboard header growth line. Prefers "since your last session"
 * (gated on > 0) with the rolling 24h count in parentheses; falls back to a
 * 24h-only line. Returns null when there's nothing new to report.
 */
function formatNewTitles(stats: NewTitleStats | null): string | null {
	if (!stats) return null;
	const { sinceSession, last24h } = stats;
	const titles = (n: number) => `${n} new ${n === 1 ? 'title' : 'titles'}`;
	if (sinceSession > 0) {
		const tail = last24h > 0 ? ` (${last24h} in the last 24 hours)` : '';
		return `${titles(sinceSession)} added since your last session${tail}.`;
	}
	if (last24h > 0) return `${titles(last24h)} added in the last 24 hours.`;
	return null;
}

export function Dashboard(_props: DashboardProps) {
	const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
	const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
	const [trending, setTrending] = useState<Movie[]>([]);
	const [newStats, setNewStats] = useState<NewTitleStats | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	// One shared view mode for all three columns (was per-section).
	const [view, setView] = useUiSetting<ViewMode>('dashboard_view', 'grid');
	// Which section is shown in single-column / mobile mode (tab selector).
	const [activeTab, setActiveTab] = useState(0);

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

	// Library-growth stat for the header ("new since your last session"). Loaded
	// independently (lightly cached in the service) so it never blocks the feeds.
	useEffect(() => {
		moviesService
			.getNewStats()
			.then(setNewStats)
			.catch(() => {});
	}, []);

	// Keep "Continue Watching" live: refresh it whenever this user's watch status
	// changes (a movie finishes playing, or is marked watched/unwatched).
	useEffect(() => {
		wsService.subscribe('watch');
		wsService.subscribe('stream');
		let timer: ReturnType<typeof setTimeout> | null = null;
		const refresh = (data: unknown) => {
			const uid = (data as { userId?: string } | null)?.userId;
			const me = currentUser.value?.id;
			if (uid && me && uid !== me) return; // ignore other users' changes
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				moviesService
					.getContinueWatching()
					.then((r) => setContinueWatching(r.movies))
					.catch(() => {});
			}, 250);
		};
		wsService.on('watch:status-changed', refresh);
		wsService.on('stream:ended', refresh);
		return () => {
			if (timer) clearTimeout(timer);
			wsService.off('watch:status-changed', refresh);
			wsService.off('stream:ended', refresh);
		};
	}, []);

	const user = currentUser.value;

	const sections = [
		{
			key: 'cw',
			title: 'Continue Watching',
			icon: 'play' as const,
			seeAll: '/history',
			movies: continueWatching,
			empty: 'Nothing in progress yet',
			area: styles.areaCw,
			// Renders as a horizontal scrolling rail rather than a vertical grid.
			horizontal: true,
		},
		{
			key: 'ra',
			title: 'Recently Added',
			icon: 'list-plus' as const,
			seeAll: '/library',
			movies: recentlyAdded,
			empty: 'No movies in your library yet',
			area: styles.areaRa,
			horizontal: false,
		},
		{
			key: 'tr',
			title: 'Trending',
			icon: 'arrow-up-right' as const,
			seeAll: '/discover',
			movies: trending,
			empty: 'Nothing trending yet',
			area: styles.areaTrending,
			horizontal: false,
		},
	];

	const newTitlesMessage = formatNewTitles(newStats);

	return (
		<div class={`${styles.dashboard} stagger-rise`}>
			<PluginSlot name={UI.DASHBOARD_TOP} context={{}} />

			{/* Welcome row: greeting on the left, view toggle + nav on the right. */}
			<div class={styles.welcomeRow}>
				<div class={styles.welcomeGreeting}>
					<p class={styles.welcomeText}>
						Welcome back
						{user && (
							<>
								, <span class={styles.welcomeUser}>{resolveDisplayName(user)}</span>
							</>
						)}
					</p>
					{newTitlesMessage && <p class={styles.welcomeStat}>{newTitlesMessage}</p>}
				</div>
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

			{/* Three columns (Continue Watching · Recently Added · Trending). In
			    single-column mode the tab bar picks which one is visible. The
			    layout is driven by the container width, not the viewport, so it
			    stays correct regardless of the sidebar. */}
			<div class={styles.columnsWrap}>
				<div class={styles.tabs} role="tablist" aria-label="Dashboard sections">
					{sections.map((s, i) => (
						<button
							key={s.key}
							class={`${styles.tab} ${activeTab === i ? styles.tabActive : ''}`}
							onClick={() => setActiveTab(i)}
							role="tab"
							aria-selected={activeTab === i}
						>
							<Icon name={s.icon} size={16} />
							<span>{s.title}</span>
						</button>
					))}
				</div>

				<div class={styles.columns}>
					{sections.map((s, i) => (
						<section
							key={s.key}
							class={`${styles.column} ${s.area} ${activeTab === i ? styles.activeColumn : ''}`}
						>
							<div class={styles.sectionHeader}>
								<h2 class={styles.sectionTitle}>{s.title}</h2>
								<Button variant="ghost" size="sm" onClick={() => route(s.seeAll)}>
									See All
								</Button>
							</div>
							<div
								class={`${styles.columnBody} ${s.horizontal ? styles.columnBodyHorizontal : ''}`}
							>
								{!s.horizontal && <div class={styles.fade} aria-hidden="true" />}
								{s.horizontal ? (
									<HorizontalMoviePager
										movies={s.movies}
										isLoading={isLoading}
										emptyMessage={s.empty}
									/>
								) : (
									<MovieGrid
										movies={s.movies}
										isLoading={isLoading}
										viewMode={view}
										emptyMessage={s.empty}
									/>
								)}
							</div>
						</section>
					))}
				</div>
			</div>

			<PluginSlot name={UI.DASHBOARD_BOTTOM} context={{}} />
		</div>
	);
}
