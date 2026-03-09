import { useEffect, useState } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import styles from './Search.module.scss';

interface SearchProps {
	path?: string;
	q?: string;
}

export function Search({ q }: SearchProps) {
	const [results, setResults] = useState<Movie[]>([]);
	const [totalResults, setTotalResults] = useState(0);
	const [isLoading, setIsLoading] = useState(false);

	// Extract query from URL search params if not passed as prop
	const query =
		q ||
		(typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).get('q') || ''
			: '');

	useEffect(() => {
		if (!query) {
			setResults([]);
			setTotalResults(0);
			return;
		}

		async function search() {
			setIsLoading(true);
			try {
				const response = await moviesService.search(query);
				setResults(response.movies);
				setTotalResults(response.total);
			} catch (error) {
				console.error('Search failed:', error);
			} finally {
				setIsLoading(false);
			}
		}

		search();
	}, [query]);

	return (
		<div class={styles.search}>
			<div class={styles.header}>
				<h1 class={styles.title}>{query ? `Results for "${query}"` : 'Search'}</h1>
				{totalResults > 0 && (
					<span class={styles.count}>
						{totalResults} {totalResults === 1 ? 'movie' : 'movies'} found
					</span>
				)}
			</div>

			{!query ? (
				<div class={styles.empty}>
					<p>Enter a search term to find movies</p>
				</div>
			) : (
				<MovieGrid
					movies={results}
					isLoading={isLoading}
					emptyMessage={`No results for "${query}"`}
				/>
			)}
		</div>
	);
}
