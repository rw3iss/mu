import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { moviesService } from '@/services/movies.service';
import { currentUser } from '@/state/auth.state';
import type { Movie } from '@/state/library.state';
import styles from './Dashboard.module.scss';

interface DashboardProps {
	path?: string;
}

export function Dashboard(_props: DashboardProps) {
	const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
	const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
	const [trending, setTrending] = useState<Movie[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		async function load() {
			setIsLoading(true);
			try {
				const [cwRes, raRes, trRes] = await Promise.allSettled([
					moviesService.getContinueWatching(),
					moviesService.getRecentlyAdded(12),
					moviesService.getTrending(12),
				]);

				if (cwRes.status === 'fulfilled') setContinueWatching(cwRes.value.movies);
				if (raRes.status === 'fulfilled') setRecentlyAdded(raRes.value.movies);
				if (trRes.status === 'fulfilled') setTrending(trRes.value.movies);
			} catch (error) {
				console.error('Failed to load dashboard:', error);
			} finally {
				setIsLoading(false);
			}
		}

		load();
	}, []);

	const user = currentUser.value;

	return (
		<div class={styles.dashboard}>
			<PluginSlot name={UI.DASHBOARD_TOP} context={{}} />

			{/* Hero Section */}
			<section class={styles.hero}>
				<div class={styles.heroContent}>
					<h1 class={styles.heroTitle}>Welcome back{user ? `, ${user.username}` : ''}</h1>
					<p class={styles.heroSubtitle}>Your personal movie library awaits</p>
					<div class={styles.heroActions}>
						<Button variant="primary" size="lg" onClick={() => route('/library')}>
							Browse Library
						</Button>
						<Button variant="secondary" size="lg" onClick={() => route('/discover')}>
							Discover
						</Button>
					</div>
				</div>
			</section>

			{/* Continue Watching */}
			{continueWatching.length > 0 && (
				<section class={styles.section}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>Continue Watching</h2>
						<Button variant="ghost" size="sm" onClick={() => route('/history')}>
							See All
						</Button>
					</div>
					<MovieGrid movies={continueWatching} isLoading={isLoading} />
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
