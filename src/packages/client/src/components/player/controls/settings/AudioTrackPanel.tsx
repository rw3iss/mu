import { Icon } from '@/components/common/Icon';
import { globalMovieId } from '@/state/globalPlayer.state';
import { audioTrack, currentSession, saveAudioTrackChoice } from '@/state/player.state';
import styles from '../../PlayerControls.module.scss';
import type { SettingsMenuApi } from './types';

export function AudioTrackPanel({ session, openPanel, close }: SettingsMenuApi) {
	const handleAudioTrackSelect = (trackId: string) => {
		const movieId = globalMovieId.value;
		if (movieId) {
			saveAudioTrackChoice(movieId, trackId);
		} else {
			audioTrack.value = trackId;
		}
		close();
		// The browser can't switch a native MP4's audio stream, so changing
		// track means a new session. The player's reload hook restarts it at
		// the current position (or waits for the server to finish preparing a
		// single-track variant, then switches automatically).
		if (movieId && String(currentSession.value?.audioTrack ?? 0) !== trackId) {
			window.dispatchEvent(new CustomEvent('mu:stream-reload', { detail: { movieId } }));
		}
	};

	return (
		<>
			<button class={styles.menuBack} onClick={() => openPanel('main')}>
				<Icon name="chevron-left" size={14} /> Audio Track
			</button>
			{(session?.audioTracks ?? []).map((track) => {
				const trackId = String(track.id);
				// Highlight the track actually being
				// served, not the last click — a pick
				// can still be preparing.
				const playingId = String(
					session?.audioTrack ?? audioTrack.value ?? session?.audioTracks?.[0]?.id ?? '0',
				);
				const isSelected = playingId === trackId;
				const isPreparing =
					session?.audioTrackPending != null &&
					String(session.audioTrackPending) === trackId;
				const lang = (track.language || 'und').toUpperCase();
				const label =
					track.label && track.label !== track.language
						? `${lang} — ${track.label}`
						: lang;
				const channels = track.channels
					? ` (${track.channels === 6 ? '5.1' : track.channels === 8 ? '7.1' : `${track.channels}ch`})`
					: '';
				return (
					<button
						key={trackId}
						class={`${styles.menuItem} ${isSelected ? styles.selected : ''}`}
						onClick={() => handleAudioTrackSelect(trackId)}
					>
						{label}
						{channels}
						{isPreparing && ' · preparing…'}
					</button>
				);
			})}
		</>
	);
}
