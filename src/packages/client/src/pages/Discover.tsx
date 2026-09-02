import type { MovieSearchHit, PersonSearchHit, SearchHit } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { MovieSearchInput, PersonSearchInput } from '@/components/common/EntitySearchInput';
import { Spinner } from '@/components/common/Spinner';
import { DiscoverFilters as FilterPanel } from '@/components/discover/DiscoverFilters';
import { DiscoverResultCard } from '@/components/discover/DiscoverResultCard';
import { IncludeToggle } from '@/components/discover/IncludeToggle';
import { QuickStartPanel } from '@/components/discover/QuickStartPanel';
import { SeedChip } from '@/components/discover/SeedChip';
import { useSeo } from '@/hooks/useSeo';
import { moviesService } from '@/services/movies.service';
import { wsService } from '@/services/websocket.service';
import {
	addPersonSeed,
	addSeed,
	clearFilters,
	clearSeeds,
	enrichmentsQueued,
	errorMessage,
	filters,
	includeMode,
	isLoading,
	personSeedKeys,
	personSeedLabels,
	removePersonSeed,
	removeSeed,
	restoreDiscoverScroll,
	results,
	runDiscover,
	saveDiscoverScroll,
	scheduleDiscover,
	seedLabels,
	seedMovieIds,
	setFilters,
	setIncludeMode,
	setSeed,
	setUseProfile,
	unresolvedPersonKeys,
	usedSources,
	useProfile,
} from '@/state/discover.state';
import { watchPositions } from '@/state/watchPositions.state';
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
	useSeo({
		title: 'Discover',
		description:
			'Find your next movie — recommendations based on your taste, seeds, and filters.',
		type: 'website',
	});
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

		moviesService
			.getGenres()
			.then(setGenres)
			.catch(() => setGenres([]));
		// Re-fetch then restore scroll once results have rendered. We
		// look at the in-memory results length too — if the user is
		// returning from a movie detail with state already populated,
		// no network call is needed before restoring.
		const restore = restoreDiscoverScroll();
		runDiscover().then(() => {
			if (restore != null) {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => window.scrollTo(0, restore));
				});
			}
		});

		// Save scroll position on unmount so the next /discover mount
		// can put us back where we were.
		return () => {
			saveDiscoverScroll();
		};
	}, []);

	// Re-fetch whenever seeds, person seeds, filters, include mode, or
	// the use-profile flag change. Debounced (~220ms) so typing in
	// the cast/director field doesn't fire a request per keystroke.
	useEffect(() => {
		const dispose = seedMovieIds.subscribe(() => scheduleDiscover());
		const dispose2 = filters.subscribe(() => scheduleDiscover());
		const dispose3 = includeMode.subscribe(() => scheduleDiscover());
		const dispose4 = personSeedKeys.subscribe(() => scheduleDiscover());
		const dispose5 = useProfile.subscribe(() => scheduleDiscover());
		return () => {
			dispose();
			dispose2();
			dispose3();
			dispose4();
			dispose5();
		};
	}, []);

	// Auto-refresh when background external-enrichment jobs finish so
	// freshly-hydrated stubs (ratings, posters, overview) replace the
	// "Enriching…" placeholders without the user clicking Refresh.
	// We re-run only if we had queued enrichments AND the job that
	// just finished is one of ours (type='external-enrichment').
	useEffect(() => {
		const handle = (data: unknown) => {
			const ev = data as { type?: string };
			if (ev?.type !== 'external-enrichment') return;
			if (enrichmentsQueued.value <= 0) return;
			scheduleDiscover();
		};
		wsService.on('job:completed', handle);
		wsService.on('job:failed', handle);
		return () => {
			wsService.off('job:completed', handle);
			wsService.off('job:failed', handle);
		};
	}, []);

	const rawList = results.value;
	const loading = isLoading.value;
	const err = errorMessage.value;
	const seeds = seedMovieIds.value;
	const seedLabelMap = seedLabels.value;
	const filterValue = filters.value;

	// Client-side watch-state filter. The watch positions live in a
	// signal already (hydrated on app init + kept fresh during
	// playback), so this is a free local pass without a server
	// round-trip. "All" / unset → bypass.
	const watched = filterValue.watched ?? 'all';
	const positions = watchPositions.value;
	const list =
		watched === 'all'
			? rawList
			: rawList.filter((m) => {
					const pos = positions[m.movieId];
					if (watched === 'unwatched') return !pos || pos.positionSeconds <= 0;
					if (watched === 'in-progress') return !!pos && pos.positionSeconds > 0;
					if (watched === 'watched') return !!pos && pos.positionSeconds > 0;
					return true;
				});

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
					<button
						type="button"
						class={styles.refreshBtn}
						onClick={() => runDiscover()}
						disabled={loading}
						aria-label="Refresh recommendations"
						title="Refresh with current filters"
					>
						<svg
							class={loading ? styles.refreshSpinning : undefined}
							width={14}
							height={14}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width={2.25}
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M21 12a9 9 0 1 1-3-6.7" />
							<polyline points="21 4 21 10 15 10" />
						</svg>
						<span>Refresh</span>
					</button>
					<IncludeToggle value={includeMode.value} onChange={setIncludeMode} />
					{usedSources.value.length > 0 && (
						<span class={styles.sourcesBadge} title="Active recommendation sources">
							{usedSources.value.join(' · ')}
						</span>
					)}
					<Button variant="ghost" size="sm" onClick={() => setShowFilters((v) => !v)}>
						{showFilters ? 'Hide filters' : 'Show filters'}
					</Button>
				</div>
			</header>

			{enrichmentsQueued.value > 0 && (
				<div class={styles.enrichBanner}>
					Enriching {enrichmentsQueued.value} new candidate
					{enrichmentsQueued.value === 1 ? '' : 's'} in the background. Refresh in a few
					seconds for sharper rankings.
				</div>
			)}

			<div class={styles.seedSearchRow}>
				<MovieSearchInput
					placeholder="Add a movie seed…"
					disabledKeys={seeds}
					onSelect={(hit: SearchHit) => {
						const m = hit as MovieSearchHit;
						const id = m.movieId ?? (m.tmdbId ? `tmdb:${m.tmdbId}` : null);
						if (id) addSeed(id, m.title);
					}}
				/>
				<PersonSearchInput
					placeholder="Add a person seed (cast, director, …)"
					disabledKeys={personSeedKeys.value}
					onSelect={(hit: SearchHit) => {
						const p = hit as PersonSearchHit;
						addPersonSeed(p.personKey, p.name);
					}}
				/>
			</div>

			<div class={styles.seedRow}>
				{seeds.map((id) => (
					<SeedChip
						key={id}
						kind="movie"
						label={seedLabelMap[id] ?? id.slice(0, 8)}
						onRemove={() => removeSeed(id)}
					/>
				))}
				{personSeedKeys.value.map((key) => (
					<SeedChip
						key={key}
						kind="person"
						label={personSeedLabels.value[key] ?? key}
						onRemove={() => removePersonSeed(key)}
					/>
				))}
				{(seeds.length > 0 || personSeedKeys.value.length > 0) && (
					<button class={styles.clearLink} onClick={clearSeeds}>
						Clear seed{seeds.length + personSeedKeys.value.length > 1 ? 's' : ''}
					</button>
				)}
			</div>

			{unresolvedPersonKeys.value.length > 0 && (
				<div class={styles.enrichBanner}>
					Couldn't find library credits for{' '}
					{unresolvedPersonKeys.value
						.map((k) => personSeedLabels.value[k] ?? k)
						.join(', ')}
					. Add at least one of their films to use them as a seed.
				</div>
			)}

			<div class={styles.layout}>
				{showFilters && (
					<aside class={styles.sidebar}>
						<button
							type="button"
							class={`${styles.profileToggle} ${useProfile.value ? styles.profileToggleActive : ''}`}
							onClick={() => setUseProfile(!useProfile.value)}
							aria-pressed={useProfile.value}
							title={
								useProfile.value
									? 'Recommendations include your favorites, ratings, and watch history'
									: 'Recommendations ignore your profile — filters and seeds only'
							}
						>
							<span class={styles.profileToggleDot} aria-hidden="true" />
							<span class={styles.profileToggleLabel}>
								Use My Profile{useProfile.value ? '' : ' (off)'}
							</span>
						</button>
						<QuickStartPanel disabled={!useProfile.value} />
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
								{seeds.length === 0 && personSeedKeys.value.length === 0 ? (
									useProfile.value ? (
										<>
											Add a few favorites — star a movie or person — and
											they'll seed your recommendations. You can also pick a
											movie or actor in the search fields above.
										</>
									) : (
										<>
											No results. Enable <strong>Use My Profile</strong>{' '}
											above, or add a movie or actor in the search fields to
											find new movies.
										</>
									)
								) : (
									'Try loosening your filters, or pick a different seed.'
								)}
							</p>
						</div>
					) : (
						<div
							class={`${styles.grid} ${loading ? styles.gridLoading : ''}`}
							aria-busy={loading || undefined}
						>
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
