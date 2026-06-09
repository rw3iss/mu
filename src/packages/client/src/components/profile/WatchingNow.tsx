import type { CurrentlyWatching } from '@mu/shared';
import { SmartImage } from '@/components/common/SmartImage';
import { clockFromSeconds } from '@/utils/time-format';
import styles from './WatchingNow.module.scss';

interface WatchingNowProps {
	watching: CurrentlyWatching;
}

/**
 * A prominent "Watching Now" tout shown above the watch history when the user
 * has a live session. Backdrop-led, with a pulsing accent indicator and the
 * current resume position. Links to the movie detail page.
 */
export function WatchingNow({ watching }: WatchingNowProps) {
	const pct =
		watching.durationSeconds && watching.durationSeconds > 0
			? Math.min(100, Math.round((watching.positionSeconds / watching.durationSeconds) * 100))
			: 0;
	const href = `/movie/${watching.movieId}`;

	return (
		<a class={styles.tout} href={href}>
			<SmartImage
				src={watching.backdropUrl || watching.posterUrl}
				alt={watching.title}
				class={styles.backdropWrap}
				imgClass={styles.backdrop}
				iconOnly
			/>
			<div class={styles.scrim} />
			<div class={styles.content}>
				<span class={styles.eyebrow}>
					<span class={styles.dot} aria-hidden="true" />
					Watching Now
				</span>
				<h3 class={styles.title}>
					{watching.title}
					{watching.year ? <span class={styles.year}> · {watching.year}</span> : null}
				</h3>
				<div class={styles.progress}>
					<div class={styles.bar}>
						<div class={styles.fill} style={{ width: `${pct}%` }} />
					</div>
					{watching.durationSeconds ? (
						<span class={styles.time}>
							{clockFromSeconds(watching.positionSeconds)} / {clockFromSeconds(watching.durationSeconds)}
						</span>
					) : (
						<span class={styles.time}>{clockFromSeconds(watching.positionSeconds)}</span>
					)}
				</div>
			</div>
		</a>
	);
}
