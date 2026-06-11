import { SmartImage } from '@/components/common/SmartImage';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { newTabNav } from '@/utils/navigation';
import styles from './MovieListItem.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';
import { MovieScoreChips } from './MovieScoreChips';
import { PlayResumeButton } from './PlayResumeButton';
import { RatingBadge } from './RatingBadge';
import type { MovieDisplayProps } from './types';
import { useMovieCardBehavior } from './useMovieCardBehavior';
import { WatchProgressBar } from './WatchProgressBar';

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
		href,
	} = useMovieCardBehavior(movie, selectionMode, onToggleSelect);
	const navHandlers = href ? newTabNav(href, handleClick) : { onClick: handleClick };

	const rating = movie.rating ?? 0;

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
			{...navHandlers}
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
				{/* Row 1: title alone, options pinned far right */}
				<div class={styles.titleRow}>
					<span class={styles.title}>
						{movie.title}
						{movie.hidden && <span class={styles.hiddenTag}>Hidden</span>}
					</span>
					{!selectionMode && !movie.remoteOrigin && (
						<MovieOptionsMenu
							movie={movie}
							onMovieUpdate={onMovieUpdate}
							onMovieRemoved={onMovieRemoved}
							compact
						/>
					)}
				</div>

				{/* Row 2: meta column (fills) + play/resume on the right */}
				<div class={styles.secondRow}>
					<div class={styles.metaCol}>
						<div class={styles.metaLine}>
							{movie.year && <span class={styles.year}>{movie.year}</span>}
							<RatingBadge value={rating} class={styles.ratingChip} />
							<MovieScoreChips movie={movie} />
							{runtimeStr && <span>{runtimeStr}</span>}
						</div>
						{formattedDate && (
							<div class={styles.metaLine}>
								<span>Added {formattedDate}</span>
							</div>
						)}
					</div>
					<div class={styles.actions}>
						<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
						{!selectionMode && (
							<PlayResumeButton
								movie={movie}
								size="sm"
								onPlay={handlePlay}
								onResume={handleResume}
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
