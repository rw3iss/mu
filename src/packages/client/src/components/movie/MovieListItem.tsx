import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import type { Movie } from '@/state/library.state';
import { getRatingColor } from '@/utils/rating-color';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import styles from './MovieListItem.module.scss';

interface MovieListItemProps {
	movie: Movie;
}

export function MovieListItem({ movie }: MovieListItemProps) {
	const handleClick = useCallback(() => {
		route(`/movie/${movie.id}`);
	}, [movie.id]);

	const handlePlay = useCallback(
		(e: Event) => {
			e.stopPropagation();
			route(`/player/${movie.id}`);
		},
		[movie.id],
	);

	const rating = movie.rating ?? 0;
	const ratingColor = getRatingColor(rating);

	const formattedDate = movie.addedAt
		? new Date(movie.addedAt).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			})
		: null;

	const runtimeStr = movie.runtime
		? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`
		: null;

	return (
		<div class={styles.row} onClick={handleClick} role="button" tabIndex={0}>
			<div class={styles.poster}>
				{movie.posterUrl ? (
					<img
						src={movie.posterUrl}
						alt={`${movie.title} poster`}
						loading="lazy"
						class={styles.posterImage}
					/>
				) : (
					<div class={styles.posterPlaceholder}>
						<span>{(movie.title ?? '?').charAt(0)}</span>
					</div>
				)}
				{hasWatchProgress(movie) && (
					<div class={styles.progressBar}>
						<div
							class={styles.progressFill}
							style={{ width: `${getWatchPercent(movie)}%` }}
						/>
					</div>
				)}
			</div>

			<div class={styles.info}>
				<span class={styles.title}>{movie.title}</span>
				<div class={styles.meta}>
					{movie.year && <span>{movie.year}</span>}
					{runtimeStr && <span>{runtimeStr}</span>}
					{formattedDate && <span>{formattedDate}</span>}
				</div>
			</div>

			<div class={styles.actions}>
				{rating > 0 && (
					<span class={styles.ratingBadge} style={{ background: ratingColor }}>
						{rating.toFixed(1)}
					</span>
				)}
				<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
				<button
					class={styles.playButton}
					onClick={handlePlay}
					aria-label={`Play ${movie.title}`}
				>
					{'\u25B6'}
				</button>
			</div>
		</div>
	);
}
