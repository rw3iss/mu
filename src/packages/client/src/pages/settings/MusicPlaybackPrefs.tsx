import { AUDIO_QUALITIES, type AudioQuality, type ReplayGainMode } from '@mu/shared';
import { getUiSettingSignal } from '@/hooks/useUiSetting';
import { musicEnabled } from '@/state/features.state';
import {
	MUSIC_RESUME_AFTER_VIDEO_KEY,
	musicGapless,
	musicReplayGain,
	musicStreamProfile,
} from '@/state/musicPlayer.state';
import { setMusicPref } from '@/state/musicPrefs.state';
import styles from '../Settings.module.scss';

const QUALITY_LABELS: Record<AudioQuality, string> = {
	original: 'Original',
	lossless: 'Lossless (FLAC)',
	high: 'High',
	normal: 'Normal',
	low: 'Low (mobile data)',
};

const resumeAfterVideo = getUiSettingSignal<boolean>(MUSIC_RESUME_AFTER_VIDEO_KEY, true);

/**
 * Settings → Playback → Music (per user). Saved immediately, per device and to
 * the user's account. The server caps quality at the admin maximum.
 */
export function MusicPlaybackPrefs() {
	if (!musicEnabled.value) return null;
	return (
		<>
			<h3 class={styles.sectionTitle}>Music</h3>
			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Music Quality</span>
					<span class={styles.settingDescription}>
						Original plays the file as stored when your browser supports it.
					</span>
				</div>
				<select
					class={styles.select}
					value={musicStreamProfile.value}
					onChange={(e) =>
						setMusicPref(
							'streamProfile',
							(e.target as HTMLSelectElement).value as AudioQuality,
						)
					}
				>
					{AUDIO_QUALITIES.map((q) => (
						<option key={q} value={q}>
							{QUALITY_LABELS[q]}
						</option>
					))}
				</select>
			</div>
			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>ReplayGain</span>
					<span class={styles.settingDescription}>
						Level out loudness between tracks or albums.
					</span>
				</div>
				<select
					class={styles.select}
					value={musicReplayGain.value}
					onChange={(e) =>
						setMusicPref(
							'replayGain',
							(e.target as HTMLSelectElement).value as ReplayGainMode,
						)
					}
				>
					<option value="off">Off</option>
					<option value="track">Track</option>
					<option value="album">Album</option>
				</select>
			</div>
			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Gapless Playback</span>
				</div>
				<label class={styles.toggle}>
					<input
						type="checkbox"
						checked={musicGapless.value}
						onChange={(e) =>
							setMusicPref('gapless', (e.target as HTMLInputElement).checked)
						}
					/>
					<span class={styles.toggleTrack} />
				</label>
			</div>
			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Resume Music After Video</span>
					<span class={styles.settingDescription}>
						When you close a movie, continue the paused music.
					</span>
				</div>
				<label class={styles.toggle}>
					<input
						type="checkbox"
						checked={resumeAfterVideo.value}
						onChange={(e) =>
							setMusicPref('resumeAfterVideo', (e.target as HTMLInputElement).checked)
						}
					/>
					<span class={styles.toggleTrack} />
				</label>
			</div>
		</>
	);
}
