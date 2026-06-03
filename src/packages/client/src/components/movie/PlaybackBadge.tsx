import type { Movie } from '@/state/library.state';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import styles from './PlaybackBadge.module.scss';

interface PlaybackBadgeProps {
	movie: Movie;
	/** Extra classes for positioning in the host layout. */
	class?: string;
}

/**
 * Small pill showing the file's playback / stream mode — "Direct Play",
 * "Remux", or "Transcode". Green when it direct-plays, amber when it needs
 * any transcoding/remuxing. Self-contained colours so it reads on both light
 * (detail page) and dark (player flyout) backgrounds. Renders nothing when the
 * mode can't be determined (no probed file info).
 */
export function PlaybackBadge({ movie, class: className }: PlaybackBadgeProps) {
	const label = getStreamModeLabel(movie);
	if (!label) return null;
	const variant = needsTranscode(movie) ? styles.warn : styles.success;
	return <span class={`${styles.badge} ${variant} ${className ?? ''}`}>{label}</span>;
}
