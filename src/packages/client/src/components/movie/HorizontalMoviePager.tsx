import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Spinner';
import type { Movie } from '@/state/library.state';
import styles from './HorizontalMoviePager.module.scss';
import { MovieCard } from './MovieCard';

interface HorizontalMoviePagerProps {
	movies: Movie[];
	isLoading?: boolean;
	emptyMessage?: string;
	onMovieRemoved?: (movieId: string) => void;
	/** Extra class appended to the root, so callers can tweak layout/spacing. */
	class?: string;
}

/**
 * A horizontally-scrolling row of movie cards with left/right paging arrows.
 * Used by the dashboard "Continue Watching" rail. Native horizontal scroll
 * (trackpad / touch / wheel) plus arrow buttons that page by ~one viewport;
 * arrows disable at each end. Reusable anywhere a single-row movie rail fits.
 */
export function HorizontalMoviePager({
	movies,
	isLoading,
	emptyMessage,
	onMovieRemoved,
	class: className = '',
}: HorizontalMoviePagerProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const [canLeft, setCanLeft] = useState(false);
	const [canRight, setCanRight] = useState(false);

	const updateArrows = useCallback(() => {
		const el = trackRef.current;
		if (!el) return;
		setCanLeft(el.scrollLeft > 4);
		setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
	}, []);

	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		updateArrows();
		el.addEventListener('scroll', updateArrows, { passive: true });
		const ro = new ResizeObserver(updateArrows);
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', updateArrows);
			ro.disconnect();
		};
	}, [updateArrows, movies.length]);

	const page = useCallback((dir: 1 | -1) => {
		const el = trackRef.current;
		if (!el) return;
		// Page by ~80% of the visible width so a card or two stays for context.
		el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
	}, []);

	if (isLoading) {
		return (
			<div class={`${styles.state} ${className}`}>
				<Spinner size="md" />
			</div>
		);
	}

	if (!movies.length) {
		return (
			<div class={`${styles.state} ${className}`}>{emptyMessage ?? 'Nothing here yet'}</div>
		);
	}

	return (
		<div class={`${styles.pager} ${className}`}>
			<button
				class={`${styles.arrow} ${styles.arrowLeft}`}
				onClick={() => page(-1)}
				disabled={!canLeft}
				aria-label="Scroll left"
			>
				<Icon name="chevron-left" size={20} />
			</button>
			<div class={styles.track} ref={trackRef}>
				{movies.map((m) => (
					<div class={styles.item} key={m.id}>
						<MovieCard movie={m} onMovieRemoved={onMovieRemoved} />
					</div>
				))}
			</div>
			<button
				class={`${styles.arrow} ${styles.arrowRight}`}
				onClick={() => page(1)}
				disabled={!canRight}
				aria-label="Scroll right"
			>
				<Icon name="chevron-right" size={20} />
			</button>
		</div>
	);
}
