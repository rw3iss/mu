import { useCallback, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { playMovie } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { getRatingColor } from '@/utils/rating-color';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieLargeCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';

interface MovieLargeCardProps {
	movie: Movie;
	onMovieUpdate?: (movie: Movie) => void;
	selectionMode?: boolean;
	selected?: boolean;
	onToggleSelect?: (id: string) => void;
}

export function MovieLargeCard({
	movie,
	onMovieUpdate,
	selectionMode = false,
	selected = false,
	onToggleSelect,
}: MovieLargeCardProps) {
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
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={`${movie.title}`}
						loading="lazy"
						class={styles.thumbnailImage}
					/>
				) : (
					<div class={styles.thumbnailPlaceholder}>
						<span>{(movie.title ?? '?').charAt(0)}</span>
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
						{rating > 0 && (
							<span class={styles.ratingBadge} style={{ background: ratingColor }}>
								{rating.toFixed(1)}
							</span>
						)}
						<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
						{!selectionMode && !movie.remoteOrigin && (
							<MovieOptionsMenu movie={movie} onMovieUpdate={onMovieUpdate} compact />
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
