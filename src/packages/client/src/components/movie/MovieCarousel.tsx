import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Movie } from '@/state/library.state';
import { MovieCard } from './MovieCard';
import styles from './MovieCarousel.module.scss';

interface MovieCarouselProps {
	title: string;
	movies: Movie[];
	onSeeAll?: () => void;
}

export function MovieCarousel({ title, movies, onSeeAll }: MovieCarouselProps) {
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
						{'\u276E'}
					</button>
				)}

				<div ref={trackRef} class={styles.track}>
					{movies.map((movie) => (
						<div key={movie.id} class={styles.item}>
							<MovieCard movie={movie} />
						</div>
					))}
				</div>

				{canScrollRight && (
					<button
						class={`${styles.scrollBtn} ${styles.scrollRight}`}
						onClick={() => scroll('right')}
						aria-label="Scroll right"
					>
						{'\u276F'}
					</button>
				)}
			</div>
		</section>
	);
}
