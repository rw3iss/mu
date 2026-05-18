import { useCallback, useRef, useState } from 'preact/hooks';
import { MediaCard } from '@/components/common/MediaCard';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { getMovieProgress, processingMovieIds } from '@/state/processing.state';
import { getRatingColor } from '@/utils/rating-color';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import { hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';
import { RatingBadge } from './RatingBadge';
import type { MovieDisplayProps } from './types';
import { useMovieCardBehavior } from './useMovieCardBehavior';
import { WatchProgressBar } from './WatchProgressBar';

type MovieCardProps = MovieDisplayProps;

/**
 * Library/Watchlist/History card. Composes the generic
 * `<MediaCard>` shell and supplies movie-specific badges via
 * named slots. Card state (`processing`, `selected`, `hidden`)
 * delegates to the shell; product-specific affordances
 * (RatingBadge, MovieOptionsMenu, plugin button, watch progress,
 * play/resume overlay) are slotted in.
 */
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

	// ── Slot contents ──────────────────────────────────────

	const topRight = (
		<>
			{movie.remoteOrigin && (
				<span class={styles.remoteBadge} title={`From: ${movie.remoteOrigin.serverName}`}>
					{movie.remoteOrigin.serverName}
				</span>
			)}
			{transcodeNeeded && streamLabel && (
				<span class={styles.transcodeBadge}>{streamLabel}</span>
			)}
			<RatingBadge value={rating} class={styles.ratingBadge} />
		</>
	);

	const topLeft = movie.hidden ? <span class={styles.hiddenLabel}>Hidden</span> : null;

	const posterBadges = isProcessing ? (
		<div class={styles.processingOverlay}>
			{progress != null ? `${progress}%` : 'Processing...'}
		</div>
	) : null;

	const hoverOverlay = !selectionMode ? (
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
		</>
	) : null;

	const preInfo = selectionMode ? (
		<div class={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}>
			{selected && '✓'}
		</div>
	) : null;

	const titleNode = (
		<h3
			class={styles.title}
			onMouseEnter={handleTitleMouseEnter}
			onMouseLeave={handleTitleMouseLeave}
		>
			{movie.title}
			{tooltipVisible && <span class={styles.titleTooltip}>{movie.title}</span>}
		</h3>
	);

	const subtitle = (
		<div class={styles.details}>
			{movie.year && <span class={styles.year}>{movie.year}</span>}
			{movie.year && movie.runtime > 0 && <span class={styles.dot}>{'·'}</span>}
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
					{'★'} {rating.toFixed(1)}
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
	);

	return (
		<MediaCard
			posterUrl={movie.posterUrl}
			alt={`${movie.title} poster`}
			fallbackLabel={movie.title}
			posterShape="poster"
			onClick={handleClick}
			processing={isProcessing}
			selected={selected}
			hidden={movie.hidden}
			class={`${styles.card} ${selectionMode ? styles.selectable : ''}`}
			topLeft={topLeft}
			topRight={topRight}
			posterBadges={posterBadges}
			hoverOverlay={hoverOverlay}
			preInfo={preInfo}
			belowPoster={
				<WatchProgressBar
					movie={movie}
					class={styles.progressBar}
					fillClass={styles.progressFill}
				/>
			}
			title={titleNode}
			subtitle={subtitle}
		/>
	);
}
