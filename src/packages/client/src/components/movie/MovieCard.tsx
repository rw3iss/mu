import { useCallback, useRef, useState } from 'preact/hooks';
import { SmartImage } from '@/components/common/SmartImage';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { getMovieProgress, processingMovieIds } from '@/state/processing.state';
import { getRatingColor } from '@/utils/rating-color';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import { hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';
import { RatingBadge } from './RatingBadge';
import { WatchProgressBar } from './WatchProgressBar';
import type { MovieDisplayProps } from './types';
import { useMovieCardBehavior } from './useMovieCardBehavior';

type MovieCardProps = MovieDisplayProps;

export function MovieCard({
	movie,
	onMovieUpdate,
	onMovieRemoved,
	selectionMode = false,
	selected = false,
	onToggleSelect,
}: MovieCardProps) {
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
	const transcodeNeeded = needsTranscode(movie);
	const streamLabel = getStreamModeLabel(movie);
	const isProcessing = processingMovieIds.value.has(movie.id);
	const progress = isProcessing ? getMovieProgress(movie.id) : undefined;

	return (
		<div
			class={`${styles.card} ${movie.hidden ? styles.hidden : ''} ${isProcessing ? styles.processing : ''} ${selectionMode ? styles.selectable : ''} ${selected ? styles.selected : ''}`}
			onClick={handleClick}
			role="button"
			tabIndex={0}
		>
			{selectionMode && (
				<div class={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}>
					{selected && '\u2713'}
				</div>
			)}
			{isProcessing && (
				<div class={styles.processingOverlay}>
					{progress != null ? `${progress}%` : 'Processing...'}
				</div>
			)}
			{movie.hidden && <span class={styles.hiddenLabel}>Hidden</span>}
			{movie.remoteOrigin && (
				<span class={styles.remoteBadge} title={`From: ${movie.remoteOrigin.serverName}`}>
					{movie.remoteOrigin.serverName}
				</span>
			)}
			{transcodeNeeded && streamLabel && (
				<span class={styles.transcodeBadge}>{streamLabel}</span>
			)}
			<div class={styles.poster}>
				<SmartImage
					src={movie.posterUrl}
					alt={`${movie.title} poster`}
					imgClass={styles.posterImage}
					fallbackLabel={movie.title}
				/>

				<RatingBadge value={rating} class={styles.ratingBadge} />


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
				<h3
					class={styles.title}
					onMouseEnter={handleTitleMouseEnter}
					onMouseLeave={handleTitleMouseLeave}
				>
					{movie.title}
					{tooltipVisible && <span class={styles.titleTooltip}>{movie.title}</span>}
				</h3>
				<div class={styles.details}>
					{movie.year && <span class={styles.year}>{movie.year}</span>}
					{movie.year && movie.runtime > 0 && <span class={styles.dot}>{'\u00B7'}</span>}
					{movie.runtime > 0 && (
						<span class={styles.runtime}>
							{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m
						</span>
					)}
					{rating > 0 && (
						<span
							class={styles.userRating}
							style={{ color: ratingColor }}
							title={`Your rating: ${rating.toFixed(1)}`}
						>
							{'\u2605'} {rating.toFixed(1)}
						</span>
					)}
					<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
					{!selectionMode && !movie.remoteOrigin && (
						<span class={styles.optionsWrap}>
							<MovieOptionsMenu
								movie={movie}
								onMovieUpdate={onMovieUpdate}
								onMovieRemoved={onMovieRemoved}
								compact
							/>
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
