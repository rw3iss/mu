import { useEffect, useState } from 'preact/hooks';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import styles from './Discover.module.scss';

interface DiscoverProps {
	path?: string;
}

interface GenreSection {
	genre: string;
	movies: Movie[];
}

export function Discover(_props: DiscoverProps) {
	const [trending, setTrending] = useState<Movie[]>([]);
	const [genreSections, setGenreSections] = useState<GenreSection[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		async function load() {
			setIsLoading(true);
			try {
				// Fetch trending
				const trendingRes = await moviesService.getTrending(12);
				setTrending(trendingRes.movies);

				// Fetch genres and movies for each
				const genres = await moviesService.getGenres();
				const topGenres = genres.slice(0, 6);

				const sections: GenreSection[] = [];
				for (const genre of topGenres) {
					try {
						const res = await moviesService.list({
							genres: genre,
							limit: '8',
							sortBy: 'rating',
							sortOrder: 'desc',
						});
						if (res.movies.length > 0) {
							sections.push({ genre, movies: res.movies });
						}
					} catch {
						// Skip failed genre
					}
				}

				setGenreSections(sections);
			} catch (error) {
				console.error('Failed to load discover:', error);
			} finally {
				setIsLoading(false);
			}
		}

		load();
	}, []);

	return (
		<div class={styles.discover}>
			<h1 class={styles.title}>Discover</h1>

			{/* Trending */}
			<section class={styles.section}>
				<h2 class={styles.sectionTitle}>Trending Now</h2>
				<MovieGrid
					movies={trending}
					isLoading={isLoading}
					emptyMessage="No trending movies"
				/>
			</section>

			{/* Genre Sections */}
			{genreSections.map((section) => (
				<section key={section.genre} class={styles.section}>
					<h2 class={styles.sectionTitle}>{section.genre}</h2>
					<MovieGrid movies={section.movies} />
				</section>
			))}

			{!isLoading && genreSections.length === 0 && trending.length === 0 && (
				<div class={styles.empty}>
					<p>Add movies to your library to see recommendations</p>
				</div>
			)}
		</div>
	);
}
