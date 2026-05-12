import { useCallback, useRef, useState } from 'preact/hooks';
import { SmartImage } from '@/components/common/SmartImage';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { getRatingColor } from '@/utils/rating-color';
import { hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieLargeCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';
import { RatingBadge } from './RatingBadge';
import { WatchProgressBar } from './WatchProgressBar';
import type { MovieDisplayProps } from './types';
import { useMovieCardBehavior } from './useMovieCardBehavior';

type MovieLargeCardProps = MovieDisplayProps;

export function MovieLargeCard({
	movie,
	onMovieUpdate,
	onMovieRemoved,
	selectionMode = false,
	selected = false,
	onToggleSelect,
}: MovieLargeCardProps) {
	const {
		onCardClick: handleClick,
		onPlayFromStart: handlePlay,
		onResume: handleResume,
	} = useMovieCardBehavior(movie, selectionMode, onToggleSelect);

	const [tooltipVisible, setTooltipVisible] = useState(false);
	const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleTitleMouseEnter = useCallback(() => {
		tooltipTimer.current = setTimeout(() => setTooltipVisible(true), 1000);
	}, []);

	const handleTitleMouseLeave = useCallback(() => {
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		setTooltipVisible(false);
	}, []);

	const rating = movie.rating ?? 0;
	const ratingColor = getRatingColor(rating);

	const runtimeStr = movie.runtime
		? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`
		: null;

	const formattedDate = movie.addedAt
		? new Date(movie.addedAt).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			})
		: null;

	// Prefer backdrop/thumbnail (16:9) over poster for this view
	const imageUrl = movie.backdropUrl || movie.thumbnailUrl || movie.posterUrl;

	return (
		<div
			class={`${styles.card} ${movie.hidden ? styles.hidden : ''} ${selectionMode ? styles.selectable : ''} ${selected ? styles.selected : ''}`}
			onClick={handleClick}
			role="button"
			tabIndex={0}
		>
			{selectionMode && (
				<div class={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}>
					{selected && '\u2713'}
				</div>
			)}
			{movie.hidden && <span class={styles.hiddenLabel}>Hidden</span>}
			<div class={styles.thumbnail}>
				<SmartImage
					src={imageUrl}
					alt={`${movie.title}`}
					imgClass={styles.thumbnailImage}
					fallbackLabel={movie.title}
				/>

				{!selectionMode && (
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
				)}
			</div>

			<WatchProgressBar
				movie={movie}
				class={styles.progressBar}
				fillClass={styles.progressFill}
			/>

			<div class={styles.info}>
				<div class={styles.infoTop}>
					<h3
						class={styles.title}
						onMouseEnter={handleTitleMouseEnter}
						onMouseLeave={handleTitleMouseLeave}
					>
						{movie.title}
						{tooltipVisible && <span class={styles.titleTooltip}>{movie.title}</span>}
					</h3>
					<div class={styles.infoRight}>
						<RatingBadge value={rating} class={styles.ratingBadge} />

						<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
						{!selectionMode && !movie.remoteOrigin && (
							<MovieOptionsMenu
								movie={movie}
								onMovieUpdate={onMovieUpdate}
								onMovieRemoved={onMovieRemoved}
								compact
							/>
						)}
					</div>
				</div>
				<div class={styles.meta}>
					{movie.year && <span>{movie.year}</span>}
					{runtimeStr && <span>{runtimeStr}</span>}
					{rating > 0 && (
						<span class={styles.userRating} style={{ color: ratingColor }}>
							{'\u2605'} {rating.toFixed(1)}
						</span>
					)}
					{formattedDate && <span>Added {formattedDate}</span>}
				</div>
			</div>
		</div>
	);
}
