import {
	AUDIO_QUALITIES,
	type AudioQuality,
	DEFAULT_MUSIC_SETTINGS,
	type FeatureFlags,
	type MusicSettings as MusicSettingsDto,
	type ReplayGainMode,
} from '@mu/shared';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import type { MediaPathEntryData } from '@/components/library/MediaPathList';
import { MediaPathList } from '@/components/library/MediaPathList';
import { api } from '@/services/api';
import { musicService } from '@/services/music.service';
import { sourcesService } from '@/services/sources.service';
import { features, loadFeatures } from '@/state/features.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from '../Settings.module.scss';

const QUALITY_LABELS: Record<AudioQuality, string> = {
	original: 'Original (no transcode)',
	lossless: 'Lossless (FLAC)',
	high: 'High',
	normal: 'Normal',
	low: 'Low',
};

const NUMBER_STYLE = { width: '110px', minWidth: 0, flex: 'none', textAlign: 'right' } as const;

function Row({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: ComponentChildren;
}) {
	return (
		<div class={styles.settingRow}>
			<div class={styles.settingInfo}>
				<span class={styles.settingLabel}>{label}</span>
				{description && <span class={styles.settingDescription}>{description}</span>}
			</div>
			{children}
		</div>
	);
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<label class={styles.toggle}>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
			/>
			<span class={styles.toggleTrack} />
		</label>
	);
}

function NumberInput({
	value,
	min,
	max,
	onChange,
}: {
	value: number;
	min: number;
	max: number;
	onChange: (v: number) => void;
}) {
	return (
		<input
			type="number"
			class={styles.input}
			style={NUMBER_STYLE}
			value={value}
			min={min}
			max={max}
			onChange={(e) => {
				const v = Number((e.target as HTMLInputElement).value);
				if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
			}}
		/>
	);
}

function QualitySelect({
	value,
	onChange,
}: {
	value: AudioQuality;
	onChange: (v: AudioQuality) => void;
}) {
	return (
		<select
			class={styles.select}
			value={value}
			onChange={(e) => onChange((e.target as HTMLSelectElement).value as AudioQuality)}
		>
			{AUDIO_QUALITIES.map((q) => (
				<option key={q} value={q}>
					{QUALITY_LABELS[q]}
				</option>
			))}
		</select>
	);
}

/**
 * Settings → Music (admin). Feature switches, music folders, and the `music`
 * settings blob (import, encoding, playback, offline). Music folders and the
 * settings below them only show while the Music feature is on.
 */
