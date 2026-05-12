import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import type { Movie } from '@/state/library.state';
import { removeMovieFromList, updateMovieInList } from '@/state/library.state';
import { MovieCard } from './MovieCard';
import styles from './MovieCarousel.module.scss';

interface MovieCarouselProps {
	title: string;
	movies: Movie[];
	onSeeAll?: () => void;
	/** Defaults to the global library-state mutators so home-page carousels
	 * stay in sync after a card-level action (delete-from-disk, hide,
	 * refresh-metadata). Pages with locally-owned lists can override. */
	onMovieUpdate?: (movie: Movie) => void;
	onMovieRemoved?: (movieId: string) => void;
}

export function MovieCarousel({
	title,
	movies,
	onSeeAll,
	onMovieUpdate = updateMovieInList,
	onMovieRemoved = removeMovieFromList,
}: MovieCarouselProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const [canScrollLeft, setCanScrollLeft] = useState(false);
	const [canScrollRight, setCanScrollRight] = useState(false);

	const updateScrollState = useCallback(() => {
		const el = trackRef.current;
		if (!el) return;
		setCanScrollLeft(el.scrollLeft > 0);
		setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
	}, []);

	useEffect(() => {
		updateScrollState();
		const el = trackRef.current;
		if (!el) return;
		el.addEventListener('scroll', updateScrollState, { passive: true });
		const resizeObserver = new ResizeObserver(updateScrollState);
		resizeObserver.observe(el);
		return () => {
			el.removeEventListener('scroll', updateScrollState);
			resizeObserver.disconnect();
		};
	}, [updateScrollState, movies]);

	const scroll = useCallback((direction: 'left' | 'right') => {
		const el = trackRef.current;
		if (!el) return;
		const scrollAmount = el.clientWidth * 0.75;
		el.scrollBy({
			left: direction === 'left' ? -scrollAmount : scrollAmount,
			behavior: 'smooth',
		});
	}, []);

	if (movies.length === 0) return null;

	return (
		<section class={styles.carousel}>
			<div class={styles.header}>
				<h2 class={styles.title}>{title}</h2>
				{onSeeAll && (
					<button class={styles.seeAll} onClick={onSeeAll}>
						See all
					</button>
				)}
			</div>

			<div class={styles.trackWrapper}>
				{canScrollLeft && (
					<button
						class={`${styles.scrollBtn} ${styles.scrollLeft}`}
						onClick={() => scroll('left')}
						aria-label="Scroll left"
					>
						<Icon name="chevron-left" size={18} />
					</button>
				)}

				<div ref={trackRef} class={styles.track}>
					{movies.map((movie) => (
						<div key={movie.id} class={styles.item}>
							<MovieCard
								movie={movie}
								onMovieUpdate={onMovieUpdate}
								onMovieRemoved={onMovieRemoved}
							/>
						</div>
					))}
				</div>

				{canScrollRight && (
					<button
						class={`${styles.scrollBtn} ${styles.scrollRight}`}
						onClick={() => scroll('right')}
						aria-label="Scroll right"
					>
						<Icon name="chevron-right" size={18} />
					</button>
				)}
			</div>
		</section>
	);
}
