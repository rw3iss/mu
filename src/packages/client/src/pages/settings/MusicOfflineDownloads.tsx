import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { musicEnabled } from '@/state/features.state';
import {
	cancelDownload,
	clearOfflineMusic,
	downloadJobs,
	offlineAllowed,
	offlineBudgetGb,
	offlineBytes,
	offlineManifest,
	offlinePolicy,
	refreshStorageInfo,
	removeGroup,
	setKeep,
	setUserOfflineLimitGb,
	storageInfo,
	userOfflineLimitGb,
} from '@/state/musicOffline.state';
import { formatBytes } from '@/utils/format-bytes';
import styles from '../Settings.module.scss';
import local from './MusicOfflineDownloads.module.scss';

const KIND_LABEL = { album: 'Album', playlist: 'Playlist', track: 'Track' } as const;

/**
 * Settings → Playback → Offline Music (per device). Lists downloaded albums /
 * playlists / tracks with size, Keep pins and removal; the per-device limit
 * (capped by the admin) and browser storage usage.
 */
export function MusicOfflineDownloads() {
	const [limitDraft, setLimitDraft] = useState('');
	const manifest = offlineManifest.value;
	const groups = Object.values(manifest.groups).sort((a, b) => b.addedAt - a.addedAt);
	const jobs = downloadJobs.value;
	const used = offlineBytes.value;
	const cap = offlinePolicy.value?.maxOfflineGbPerDevice ?? null;

	useEffect(() => {
		void refreshStorageInfo();
	}, []);
	useEffect(() => {
		setLimitDraft(userOfflineLimitGb.value === null ? '' : String(userOfflineLimitGb.value));
	}, [userOfflineLimitGb.value]);

	if (!musicEnabled.value) return null;
	if (!offlineAllowed.value && groups.length === 0) return null;

	const groupBytes = (trackIds: string[]) =>
		trackIds.reduce((s, id) => s + (manifest.tracks[id]?.bytes ?? 0), 0);

	const saveLimit = () => {
		const n = Number(limitDraft);
		const value = limitDraft.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
		void setUserOfflineLimitGb(value);
	};

	const info = storageInfo.value;

	return (
		<>
			<h3 class={styles.sectionTitle}>Offline Music</h3>
			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Space Used on This Device</span>
					<span class={styles.settingDescription}>
						{formatBytes(used, 1)} of {offlineBudgetGb.value} GB
						{info
							? ` · browser storage ${formatBytes(info.usage, 1)} / ${formatBytes(info.quota, 0)}${info.persisted ? ' (persistent)' : ''}`
							: ''}
					</span>
				</div>
			</div>
			<div class={styles.settingRow}>
				<div class={styles.settingInfo}>
					<span class={styles.settingLabel}>Offline Storage Limit (GB)</span>
					<span class={styles.settingDescription}>
						When full, the least recently played downloads are removed first, except
						albums and playlists marked Keep.
						{cap !== null
							? ` Maximum ${cap} GB (set by the admin). Empty = maximum.`
							: ''}
					</span>
				</div>
				<input
					class={`${styles.input} ${local.limit}`}
					type="number"
					min={0.5}
					step={0.5}
					max={cap ?? undefined}
					placeholder={cap !== null ? String(cap) : ''}
					value={limitDraft}
					onInput={(e) => setLimitDraft((e.target as HTMLInputElement).value)}
					onBlur={saveLimit}
					onKeyDown={(e) => e.key === 'Enter' && saveLimit()}
				/>
			</div>

			{groups.length === 0 ? (
				<p class={styles.settingDescription}>
					Nothing downloaded yet. Use Download on an album, playlist or track.
				</p>
			) : (
				<ul class={local.list}>
					{groups.map((g) => {
						const have = g.trackIds.filter((id) => manifest.tracks[id]).length;
						const job = jobs[g.key];
						return (
							<li key={g.key} class={local.row}>
								<div class={local.info}>
									<span class={local.title}>{g.title}</span>
									<span class={local.meta}>
										{KIND_LABEL[g.kind]} ·{' '}
										{job
											? `${job.done}/${job.total}`
											: `${have}/${g.trackIds.length}`}{' '}
										tracks · {formatBytes(groupBytes(g.trackIds), 1)}
									</span>
								</div>
								<div class={local.rowActions}>
									{job ? (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => cancelDownload(g.key)}
										>
											Stop
										</Button>
									) : null}
									<Button
										variant={g.keep ? 'primary' : 'ghost'}
										size="sm"
										onClick={() => setKeep(g.key, !g.keep)}
										title="Keep: never remove this to free space"
									>
										Keep
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void removeGroup(g.key)}
									>
										Remove
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			{groups.length > 0 && (
				<div class={local.footer}>
					<Button
						variant="danger"
						size="sm"
						onClick={() => {
							if (window.confirm('Remove all offline music from this device?')) {
								void clearOfflineMusic();
							}
						}}
					>
						Clear offline music
					</Button>
				</div>
			)}
		</>
	);
}
