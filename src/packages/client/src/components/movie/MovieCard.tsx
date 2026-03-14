import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { playMovie } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { getRatingColor } from '@/utils/rating-color';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieCard.module.scss';

interface MovieCardProps {
	movie: Movie;
}

export function MovieCard({ movie }: MovieCardProps) {
	const handleClick = useCallback(() => {
		route(`/movie/${movie.id}`);
	}, [movie.id]);

	const handlePlay = useCallback(
		(e: Event) => {
			e.stopPropagation();
			playMovie(movie.id, { fromBeginning: true });
		},
		[movie.id],
	);

	const handleResume = useCallback(
		(e: Event) => {
			e.stopPropagation();
			playMovie(movie.id);
		},
		[movie.id],
	);

	const rating = movie.rating ?? 0;
	const ratingColor = getRatingColor(rating);

	return (
		<div class={styles.card} onClick={handleClick} role="button" tabIndex={0}>
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

				{rating > 0 && (
					<div class={styles.ratingBadge} style={{ background: ratingColor }}>
						{rating.toFixed(1)}
					</div>
				)}

				<div class={styles.overlay}>
					<button
						class={styles.playButton}
						onClick={handlePlay}
						aria-label={`Play ${movie.title}`}
					>
						Play
					</button>
					{hasWatchProgress(movie) && (
						<button
							class={styles.resumeButton}
							onClick={handleResume}
							aria-label={`Resume ${movie.title}`}
						>
							Resume
						</button>
					)}
				</div>
			</div>

			<div class={styles.info}>
				{hasWatchProgress(movie) && (
					<div class={styles.progressBar}>
						<div
							class={styles.progressFill}
							style={{ width: `${getWatchPercent(movie)}%` }}
						/>
					</div>
				)}
				<h3 class={styles.title}>{movie.title}</h3>
				<div class={styles.details}>
					<span class={styles.year}>{movie.year}</span>
					{movie.runtime > 0 && (
						<span class={styles.runtime}>
							{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m
						</span>
					)}
					{movie.addedAt && (
						<span class={styles.addedAt}>
							{new Date(movie.addedAt).toLocaleDateString('en-US', {
								month: 'short',
								day: 'numeric',
								year: 'numeric',
							})}
						</span>
					)}
					{rating > 0 && (
						<span class={styles.userRating} style={{ color: ratingColor }}>
							{'\u2605'} {rating.toFixed(1)}
						</span>
					)}
					<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
				</div>
			</div>
		</div>
	);
}
