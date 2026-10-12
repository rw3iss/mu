import { route } from 'preact-router';
import { minimizePlayer, playerMode } from '@/state/globalPlayer.state';
import { currentTrack } from '@/state/musicPlayer.state';
import { currentTime, duration } from '@/state/player.state';
import { listenToken } from '@/state/share.state';
import styles from '../PlayerControls.module.scss';
import { formatTime } from './formatTime';
import type { ControlGroupProps } from './types';

/** Go to a music page, getting the full player out of the way first. */
export function openMusicLink(href: string, e?: Event): void {
	e?.preventDefault();
	// Shared-link listeners have no access to library pages.
	if (listenToken.value) return;
	if (playerMode.value === 'full') minimizePlayer();
	route(href);
}

/**
 * Audio left section: "Track — Artist · Album" (each part links to its page)
 * plus timing. Split mode shows only the timing, like the video title group.
 */
export function TrackTitle({ isSplit }: ControlGroupProps) {
	const timing = `${formatTime(currentTime.value)} / ${formatTime(duration.value)}`;
	if (isSplit) return <div class={styles.splitTimeLeft}>{timing}</div>;
	const t = currentTrack.value?.track;
	const artist = t?.artists[0];
	return (
		<div class={styles.leftSection}>
			{t && (
				<span class={styles.trackTitleLine}>
					<a
						href={`/track/${t.id}`}
						class={`${styles.titleText} ${styles.trackTitleText}`}
						onClick={(e) => openMusicLink(`/track/${t.id}`, e)}
					>
						{t.title}
					</a>
					<span class={styles.trackMeta}>
						{' — '}
						{artist ? (
							<a
								href={`/artist/${artist.id}`}
								onClick={(e) => openMusicLink(`/artist/${artist.id}`, e)}
							>
								{t.artistCredit || artist.name}
							</a>
						) : (
							<span>{t.artistCredit || 'Unknown artist'}</span>
						)}
						{' · '}
						<a
							href={`/album/${t.albumId}`}
							onClick={(e) => openMusicLink(`/album/${t.albumId}`, e)}
						>
							{t.albumTitle}
						</a>
					</span>
				</span>
			)}
			<span class={styles.timingLabel}>{timing}</span>
		</div>
	);
}
