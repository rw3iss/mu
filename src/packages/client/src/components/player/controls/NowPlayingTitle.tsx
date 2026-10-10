import { route } from 'preact-router';
import { globalMovieId, minimizePlayer, playerMode } from '@/state/globalPlayer.state';
import { currentTime, duration } from '@/state/player.state';
import { shareMode } from '@/state/share.state';
import styles from '../PlayerControls.module.scss';
import { formatTime } from './formatTime';
import type { ControlGroupProps } from './types';

/**
 * Left section: linked title + timing. Split mode shows only the timing
 * (the title is rendered above the player there).
 */
export function NowPlayingTitle({ title, isSplit, onToggleInfo }: ControlGroupProps) {
	if (isSplit) {
		return (
			<div class={styles.splitTimeLeft}>
				{formatTime(currentTime.value)} / {formatTime(duration.value)}
			</div>
		);
	}
	return (
		<div class={styles.leftSection}>
			{title && globalMovieId.value && (
				<a
					// In share-watch mode the recipient can't reach
					// /movie/:id, so the title acts as an "open info"
					// affordance instead — same behaviour as the info
					// button in the player toolbar.
					href={shareMode.value ? undefined : `/movie/${globalMovieId.value}`}
					class={styles.titleText}
					onClick={(e) => {
						e.preventDefault();
						if (shareMode.value) {
							onToggleInfo();
							return;
						}
						if (playerMode.value !== 'mini') {
							minimizePlayer();
						}
						route(`/movie/${globalMovieId.value}`);
					}}
				>
					{title}
				</a>
			)}
			<span class={styles.timingLabel}>
				{formatTime(currentTime.value)} / {formatTime(duration.value)}
			</span>
		</div>
	);
}
