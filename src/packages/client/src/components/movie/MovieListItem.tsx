import { SmartImage } from '@/components/common/SmartImage';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { getRatingColor } from '@/utils/rating-color';
import { hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieListItem.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';
import { RatingBadge } from './RatingBadge';
import { WatchProgressBar } from './WatchProgressBar';
import type { MovieDisplayProps } from './types';
import { useMovieCardBehavior } from './useMovieCardBehavior';

type MovieListItemProps = MovieDisplayProps;

export function MovieListItem({
	movie,
	onMovieUpdate,
	onMovieRemoved,
	selectionMode = false,
	selected = false,
	onToggleSelect,
}: MovieListItemProps) {
	const {
		onCardClick: handleClick,
		onPlayFromStart: handlePlay,
		onResume: handleResume,
	} = useMovieCardBehavior(movie, selectionMode, onToggleSelect);

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
		<div
			class={`${styles.row} ${movie.hidden ? styles.hidden : ''} ${selectionMode ? styles.selectable : ''} ${selected ? styles.selected : ''}`}
			onClick={handleClick}
			role="button"
			tabIndex={0}
		>
			{selectionMode && (
				<div class={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}>
					{selected && '\u2713'}
				</div>
			)}
			<div class={styles.poster}>
				<SmartImage
					src={movie.posterUrl}
					alt={`${movie.title} poster`}
					imgClass={styles.posterImage}
					fallbackLabel={movie.title}
					iconOnly
				/>
				<WatchProgressBar
					movie={movie}
					class={styles.progressBar}
					fillClass={styles.progressFill}
				/>
			</div>

			<div class={styles.info}>
				<span class={styles.title}>
					{movie.title}
					{movie.hidden && <span class={styles.hiddenTag}>Hidden</span>}
				</span>
				<div class={styles.meta}>
					{movie.year && <span>{movie.year}</span>}
					{runtimeStr && <span>{runtimeStr}</span>}
					{rating > 0 && (
						<span class={styles.userRating} style={{ color: ratingColor }}>
							{'\u2605'} {rating.toFixed(1)}
						</span>
					)}
					{formattedDate && <span>{formattedDate}</span>}
				</div>
			</div>

			<div class={styles.actions}>
				<RatingBadge value={rating} class={styles.ratingBadge} />

				<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
				{!selectionMode && (
					<>
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
						{!movie.remoteOrigin && (
							<MovieOptionsMenu
								movie={movie}
								onMovieUpdate={onMovieUpdate}
								onMovieRemoved={onMovieRemoved}
								compact
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
}
