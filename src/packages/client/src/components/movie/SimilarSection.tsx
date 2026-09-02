import { useEffect, useMemo, useState } from 'preact/hooks';
import { Collapse } from '@/components/common/Collapse';
import { Icon } from '@/components/common/Icon';
import { ResultFilterBar } from '@/components/common/ResultFilterBar';
import { Spinner } from '@/components/common/Spinner';
import { ResultCard } from '@/components/movie/ResultCard';
import { useMovieSearchDefaults } from '@/hooks/useMovieSearchDefaults';
import { discoverService, type ScoredMovie } from '@/services/discover.service';
import { hasMovieSearchDefaults, movieSearchDefaults } from '@/state/movie-search-defaults.state';
import {
	defaultsToFilters,
	EMPTY_FILTERS,
	filterAndSortResults,
	filtersToDefaults,
	type ResultFilterState,
} from '@/utils/result-filters';
import styles from './SimilarSection.module.scss';

/** Pulled once, then filtered client-side — same model as "Known For". */
const FETCH_LIMIT = 60;

interface SimilarSectionProps {
	movieId: string;
	/** Collapsed until first expand, so a movie page costs no extra request. */
	defaultOpen?: boolean;
}

/**
 * "Similar" movies for a title, powered by the same recommendation engine the
 * Discover page uses (`/recommendations/discover` seeded with this movie).
 * Fetched with `include: 'all'` so results span the library AND titles you
 * don't own — the In Library filter narrows it afterwards.
 *
 * Mirrors the person page's "Known For" rail: same sort/filter controls (via
 * the shared ResultFilterBar + filterAndSortResults), same result count, and
 * the same cards, so a not-in-library hit opens its preview page.
 *
 * Lazy: nothing is requested until the section is first expanded.
 */
export function SimilarSection({ movieId, defaultOpen = false }: SimilarSectionProps) {
	const [open, setOpen] = useState(defaultOpen);
	const [results, setResults] = useState<ScoredMovie[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filters, setFilters] = useState<ResultFilterState>(EMPTY_FILTERS);

	// Seed from the user's saved "movie search defaults" (once per mount).
	const { save } = useMovieSearchDefaults({
		apply: (d) => setFilters(defaultsToFilters(d)),
	});

	// Reset when navigating between movies so the previous title's results
	// can't flash in the new one's section.
	useEffect(() => {
		setResults(null);
		setError(null);
		// Reset to the user's saved defaults rather than the built-in empty set,
		// so navigating between movies keeps their preferences applied.
		const saved = movieSearchDefaults.value;
		setFilters(
			saved && hasMovieSearchDefaults(saved) ? defaultsToFilters(saved) : EMPTY_FILTERS,
		);
	}, [movieId]);

	useEffect(() => {
		if (!open || results !== null || loading) return;
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		discoverService
			.fetch(
				{ seedMovieId: movieId, include: 'all', limit: FETCH_LIMIT },
				{
					signal: controller.signal,
				},
			)
			.then((res) => setResults(res.results ?? []))
			.catch((err) => {
				if (controller.signal.aborted) return;
				setError(err?.message ?? 'Could not load similar movies');
				setResults([]);
			})
			.finally(() => setLoading(false));
		return () => controller.abort();
	}, [open, movieId, results, loading]);

	const visible = useMemo(
		() =>
			filterAndSortResults(results ?? [], filters, (m) => ({
				title: m.title,
				year: m.year,
				// Match the card's badge: IMDB preferred, TMDB fallback.
				rating: m.imdbRating ?? m.tmdbRating ?? m.rating ?? null,
				votes: Math.max(m.imdbVotes ?? 0, m.tmdbVotes ?? 0, m.votes ?? 0) || null,
				inLibrary: m.inLibrary ?? m.source === 'library',
			})),
		[results, filters],
	);

	return (
		<div class={styles.section}>
			<button class={styles.toggle} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
				<h2 class={styles.title}>Similar</h2>
				<span class={styles.arrow}>
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
				</span>
			</button>

			<Collapse open={open}>
				{results !== null && results.length > 0 && (
					<div class={styles.controlsRow}>
						<ResultFilterBar
							value={filters}
							onChange={setFilters}
							count={visible.length}
							onSaveDefaults={() => save(filtersToDefaults(filters))}
						/>
					</div>
				)}

				{/* `results === null` covers BOTH "not requested yet" and "in
				    flight". Keying the spinner off `loading` alone let the render
				    between opening and the effect firing fall through to the
				    empty-state branch, which flashed "No results match". */}
				{results === null && !error ? (
					<div class={styles.state}>
						<Spinner size="sm" />
						<span>Loading similar titles…</span>
					</div>
				) : error ? (
					<div class={styles.state}>{error}</div>
				) : results !== null && results.length === 0 ? (
					<div class={styles.state}>No similar movies found for this title.</div>
				) : visible.length === 0 ? (
					<div class={styles.state}>No results match the current filters.</div>
				) : (
					<div class={styles.grid}>
						{visible.map((m) => (
							<ResultCard
								key={m.movieId}
								href={`/movie/${m.movieId}`}
								title={m.title}
								year={m.year}
								posterUrl={m.posterUrl}
								inLibrary={m.inLibrary ?? m.source === 'library'}
								matchPercent={m.score != null ? m.score * 100 : null}
								imdbRating={m.imdbRating}
								imdbVotes={m.imdbVotes}
								tmdbRating={m.tmdbRating}
								tmdbVotes={m.tmdbVotes}
								runtimeMinutes={m.runtimeMinutes}
								genres={m.genres}
								seedId={m.movieId}
							/>
						))}
					</div>
				)}
			</Collapse>
		</div>
	);
}
