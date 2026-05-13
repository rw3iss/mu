import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { DiscoverFilters as FilterPanel } from '@/components/discover/DiscoverFilters';
import { DiscoverResultCard } from '@/components/discover/DiscoverResultCard';
import { SeedChip } from '@/components/discover/SeedChip';
import { moviesService } from '@/services/movies.service';
import {
	clearFilters,
	clearSeeds,
	errorMessage,
	filters,
	isLoading,
	removeSeed,
	results,
	runDiscover,
	seedLabels,
	seedMovieIds,
	setFilters,
	setSeed,
	usedSources,
} from '@/state/discover.state';
import styles from './Discover.module.scss';

interface DiscoverProps {
	path?: string;
}

/**
 * Discover / Recommendations page. Three modes:
 *   - No seed → personalised, based on the user's taste profile.
 *   - One seed movie → "similar to X" with optional filters.
 *   - Multiple seeds → multi-input (variance-aware centroid vs
 *     union-of-neighbours), used by collection / group flows.
 *
 * Seed + filter state lives in `discover.state`. URL query params
 * (`?seedMovieId=`, `?seedMovieIds=`) populate state on first mount.
 */
export function Discover(_props: DiscoverProps) {
	const [genres, setGenres] = useState<string[]>([]);
	const [showFilters, setShowFilters] = useState(true);

	// On mount: parse URL params, load genres.
	useEffect(() => {
		const url = new URL(window.location.href);
		const seedId = url.searchParams.get('seedMovieId');
		const seedIds = url.searchParams.get('seedMovieIds');
		const seedLabel = url.searchParams.get('seedLabel');

		if (seedId) {
			setSeed(seedId, seedLabel ?? undefined);
		} else if (seedIds) {
			const ids = seedIds.split(',').filter(Boolean);
			if (ids.length > 0) {
				seedMovieIds.value = ids;
			}
		}

		moviesService.getGenres().then(setGenres).catch(() => setGenres([]));
		runDiscover();
	}, []);

	// Re-fetch whenever seeds or filters change.
	useEffect(() => {
		const dispose = seedMovieIds.subscribe(() => runDiscover());
		const dispose2 = filters.subscribe(() => runDiscover());
		return () => {
			dispose();
			dispose2();
		};
	}, []);

	const list = results.value;
	const loading = isLoading.value;
	const err = errorMessage.value;
	const seeds = seedMovieIds.value;
	const seedLabelMap = seedLabels.value;
	const filterValue = filters.value;

	const headerTitle =
		seeds.length === 0
			? 'For you'
			: seeds.length === 1
				? `Similar to ${seedLabelMap[seeds[0]!] ?? 'your selection'}`
				: `Similar to your ${seeds.length} selections`;

	const headerSubtitle =
		seeds.length === 0
			? 'Recommendations from your taste profile — rated and watched movies.'
			: 'Based on shared cast, genres, plot, and external recommendation data.';

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<div>
					<h1 class={styles.title}>{headerTitle}</h1>
					<p class={styles.subtitle}>{headerSubtitle}</p>
				</div>
				<div class={styles.headerActions}>
					{usedSources.value.length > 0 && (
						<span class={styles.sourcesBadge} title="Active recommendation sources">
							{usedSources.value.join(' · ')}
						</span>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setShowFilters((v) => !v)}
					>
						{showFilters ? 'Hide filters' : 'Show filters'}
					</Button>
				</div>
			</header>

			{seeds.length > 0 && (
				<div class={styles.seedRow}>
					{seeds.map((id) => (
						<SeedChip
							key={id}
							label={seedLabelMap[id] ?? id.slice(0, 8)}
							onRemove={() => removeSeed(id)}
						/>
					))}
					<button class={styles.clearLink} onClick={clearSeeds}>
						Clear seed{seeds.length > 1 ? 's' : ''}
					</button>
				</div>
			)}

			<div class={styles.layout}>
				{showFilters && (
					<aside class={styles.sidebar}>
						<FilterPanel
							value={filterValue}
							availableGenres={genres}
							onChange={setFilters}
							onClear={clearFilters}
						/>
					</aside>
				)}

				<main class={`${styles.main} ${!showFilters ? styles.mainFull : ''}`}>
					{loading && list.length === 0 ? (
						<div class={styles.loading}>
							<Spinner size="lg" />
						</div>
					) : err ? (
						<div class={styles.error}>
							<p>{err}</p>
							<Button onClick={() => runDiscover()}>Retry</Button>
						</div>
					) : list.length === 0 ? (
						<div class={styles.empty}>
							<p>No recommendations yet.</p>
							<p class={styles.emptyHint}>
								{seeds.length === 0
									? 'Rate or watch a few movies in your library, then revisit this page.'
									: 'Try loosening your filters, or pick a different seed.'}
							</p>
						</div>
					) : (
						<div class={styles.grid}>
							{list.map((movie) => (
								<DiscoverResultCard key={movie.movieId} movie={movie} />
							))}
						</div>
					)}
				</main>
			</div>
		</div>
	);
}
