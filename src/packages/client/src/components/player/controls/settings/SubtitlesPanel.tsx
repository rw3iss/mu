import { Icon } from '@/components/common/Icon';
import { globalMovieId } from '@/state/globalPlayer.state';
import { saveSubtitleChoice, subtitleTrack } from '@/state/player.state';
import styles from '../../PlayerControls.module.scss';
import type { SettingsMenuApi } from './types';

export function SubtitlesPanel({ session, openPanel, close }: SettingsMenuApi) {
	const handleSubtitleSelect = (trackId: string | null) => {
		const movieId = globalMovieId.value;
		if (movieId) {
			saveSubtitleChoice(movieId, trackId);
		} else {
			subtitleTrack.value = trackId;
		}
		close();
	};

	return (
		<>
			<button class={styles.menuBack} onClick={() => openPanel('main')}>
				<Icon name="chevron-left" size={14} /> Subtitles
			</button>
			<button
				class={`${styles.menuItem} ${subtitleTrack.value === null ? styles.selected : ''}`}
				onClick={() => handleSubtitleSelect(null)}
			>
				Off
			</button>
			{/* The movie's default track is surfaced here (not just in
													    Manage Subtitles) and floated to the top of the list. */}
			{[...(session?.subtitles ?? [])]
				.sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false))
				.map((track) => (
					<button
						key={track.id}
						class={`${styles.menuItem} ${
							subtitleTrack.value === track.id ? styles.selected : ''
						}`}
						onClick={() => handleSubtitleSelect(track.id)}
					>
						{track.label}
						{track.default && <span class={styles.menuItemBadge}>Default</span>}
					</button>
				))}
			<div class={styles.menuDivider} />
			<button class={styles.menuItem} onClick={() => openPanel('subtitle-manage')}>
				Manage Subtitles <Icon name="chevron-right" size={14} />
			</button>
		</>
	);
}
