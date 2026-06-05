import { Icon } from '@/components/common/Icon';
import { useWatchPosition } from '@/hooks/useWatchPosition';
import { playMovie } from '@/state/globalPlayer.state';
import { getWatchPercent } from '@/utils/watch-progress';
import styles from './PlayResumeButton.module.scss';

interface PlayResumeMovie {
	id: string;
	watchPosition?: number;
	durationSeconds?: number;
	watchProgress?: number;
}

interface PlayResumeButtonProps {
	movie: PlayResumeMovie;
	/** Visual size. `lg` matches the movie-detail hero button. Default `md`. */
	size?: 'sm' | 'md' | 'lg';
	/** Extra class merged onto the root. */
	class?: string;
	/** Play-from-start handler. Defaults to `playMovie(id, { fromBeginning })`. */
	onPlay?: (e: Event) => void;
	/** Resume handler. Defaults to `playMovie(id)`. */
	onResume?: (e: Event) => void;
}

const ICON_SIZE: Record<NonNullable<PlayResumeButtonProps['size']>, number> = {
	sm: 12,
	md: 14,
	lg: 16,
};

/**
 * Dynamic Play / Resume control shared by the movie-detail hero and the
 * Library row view. When the movie has partial watch progress it renders the
 * hybrid split button — a Play-from-start icon next to a "Resume" action — with
 * a thin progress bar underneath; otherwise a single primary Play button.
 *
 * Watch state is read live via `useWatchPosition` (falling back to the movie's
 * own fields) so the hybrid state appears/updates as playback advances. All
 * clicks `stopPropagation` so the control works inside clickable rows/cards.
 */
export function PlayResumeButton({
	movie,
	size = 'md',
	class: className,
	onPlay,
	onResume,
}: PlayResumeButtonProps) {
	const watch = useWatchPosition(movie.id, {
		watchPosition: movie.watchPosition,
		durationSeconds: movie.durationSeconds,
	});
	const showResume = !!watch?.hasProgress;
	const resumePercent = watch?.percent ?? getWatchPercent(movie);
	const iconSize = ICON_SIZE[size];

	const doPlay = (e: Event) => {
		e.stopPropagation();
		if (onPlay) onPlay(e);
		else playMovie(movie.id, { fromBeginning: true });
	};
	const doResume = (e: Event) => {
		e.stopPropagation();
		if (onResume) onResume(e);
		else playMovie(movie.id);
	};

	if (showResume) {
		return (
			<div class={`${styles.group} ${styles[size]} ${className ?? ''}`}>
				<div class={styles.hybrid}>
					<button
						type="button"
						class={styles.play}
						onClick={doPlay}
						aria-label="Play from beginning"
					>
						<Icon name="play" size={iconSize} />
					</button>
					<button type="button" class={styles.resume} onClick={doResume}>
						Resume
					</button>
				</div>
				<div class={styles.progress}>
					<div class={styles.progressFill} style={{ width: `${resumePercent}%` }} />
				</div>
			</div>
		);
	}

	return (
		<button
			type="button"
			class={`${styles.single} ${styles[size]} ${className ?? ''}`}
			onClick={doPlay}
			aria-label="Play"
		>
			<Icon name="play" size={iconSize} />
			<span>Play</span>
		</button>
	);
}
