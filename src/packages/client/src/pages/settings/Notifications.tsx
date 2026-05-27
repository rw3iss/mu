import { useState } from 'preact/hooks';
import styles from '../Settings.module.scss';

/**
 * Notifications tab — two boolean toggles, persisted directly to
 * localStorage (no server round-trip). The `shouldNotify*` helpers
 * in `notifications.state.ts` read these same keys.
 *
 * Extracted from Settings.tsx per the audit's Phase C plan.
 */
export function Notifications() {
	const [notifyScanResults, setNotifyScanResults] = useState(
		() => localStorage.getItem('mu_notify_scan') !== 'false',
	);
	const [notifyPlaylist, setNotifyPlaylist] = useState(
		() => localStorage.getItem('mu_notify_playlist') !== 'false',
	);

	return (
		<div class={styles.panel}>
			<h2 class={styles.panelTitle}>Notifications</h2>

			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Notify for scan results</span>
					<span class={styles.settingDescription}>
						Show toast notifications when library scans start, complete, or fail
					</span>
				</div>
				<label class={styles.toggle}>
					<input
						type="checkbox"
						checked={notifyScanResults}
						onChange={(e) => {
							const checked = (e.target as HTMLInputElement).checked;
							setNotifyScanResults(checked);
							localStorage.setItem('mu_notify_scan', String(checked));
						}}
					/>
					<span class={styles.toggleTrack} />
				</label>
			</div>

			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Notify for playlist changes</span>
					<span class={styles.settingDescription}>
						Show toast notifications when movies are added to or removed from
						playlists
					</span>
				</div>
				<label class={styles.toggle}>
					<input
						type="checkbox"
						checked={notifyPlaylist}
						onChange={(e) => {
							const checked = (e.target as HTMLInputElement).checked;
							setNotifyPlaylist(checked);
							localStorage.setItem('mu_notify_playlist', String(checked));
						}}
					/>
					<span class={styles.toggleTrack} />
				</label>
			</div>
		</div>
	);
}
