import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { playMovie } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { processingMovieIds } from '@/state/processing.state';
import { getRatingColor } from '@/utils/rating-color';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieCard.module.scss';
import { MovieOptionsMenu } from './MovieOptionsMenu';

interface MovieCardProps {
	movie: Movie;
	onMovieUpdate?: (movie: Movie) => void;
}

export function MovieCard({ movie, onMovieUpdate }: MovieCardProps) {
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
	const transcodeNeeded = needsTranscode(movie);
	const streamLabel = getStreamModeLabel(movie);
	const isProcessing = processingMovieIds.value.has(movie.id);

	return (
		<div
			class={`${styles.card} ${movie.hidden ? styles.hidden : ''} ${isProcessing ? styles.processing : ''}`}
			onClick={handleClick}
			role="button"
			tabIndex={0}
		>
			{isProcessing && <div class={styles.processingOverlay}>Processing...</div>}
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

			{hasWatchProgress(movie) && (
				<div class={styles.progressBar}>
					<div
						class={styles.progressFill}
						style={{ width: `${getWatchPercent(movie)}%` }}
					/>
				</div>
			)}

			<div class={styles.info}>
				<h3 class={styles.title}>{movie.title}</h3>
				<div class={styles.details}>
					{movie.year && <span class={styles.year}>{movie.year}</span>}
					{movie.year && movie.runtime > 0 && <span class={styles.dot}>{'\u00B7'}</span>}
					{movie.runtime > 0 && (
						<span class={styles.runtime}>
							{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m
						</span>
					)}
					<PluginSlot name={UI.MOVIE_ITEM_RATING} context={{ movie }} />
					{!movie.remoteOrigin && (
						<span class={styles.optionsWrap}>
							<MovieOptionsMenu movie={movie} onMovieUpdate={onMovieUpdate} compact />
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
