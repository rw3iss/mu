import { useEffect, useState } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { api } from '@/services/api';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import { watchlistIds } from '@/state/watchlist.state';
import styles from './Watchlist.module.scss';

interface WatchlistProps {
	path?: string;
}

export function Watchlist(_props: WatchlistProps) {
	const [movies, setMovies] = useState<Movie[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [viewingUnwatched, setViewingUnwatched] = useState(false);

	useEffect(() => {
		if (viewingUnwatched) return;
		async function load() {
			setIsLoading(true);
			try {
				const data =
					await api.get<
						Array<{
							id: string;
							movieId: string;
							addedAt: string;
							notes: string | null;
							movieTitle: string;
							movieYear: number;
							moviePosterUrl: string;
							movieThumbnailUrl: string;
							movieOverview: string;
							movieRuntimeMinutes: number;
						}>
					>('/watchlist');
				// Map watchlist entries to Movie shape for MovieGrid
				setMovies(
					data.map((entry) => ({
						id: entry.movieId,
						title: entry.movieTitle ?? 'Untitled',
						year: entry.movieYear ?? 0,
						overview: entry.movieOverview ?? '',
						posterUrl: entry.moviePosterUrl || entry.movieThumbnailUrl || '',
						backdropUrl: '',
						runtime: entry.movieRuntimeMinutes ?? 0,
						genres: [],
						cast: [],
						rating: 0,
						addedAt: entry.addedAt ?? '',
						inWatchlist: true,
					})),
				);
			} catch (error) {
				console.error('Failed to load watchlist:', error);
			} finally {
				setIsLoading(false);
			}
		}

		load();
	}, [viewingUnwatched]);

	useEffect(() => {
		if (!viewingUnwatched) return;
		setIsLoading(true);
		moviesService
			.list({ hideWatched: 'true', pageSize: '200', sortBy: 'addedAt', sortOrder: 'desc' })
			.then((response) => {
				setMovies(response.movies);
			})
			.catch((error) => {
				console.error('Failed to load unwatched movies:', error);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [viewingUnwatched]);

	// Keep the rendered list in sync with the shared `watchlistIds` signal:
	// when the user removes a movie via MovieOptionsMenu, the signal updates
	// and we reactively drop the row from the displayed list — no refresh
	// needed. Accessing `.value` here subscribes the component to changes.
	const live = watchlistIds.value;
	const visibleMovies =
		viewingUnwatched || live === null
			? movies
			: movies.filter((m) => live.has(m.id));

	return (
		<div class={styles.watchlist}>
			<div class={styles.header}>
				<h1 class={styles.title}>{viewingUnwatched ? 'Unwatched Movies' : 'Watchlist'}</h1>
				<span class={styles.count}>
					{visibleMovies.length} {visibleMovies.length === 1 ? 'movie' : 'movies'}
				</span>
				<button
					onClick={() => setViewingUnwatched(!viewingUnwatched)}
					style={{
						padding: '4px 12px',
						borderRadius: 'var(--radius-md)',
						border: '1px solid var(--color-border)',
						background: viewingUnwatched
							? 'var(--color-accent)'
							: 'var(--color-bg-elevated)',
						color: viewingUnwatched ? '#fff' : 'var(--color-text-secondary)',
						cursor: 'pointer',
						fontSize: 'var(--font-size-sm)',
						marginLeft: 'var(--space-md)',
					}}
				>
					{viewingUnwatched ? 'View Watchlist' : 'View Unwatched'}
				</button>
			</div>

			<MovieGrid
				movies={visibleMovies}
				isLoading={isLoading}
				emptyMessage={
					viewingUnwatched
						? 'All movies have been watched! Nice.'
						: 'Your watchlist is empty. Browse the library and add movies you want to watch.'
				}
			/>
		</div>
	);
}
