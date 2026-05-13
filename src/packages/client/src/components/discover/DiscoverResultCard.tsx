import { route } from 'preact-router';
import { SmartImage } from '@/components/common/SmartImage';
import type { ScoredMovie } from '@/services/discover.service';
import styles from './DiscoverResultCard.module.scss';

interface DiscoverResultCardProps {
	movie: ScoredMovie;
	onSeed?: () => void;
}

/**
 * Discover-page card variant. Adds: relevance score badge, top
 * explanation as a caption, "See similar to this" link, and a click
 * target that opens the movie detail page.
 *
 * Tries to use the same dimensions as a standard MovieCard so the
 * grid lines up next to one if needed.
 */
export function DiscoverResultCard({ movie, onSeed }: DiscoverResultCardProps) {
	const goToDetail = () => route(`/movie/${movie.movieId}`);
	const handleSeed = (e: MouseEvent) => {
		e.stopPropagation();
		if (onSeed) onSeed();
		else route(`/discover?seedMovieId=${encodeURIComponent(movie.movieId)}`);
	};

	const scorePct = Math.round(movie.score * 100);
	const reason = movie.explanation[0];

	return (
		<div class={styles.card} onClick={goToDetail} role="button" tabIndex={0}>
			<div class={styles.posterWrap}>
				{scorePct > 0 && <span class={styles.scoreBadge}>{scorePct}%</span>}
				<SmartImage
					src={movie.posterUrl ?? ''}
					alt={movie.title}
					class={styles.poster}
					fallback={<div class={styles.posterFallback}>{movie.title.charAt(0)}</div>}
				/>
				<button
					class={styles.seedBtn}
					onClick={handleSeed}
					title="See movies similar to this"
					aria-label="See similar"
				>
					See similar →
				</button>
			</div>
			<div class={styles.body}>
				<div class={styles.title}>{movie.title}</div>
				<div class={styles.meta}>
					{movie.year ?? '—'}
					{movie.usedSources.length > 0 && (
						<span class={styles.sources}>{movie.usedSources.slice(0, 2).join(' · ')}</span>
					)}
				</div>
				{reason && <div class={styles.reason}>{reason}</div>}
			</div>
		</div>
	);
}
