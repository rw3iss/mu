import { useCallback, useRef, useState } from 'preact/hooks';
import { MediaCard } from '@/components/common/MediaCard';
import { useTranscodeStatus } from '@/hooks/useTranscodeStatus';
import { useWatchPosition } from '@/hooks/useWatchPosition';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import styles from './MovieCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';
import { MovieScoreChips } from './MovieScoreChips';
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
		href,
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
	const transcodeNeeded = needsTranscode(movie);
	const streamLabel = getStreamModeLabel(movie);
	const { isProcessing, progress } = useTranscodeStatus(movie.id);

	// Read the signal-backed resume position so every card in every
	// view stays in sync with playback ticks + cross-tab updates.
	// Falls back to the movie object's own fields (set by APIs that
	// already join watch history, e.g. /history, /history/continue)
	// when the signal cache hasn't been hydrated yet.
	const watch = useWatchPosition(movie.id, {
		watchPosition: movie.watchPosition,
		durationSeconds: movie.durationSeconds,
	});
	const showResume = !!watch?.hasProgress;

	// ── Slot contents ──────────────────────────────────────

	const topRight =
		movie.remoteOrigin || (transcodeNeeded && streamLabel) ? (
			<>
				{movie.remoteOrigin && (
					<span
						class={styles.remoteBadge}
						title={`From: ${movie.remoteOrigin.serverName}`}
					>
						{movie.remoteOrigin.serverName}
					</span>
				)}
				{transcodeNeeded && streamLabel && (
					<span class={styles.transcodeBadge}>{streamLabel}</span>
				)}
			</>
		) : null;

	const topLeft = movie.hidden ? <span class={styles.hiddenLabel}>Hidden</span> : null;

	const posterBadges = isProcessing ? (
		<div class={styles.processingOverlay}>
			{progress != null ? `${progress}%` : 'Processing...'}
		</div>
	) : null;

	const playTooltip = isProcessing
		? `Still transcoding${
				progress != null ? ` — ${progress}% done` : ''
			}. You can watch the live stream now, but waiting for the cache to finish gives the smoothest playback.`
		: undefined;

	const hoverOverlay = !selectionMode ? (
		<>
			<button
				class={`${styles.playButton} ${isProcessing ? styles.playButtonProcessing : ''}`}
				onClick={handlePlay}
				aria-label={
					isProcessing ? `Play ${movie.title} (still transcoding)` : `Play ${movie.title}`
				}
				title={playTooltip}
			>
				Play
			</button>
			{showResume && (
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

	// Year sits under the title in the top scrim; the bottom scrim keeps just
	// the ratings (score chips) and the options menu.
	const topMeta = movie.year ? <span class={styles.year}>{movie.year}</span> : null;

	const subtitle = (
		<div class={styles.details}>
			<span class={styles.detailsLeft}>
				<RatingBadge value={rating} class={styles.ratingChip} />
				<MovieScoreChips movie={movie} />
			</span>
			<span class={styles.detailsRight}>
				<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
				{!selectionMode && !movie.remoteOrigin && (
					<MovieOptionsMenu
						movie={movie}
						onMovieUpdate={onMovieUpdate}
						onMovieRemoved={onMovieRemoved}
						compact
					/>
				)}
			</span>
		</div>
	);

	return (
		<MediaCard
			posterUrl={movie.posterUrl}
			alt={`${movie.title} poster`}
			fallbackLabel={movie.title}
			posterShape="poster"
			onClick={handleClick}
			href={href}
			processing={isProcessing}
			selected={selected}
			hidden={movie.hidden}
			class={`${styles.card} ${selectionMode ? styles.selectable : ''}`}
			topLeft={topLeft}
			topRight={topRight}
			posterBadges={posterBadges}
			hoverOverlay={hoverOverlay}
			preInfo={preInfo}
			infoOverlay
			belowPoster={
				<WatchProgressBar
					movie={movie}
					class={styles.progressBar}
					fillClass={styles.progressFill}
				/>
			}
			title={titleNode}
			topMeta={topMeta}
			subtitle={subtitle}
		/>
	);
}
