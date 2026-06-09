import type { ProfileHistoryItem } from '@mu/shared';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { clockFromSeconds, relativeTime } from '@/utils/time-format';
import styles from './ProfileHistoryList.module.scss';

interface ProfileHistoryListProps {
	history: ProfileHistoryItem[];
}

// ── helpers (hoisted) ─────────────────────────────────────────────────────

function progressPercent(item: ProfileHistoryItem): number {
	if (item.completed) return 100;
	if (!item.durationSeconds || item.durationSeconds <= 0) return 0;
	return Math.min(100, Math.round((item.positionSeconds / item.durationSeconds) * 100));
}

/**
 * A list of a user's recently-watched movies, most-recent first, each with its
 * resume position shown as a progress bar. Rows link to the movie detail page.
 */
export function ProfileHistoryList({ history }: ProfileHistoryListProps) {
	if (history.length === 0) {
		return <p class={styles.empty}>Nothing watched yet.</p>;
	}

	return (
		<ul class={styles.list}>
			{history.map((item) => {
				const pct = progressPercent(item);
				return (
					<li key={`${item.movieId}-${item.watchedAt}`}>
						<a class={styles.row} href={`/movie/${item.movieId}`}>
							<SmartImage
								src={item.posterUrl}
								alt={item.title}
								class={styles.posterWrap}
								imgClass={styles.poster}
								fallbackLabel={item.title}
							/>
							<div class={styles.info}>
								<div class={styles.titleRow}>
									<span class={styles.title}>{item.title}</span>
									{item.year ? <span class={styles.year}>{item.year}</span> : null}
									{item.completed && <span class={styles.done}>Watched</span>}
									{item.rating != null && (
										<span class={styles.rating} title={`Rated ${item.rating.toFixed(1)} / 10`}>
											<Icon name="star-filled" size={12} />
											{item.rating.toFixed(1)}
										</span>
									)}
								</div>
								<div class={styles.meta}>
									<span class={styles.when}>{relativeTime(item.watchedAt)}</span>
									{item.durationSeconds ? (
										<span class={styles.position}>
											{clockFromSeconds(item.completed ? item.durationSeconds : item.positionSeconds)} /{' '}
											{clockFromSeconds(item.durationSeconds)}
										</span>
									) : item.positionSeconds > 0 ? (
										<span class={styles.position}>{clockFromSeconds(item.positionSeconds)}</span>
									) : null}
								</div>
								<div class={styles.bar} role="presentation">
									<div class={styles.fill} style={{ width: `${pct}%` }} />
								</div>
							</div>
						</a>
					</li>
				);
			})}
		</ul>
	);
}
