import { useCallback, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { playMovie } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { getMovieProgress, processingMovieIds } from '@/state/processing.state';
import { getRatingColor } from '@/utils/rating-color';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';

interface MovieCardProps {
	movie: Movie;
	onMovieUpdate?: (movie: Movie) => void;
	selectionMode?: boolean;
	selected?: boolean;
	onToggleSelect?: (id: string) => void;
}

export function MovieCard({
	movie,
	onMovieUpdate,
	selectionMode = false,
	selected = false,
	onToggleSelect,
}: MovieCardProps) {
	const handleClick = useCallback(() => {
		if (selectionMode) {
			onToggleSelect?.(movie.id);
		} else {
			route(`/movie/${movie.id}`);
		}
	}, [movie.id, selectionMode, onToggleSelect]);

	const handlePlay = useCallback(
		(e: Event) => {
			e.stopPropagation();
			if (!selectionMode) playMovie(movie.id, { fromBeginning: true });
		},
		[movie.id, selectionMode],
	);

	const handleResume = useCallback(
		(e: Event) => {
			e.stopPropagation();
			if (!selectionMode) playMovie(movie.id);
		},
		[movie.id, selectionMode],
	);

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

			{hasWatchProgress(movie) && (
				<div class={styles.progressBar}>
					<div
						class={styles.progressFill}
						style={{ width: `${getWatchPercent(movie)}%` }}
					/>
				</div>
			)}

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
							<MovieOptionsMenu movie={movie} onMovieUpdate={onMovieUpdate} compact />
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