export function MusicSettings() {
	const [flags, setFlags] = useState<FeatureFlags>({ ...features.value });
	const [settings, setSettings] = useState<MusicSettingsDto>(DEFAULT_MUSIC_SETTINGS);
	const [folders, setFolders] = useState<MediaPathEntryData[]>([{ path: '', source: null }]);
	const [isSaving, setIsSaving] = useState(false);
	const [isScanning, setIsScanning] = useState(false);

	const loadMusic = useCallback(async () => {
		try {
			const [s, sources] = await Promise.all([
				musicService.settings(),
				sourcesService.getAll('audio'),
			]);
			setSettings(s);
			setFolders(
				sources.length > 0
					? sources.map((src) => ({ path: src.path, source: src }))
					: [{ path: '', source: null }],
			);
		} catch {
			// Music is off (routes 404) — keep defaults.
		}
	}, []);

	useEffect(() => {
		setFlags({ ...features.value });
		if (features.value.music) void loadMusic();
	}, [features.value, loadMusic]);

	const set = <K extends keyof MusicSettingsDto>(key: K, value: MusicSettingsDto[K]) =>
		setSettings((s) => ({ ...s, [key]: value }));

	const saveFeatures = useCallback(async (next: FeatureFlags) => {
		if (!next.movies && !next.music) {
			notifyError('At least one of Movies or Music must stay enabled.');
			return;
		}
		setFlags(next);
		try {
			await api.put('/features', next);
			await loadFeatures();
			notifySuccess(
				`Music ${next.music ? 'enabled' : 'disabled'}, Movies ${next.movies ? 'enabled' : 'disabled'}`,
			);
		} catch {
			notifyError('Failed to update features');
			setFlags({ ...features.value });
		}
	}, []);

	const handleSave = useCallback(async () => {
		setIsSaving(true);
		try {
			const paths = folders.map((f) => f.path.trim()).filter(Boolean);
			const sync = await sourcesService.sync(paths, 'audio');
			for (const w of sync.created.map((c) => c.warning).filter(Boolean)) notifyError(w!);
			const saved = await musicService.saveSettings(settings);
			setSettings(saved);
			await loadMusic();
			notifySuccess('Music settings saved');
		} catch {
			notifyError('Failed to save music settings');
		} finally {
			setIsSaving(false);
		}
	}, [folders, settings, loadMusic]);

	const handleScan = useCallback(async () => {
		setIsScanning(true);
		try {
			await api.post('/music/admin/scan');
			notifySuccess('Music scan started');
		} catch {
			notifyError('Failed to start the music scan');
		} finally {
			setIsScanning(false);
		}
	}, []);

	return (
		<div class={styles.panel}>
			<h2 class={styles.panelTitle}>Music</h2>

			<h3 class={styles.sectionTitle}>Features</h3>
			<Row
				label="Enable Music"
				description="Adds a Music mode (artists, albums, tracks), music folders, and the audio player. Off hides every music page and route."
			>
				<Toggle
					checked={flags.music}
					onChange={(v) => saveFeatures({ ...flags, music: v })}
				/>
			</Row>
			<Row
				label="Enable Movies"
				description="Turn off for a music-only server. Movie data is kept and returns when re-enabled."
			>
				<Toggle
					checked={flags.movies}
					onChange={(v) => saveFeatures({ ...flags, movies: v })}
				/>
			</Row>

			{flags.music && (
				<>
					<h3 class={styles.sectionTitle}>Music Folders</h3>
					<div class={styles.settingGroup}>
						<div class={styles.settingInfo}>
							<span class={styles.settingLabel}>Folders</span>
							<span class={styles.settingDescription}>
								Directories containing your music. Keep them separate from movie
								folders.
							</span>
						</div>
						<MediaPathList entries={folders} onChange={setFolders} showBrowse={true} />
					</div>
					<div class={styles.scanRow}>
						<Button variant="secondary" loading={isScanning} onClick={handleScan}>
							{isScanning ? 'Starting…' : 'Scan Music Now'}
						</Button>
					</div>

					<h3 class={styles.sectionTitle}>Import</h3>
					<Row
						label="Minimum Track Length"
						description="Skip audio files shorter than this many seconds (jingles, silence)."
					>
						<NumberInput
							value={settings.minDurationSeconds}
							min={0}
							max={600}
							onChange={(v) => set('minDurationSeconds', v)}
						/>
					</Row>
					<Row
						label="Album Grouping"
						description="How tracks are grouped into albums. 'Tags + folder' keeps same-named albums in different folders apart."
					>
						<select
							class={styles.select}
							value={settings.grouping}
							onChange={(e) =>
								set(
									'grouping',
									(e.target as HTMLSelectElement)
										.value as MusicSettingsDto['grouping'],
								)
							}
						>
							<option value="tags+folder">Tags + folder</option>
							<option value="tags">Tags only</option>
							<option value="folder">Folder only</option>
						</select>
					</Row>
					<Row
						label="Waveforms"
						description="Build a waveform for every track, shown as the seek bar."
					>
						<Toggle
							checked={settings.waveforms}
							onChange={(v) => set('waveforms', v)}
						/>
					</Row>
					<Row label="Fetch Lyrics" description="Look up lyrics on LRCLIB after import.">
						<Toggle
							checked={settings.fetchLyrics}
							onChange={(v) => set('fetchLyrics', v)}
						/>
					</Row>

					<h3 class={styles.sectionTitle}>Encoding</h3>
					<Row
						label="Transcode Unplayable Formats on Import"
						description="Make a cached FLAC copy of formats no browser plays (APE, WavPack, DSD…) right after import, so the first play starts at once."
					>
						<Toggle
							checked={settings.transcodeUnplayableAtIngest}
							onChange={(v) => set('transcodeUnplayableAtIngest', v)}
						/>
					</Row>
					<Row label="High Bitrate (kbps)">
						<NumberInput
							value={settings.bitrates.high}
							min={64}
							max={512}
							onChange={(v) => set('bitrates', { ...settings.bitrates, high: v })}
						/>
					</Row>
					<Row label="Normal Bitrate (kbps)">
						<NumberInput
							value={settings.bitrates.normal}
							min={48}
							max={320}
							onChange={(v) => set('bitrates', { ...settings.bitrates, normal: v })}
						/>
					</Row>
					<Row label="Low Bitrate (kbps)">
						<NumberInput
							value={settings.bitrates.low}
							min={24}
							max={192}
							onChange={(v) => set('bitrates', { ...settings.bitrates, low: v })}
						/>
					</Row>
					<Row
						label="Concurrent Music Jobs"
						description="Maximum music jobs (waveforms, transcodes) that run at the same time, within the global job limit."
					>
						<NumberInput
							value={settings.maxConcurrentJobs}
							min={1}
							max={8}
							onChange={(v) => set('maxConcurrentJobs', v)}
						/>
					</Row>
					<Row
						label="Transcode Cache Limit (GB)"
						description="Least-recently-used music transcodes are deleted above this size. FLAC copies of unplayable formats are kept."
					>
						<NumberInput
							value={settings.transcodeCacheMaxGb}
							min={1}
							max={2000}
							onChange={(v) => set('transcodeCacheMaxGb', v)}
						/>
					</Row>

					<h3 class={styles.sectionTitle}>Playback</h3>
					<Row
						label="Default Quality"
						description="Quality used when a user has not chosen one."
					>
						<QualitySelect
							value={settings.defaultProfile}
							onChange={(v) => set('defaultProfile', v)}
						/>
					</Row>
					<Row
						label="Maximum Quality"
						description="Caps every stream, e.g. to save upload bandwidth."
					>
						<QualitySelect
							value={settings.maxProfile}
							onChange={(v) => set('maxProfile', v)}
						/>
					</Row>
					<Row
						label="ReplayGain"
						description="Level out loudness between tracks or albums."
					>
						<select
							class={styles.select}
							value={settings.replayGain}
							onChange={(e) =>
								set(
									'replayGain',
									(e.target as HTMLSelectElement).value as ReplayGainMode,
								)
							}
						>
							<option value="off">Off</option>
							<option value="track">Track</option>
							<option value="album">Album</option>
						</select>
					</Row>
					<Row label="Gapless Playback">
						<Toggle checked={settings.gapless} onChange={(v) => set('gapless', v)} />
					</Row>
					<Row
						label="Resume Music After Video"
						description="When a movie is closed, continue the paused music."
					>
						<Toggle
							checked={settings.resumeAfterVideo}
							onChange={(v) => set('resumeAfterVideo', v)}
						/>
					</Row>

					<h3 class={styles.sectionTitle}>Offline</h3>
					<Row label="Allow Offline Downloads">
						<Toggle
							checked={settings.offline.allowDownloads}
							onChange={(v) =>
								set('offline', { ...settings.offline, allowDownloads: v })
							}
						/>
					</Row>
					<Row label="Download Quality">
						<QualitySelect
							value={settings.offline.downloadProfile}
							onChange={(v) =>
								set('offline', { ...settings.offline, downloadProfile: v })
							}
						/>
					</Row>
					<Row label="Offline Limit per Device (GB)">
						<NumberInput
							value={settings.offline.maxOfflineGbPerDevice}
							min={1}
							max={500}
							onChange={(v) =>
								set('offline', { ...settings.offline, maxOfflineGbPerDevice: v })
							}
						/>
					</Row>
					<Row label="Roles Allowed to Download">
						<div style={{ display: 'flex', gap: 'var(--space-md)' }}>
							{(['admin', 'contributor', 'viewer'] as const).map((role) => (
								<label
									key={role}
									style={{ display: 'flex', gap: 'var(--space-xs)' }}
								>
									<input
										type="checkbox"
										checked={settings.offline.roles.includes(role)}
										onChange={(e) => {
											const on = (e.target as HTMLInputElement).checked;
											const roles = on
												? [...settings.offline.roles, role]
												: settings.offline.roles.filter((r) => r !== role);
											set('offline', { ...settings.offline, roles });
										}}
									/>
									{role}
								</label>
							))}
						</div>
					</Row>

					<div class={styles.actions}>
						<Button variant="primary" loading={isSaving} onClick={handleSave}>
							Save Changes
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
