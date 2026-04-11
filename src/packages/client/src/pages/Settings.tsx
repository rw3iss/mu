import type { ThemeConfig } from '@mu/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { ColorPicker } from '@/components/common/ColorPicker';
import { FolderBrowser } from '@/components/common/FolderBrowser';
import type { MediaPathEntryData } from '@/components/library/MediaPathList';
import { MediaPathList } from '@/components/library/MediaPathList';
import { SubtitleAppearance } from '@/components/movie/SubtitleAppearance';
import { useUiSetting } from '@/hooks/useUiSetting';
import { ServerSettings } from '@/pages/ServerSettings';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import { sourcesService } from '@/services/sources.service';
import { themesApi } from '@/services/themes.service';
import { type ItemSpacing } from '@/state/appearance.state';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import type { Theme } from '@/state/theme.state';
import { setTheme, theme } from '@/state/theme.state';
import {
	applyActiveTheme,
	applyThemeConfig,
	editingThemeId,
	fetchThemes,
	selectedDarkId,
	selectedLightId,
	setSelectedDarkId,
	setSelectedLightId,
	themesList,
} from '@/state/themes.state';
import { AdminDashboard } from './AdminDashboard';
import { Plugins } from './Plugins';
import styles from './Settings.module.scss';

function OverlayTimeoutSetting() {
	const [val, setVal] = useUiSetting('overlay_hide_timeout', 2000);
	return (
		<div class={styles.settingRow}>
			<div class={styles.settingInfo}>
				<span class={styles.settingLabel}>Overlay Hide Timeout</span>
				<span class={styles.settingDescription}>
					Time before player controls fade out (min 100ms)
				</span>
			</div>
			<div class={styles.skipTimesRow}>
				<input
					type="number"
					class={styles.skipTimeInput}
					min={100}
					max={10000}
					step={100}
					value={val}
					onInput={(e) => {
						const n = parseInt((e.target as HTMLInputElement).value, 10);
						if (!Number.isNaN(n)) setVal(Math.max(100, Math.min(10000, n)));
					}}
				/>
				<span class={styles.settingDescription}>ms</span>
				<button
					class={styles.resetBtn}
					onClick={() => setVal(Math.max(100, (val || 0) - 100))}
				>
					-100
				</button>
				<button
					class={styles.resetBtn}
					onClick={() => setVal(Math.min(10000, (val || 0) + 100))}
				>
					+100
				</button>
				<button
					class={styles.resetBtn}
					onClick={() => setVal(2000)}
					title="Reset to default (2000ms)"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="1 4 1 10 7 10" />
						<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
					</svg>
				</button>
			</div>
		</div>
	);
}

interface ServerStats {
	system: {
		cpuCount: number;
		loadAvg: number[];
		memoryUsed: number;
		memoryTotal: number;
		memoryFree: number;
		appMemory: { main: number; children: number; total: number };
		diskTotal: number;
		diskFree: number;
		dataDirSize: number;
		uptime: number;
		platform: string;
	};
	services: {
		activeStreams: number;
		activeTranscodes: number;
		runningJobs: number;
		pendingJobs: number;
	};
}

function _formatBytes(bytes: number): string {
	const gb = bytes / (1024 * 1024 * 1024);
	if (gb >= 1000) {
		return `${(gb / 1024).toFixed(1)} TB`;
	}
	return `${gb.toFixed(1)} GB`;
}

function _formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const parts: string[] = [];
	if (d > 0) parts.push(`${d}d`);
	if (h > 0) parts.push(`${h}h`);
	parts.push(`${m}m`);
	return parts.join(' ');
}

function _meterColor(ratio: number): string {
	if (ratio < 0.6) return 'var(--color-accent, #4caf50)';
	if (ratio < 0.85) return '#ff9800';
	return '#f44336';
}

function CollapsibleSubtitleSettings() {
	const [open, setOpen] = useState(false);
	return (
		<div
			style={{
				borderTop: '1px solid var(--color-border)',
				paddingTop: 'var(--space-md)',
				marginTop: 'var(--space-md)',
			}}
		>
			<button
				onClick={() => setOpen(!open)}
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					width: '100%',
					padding: '0',
					background: 'none',
					border: 'none',
					cursor: 'pointer',
					color: 'var(--color-text-primary)',
				}}
			>
				<span
					style={{
						fontSize: 'var(--font-size-lg)',
						fontWeight: 'var(--font-weight-semibold)',
					}}
				>
					Subtitles
				</span>
				<span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
					{open ? '\u25B2' : '\u25BC'}
				</span>
			</button>
			{open && (
				<div style={{ paddingTop: 'var(--space-md)' }}>
					<SubtitleAppearance />
				</div>
			)}
		</div>
	);
}

interface SettingsProps {
	path?: string;
	tab?: string;
}

type SettingsTab =
	| 'general'
	| 'appearance'
	| 'playback'
	| 'library'
	| 'notifications'
	| 'plugins'
	| 'admin'
	| 'server'
	| 'about';

const VALID_TABS: SettingsTab[] = [
	'general',
	'appearance',
	'playback',
	'library',
	'notifications',
	'plugins',
	'admin',
	'server',
	'about',
];

function isValidTab(tab: string | undefined): tab is SettingsTab {
	return VALID_TABS.includes(tab as SettingsTab);
}

function formatNextScan(nextScanAt: string | null): string | null {
	if (!nextScanAt) return null;
	const diff = new Date(nextScanAt).getTime() - Date.now();
	if (diff <= 0) return 'any moment now';
	const minutes = Math.round(diff / 60000);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
	const hours = Math.round(minutes / 60);
	return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function Settings(props: SettingsProps) {
	const initialTab = isValidTab(props.tab) ? props.tab : 'general';
	const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
	const [isSaving, setIsSaving] = useState(false);
	const [_isLoadingSettings, setIsLoadingSettings] = useState(true);

	// Appearance settings
	const [showRecentlyPlayed, setShowRecentlyPlayed] = useUiSetting('show_recently_played', true);
	const [showBorderEditor, setShowBorderEditor] = useState(false);
	const [editConfig, setEditConfig] = useState<ThemeConfig | null>(null);
	const [editThemeName, setEditThemeName] = useState('');
	const importDarkRef = useRef<HTMLInputElement>(null);
	const importLightRef = useRef<HTMLInputElement>(null);

	// Fetch themes on mount
	useEffect(() => {
		fetchThemes();
	}, []);

	// Playback settings
	const [defaultQuality, setDefaultQuality] = useState('auto');
	const [preferredAudioLanguage, setPreferredAudioLanguage] = useState('eng');
	const [autoplay, setAutoplay] = useState(true);
	const [bufferSize, setBufferSizeSetting] = useUiSetting('buffer_size', 'normal');
	const [skipTimes, setSkipTimes] = useUiSetting<number[]>('skip_times', [5, 10, 20]);

	// Library settings
	const [scanInterval, setScanInterval] = useState('6');
	const [mediaPathEntries, setMediaPathEntries] = useState<MediaPathEntryData[]>([]);
	const [fetchExtendedMetadata, setFetchExtendedMetadata] = useState(true);
	const [persistTranscodes, setPersistTranscodes] = useState(true);
	const [cacheDir, setCacheDir] = useState('');
	const [isCacheBrowseOpen, setIsCacheBrowseOpen] = useState(false);
	const [autoScanEnabled, setAutoScanEnabled] = useState(true);
	const [minFileSizeMB, setMinFileSizeMB] = useState('50');
	const [nextScanAt, setNextScanAt] = useState<string | null>(null);

	// Encoding settings
	const [hwAccel, setHwAccel] = useState('none');
	const [encodingPreset, setEncodingPreset] = useState('veryfast');
	const [encodeQuality, setEncodeQuality] = useState('1080p');
	const [encodeHighestAvailable, setEncodeHighestAvailable] = useState(false);
	const [streamHighestAvailable, setStreamHighestAvailable] = useState(false);
	const [rateControl, setRateControl] = useState('cbr');
	const [crfValue, setCrfValue] = useState('23');
	const [maxConcurrentJobs, setMaxConcurrentJobs] = useState('2');
	const [segmentDuration, setSegmentDuration] = useState('4');
	const [useChunkedTranscoding, setUseChunkedTranscoding] = useState(false);
	const [debugTranscoding, setDebugTranscoding] = useState(false);
	const [reEncodeOnScan, setReEncodeOnScan] = useState(false);

	// Sharing settings
	const [sharingEnabled, setSharingEnabled] = useState(false);
	const [sharingPassword, setSharingPassword] = useState('');
	const [sharingServerName, setSharingServerName] = useState('My Library');
	const [showPasswordInput, setShowPasswordInput] = useState(false);
	const [sharingUrl, setSharingUrl] = useState('');

	// Remote servers
	const [remoteServers, setRemoteServers] = useState<
		Array<{
			id: string;
			url: string;
			password: string;
			name: string;
			enabled: boolean;
		}>
	>([]);
	const [showAddServer, setShowAddServer] = useState(false);
	const [newServerUrl, setNewServerUrl] = useState('');
	const [newServerPassword, setNewServerPassword] = useState('');
	const [newServerName, setNewServerName] = useState('');
	const [showNewServerConfig, setShowNewServerConfig] = useState(false);
	const [testingServer, setTestingServer] = useState<string | null>(null);
	const [editingServer, setEditingServer] = useState<string | null>(null);

	// Rating settings
	const [showExternalRatings, setShowExternalRatings] = useState(true);

	// Notification settings
	const [notifyScanResults, setNotifyScanResults] = useState(true);
	const [notifyPlaylist, setNotifyPlaylist] = useState(true);

	// Sync tab from URL prop
	useEffect(() => {
		if (isValidTab(props.tab) && props.tab !== activeTab) {
			setActiveTab(props.tab);
		}
	}, [props.tab]);

	const handleTabChange = useCallback((tab: SettingsTab) => {
		setActiveTab(tab);
		const url = tab === 'general' ? '/settings' : `/settings/${tab}`;
		route(url, true);
	}, []);

	useEffect(() => {
		async function loadSettings() {
			try {
				const data = await api.get<Record<string, unknown>>('/settings');

				const playback = data.playback as Record<string, unknown> | undefined;
				if (playback) {
					if (typeof playback.defaultQuality === 'string')
						setDefaultQuality(playback.defaultQuality);
					if (typeof playback.preferredAudioLanguage === 'string')
						setPreferredAudioLanguage(playback.preferredAudioLanguage);
					if (typeof playback.autoplay === 'boolean') setAutoplay(playback.autoplay);
					if (typeof playback.bufferSize === 'string') {
						setBufferSizeSetting(playback.bufferSize);
					}
					if (Array.isArray(playback.skipTimes) && playback.skipTimes.length === 3) {
						setSkipTimes(playback.skipTimes as number[]);
					}
				}

				const library = data.library as Record<string, unknown> | undefined;
				if (library) {
					if (library.scanIntervalHours != null)
						setScanInterval(String(library.scanIntervalHours));
					if (typeof library.fetchExtendedMetadata === 'boolean')
						setFetchExtendedMetadata(library.fetchExtendedMetadata);
					if (typeof library.persistTranscodes === 'boolean')
						setPersistTranscodes(library.persistTranscodes);
					if (typeof library.cacheDir === 'string') setCacheDir(library.cacheDir);
					if (typeof library.autoScanEnabled === 'boolean')
						setAutoScanEnabled(library.autoScanEnabled);
					if (library.minFileSizeMB != null)
						setMinFileSizeMB(String(library.minFileSizeMB));
				}

				const encoding = data.encoding as Record<string, unknown> | undefined;
				if (encoding) {
					if (typeof encoding.hwAccel === 'string') setHwAccel(encoding.hwAccel);
					if (typeof encoding.preset === 'string') setEncodingPreset(encoding.preset);
					if (typeof encoding.quality === 'string') setEncodeQuality(encoding.quality);
					if (typeof encoding.encodeHighestAvailable === 'boolean')
						setEncodeHighestAvailable(encoding.encodeHighestAvailable);
					if (typeof encoding.streamHighestAvailable === 'boolean')
						setStreamHighestAvailable(encoding.streamHighestAvailable);
					if (typeof encoding.rateControl === 'string')
						setRateControl(encoding.rateControl);
					if (encoding.crf != null) setCrfValue(String(encoding.crf));
					if (encoding.maxConcurrentJobs != null)
						setMaxConcurrentJobs(String(encoding.maxConcurrentJobs));
					if (encoding.segmentDuration != null)
						setSegmentDuration(String(encoding.segmentDuration));
					if (encoding.useChunkedTranscoding != null)
						setUseChunkedTranscoding(!!encoding.useChunkedTranscoding);
					if (encoding.debugTranscoding != null)
						setDebugTranscoding(!!encoding.debugTranscoding);
				}

				// Load sources from the API
				try {
					const sources = await sourcesService.getAll();
					if (sources.length > 0) {
						setMediaPathEntries(sources.map((s) => ({ path: s.path, source: s })));
					} else {
						setMediaPathEntries([{ path: '', source: null }]);
					}
				} catch {
					setMediaPathEntries([{ path: '', source: null }]);
				}

				// Load scan status
				try {
					const scanStatus = await sourcesService.getScanStatus();
					setNextScanAt(scanStatus.nextScanAt);
				} catch {
					// ignore
				}

				// Load sharing settings
				const sharing = data.sharing as Record<string, unknown> | undefined;
				if (sharing) {
					if (typeof sharing.enabled === 'boolean') setSharingEnabled(sharing.enabled);
					if (typeof sharing.password === 'string') setSharingPassword(sharing.password);
					if (typeof sharing.serverName === 'string')
						setSharingServerName(sharing.serverName);
					if (sharing.password) setShowPasswordInput(true);
				}

				// Load server URL for sharing
				try {
					const urlData = await api.get<{ url: string }>('/settings/server-url');
					if (urlData?.url) setSharingUrl(urlData.url);
				} catch {
					// ignore
				}

				// Load remote servers
				try {
					const servers = await api.get<any[]>('/remote/servers');
					if (Array.isArray(servers)) setRemoteServers(servers);
				} catch {
					// ignore
				}

				const rating = data.rating as Record<string, unknown> | undefined;
				if (rating) {
					if (typeof rating.showExternalRatings === 'boolean')
						setShowExternalRatings(rating.showExternalRatings);
				}
			} catch {
				// Settings may not exist yet — use defaults
			} finally {
				setIsLoadingSettings(false);
			}
		}
		loadSettings();

		const stored = localStorage.getItem('mu_notify_scan');
		if (stored !== null) setNotifyScanResults(stored !== 'false');
		const storedPlaylist = localStorage.getItem('mu_notify_playlist');
		if (storedPlaylist !== null) setNotifyPlaylist(storedPlaylist !== 'false');
	}, []);

	const handleSavePlayback = useCallback(async () => {
		setIsSaving(true);
		try {
			await api.put('/settings/playback', {
				value: { defaultQuality, preferredAudioLanguage, autoplay, bufferSize, skipTimes },
			});
			setBufferSizeSetting(bufferSize);
			setSkipTimes(skipTimes);

			// Save encoding settings (now in Playback tab)
			await api.put('/settings/encoding', {
				value: {
					hwAccel,
					preset: encodingPreset,
					quality: encodeQuality,
					encodeHighestAvailable,
					streamHighestAvailable,
					rateControl,
					crf: parseInt(crfValue, 10),
					maxConcurrentJobs: parseInt(maxConcurrentJobs, 10),
					segmentDuration: parseInt(segmentDuration, 10),
					useChunkedTranscoding,
					debugTranscoding,
				},
			});

			notifySuccess('Playback settings saved');
		} catch {
			notifyError('Failed to save settings');
		} finally {
			setIsSaving(false);
		}
	}, [
		defaultQuality,
		preferredAudioLanguage,
		autoplay,
		bufferSize,
		skipTimes,
		hwAccel,
		encodingPreset,
		encodeQuality,
		encodeHighestAvailable,
		streamHighestAvailable,
		rateControl,
		crfValue,
		maxConcurrentJobs,
		segmentDuration,
		useChunkedTranscoding,
		debugTranscoding,
	]);

	const handleSaveLibrary = useCallback(async () => {
		setIsSaving(true);
		try {
			// Sync media sources
			const validPaths = mediaPathEntries.map((e) => e.path.trim()).filter(Boolean);
			await sourcesService.sync(validPaths);

			// Reload sources to get full objects with scan status
			const sources = await sourcesService.getAll();
			if (sources.length > 0) {
				setMediaPathEntries(sources.map((s) => ({ path: s.path, source: s })));
			} else {
				setMediaPathEntries([{ path: '', source: null }]);
			}

			// Save library settings
			await api.put('/settings/library', {
				value: {
					scanIntervalHours: parseInt(scanInterval, 10),
					fetchExtendedMetadata,
					persistTranscodes,
					cacheDir: cacheDir || undefined,
					autoScanEnabled,
					minFileSizeMB: parseInt(minFileSizeMB, 10) || 0,
				},
			});

			// Save sharing settings
			await api.put('/settings/sharing', {
				value: {
					enabled: sharingEnabled,
					password: sharingPassword || null,
					serverName: sharingServerName,
				},
			});

			// Refresh the auto-scan schedule on the server
			const scanStatus = await sourcesService.refreshSchedule();
			setNextScanAt(scanStatus.nextScanAt);

			notifySuccess('Library settings saved');
		} catch {
			notifyError('Failed to save settings');
		} finally {
			setIsSaving(false);
		}
	}, [
		scanInterval,
		mediaPathEntries,
		fetchExtendedMetadata,
		persistTranscodes,
		cacheDir,
		autoScanEnabled,
		minFileSizeMB,
		sharingEnabled,
		sharingPassword,
		sharingServerName,
	]);

	const handleSaveRating = useCallback(async () => {
		setIsSaving(true);
		try {
			await api.put('/settings/rating', {
				value: { showExternalRatings },
			});
			notifySuccess('Rating settings saved');
		} catch {
			notifyError('Failed to save settings');
		} finally {
			setIsSaving(false);
		}
	}, [showExternalRatings]);

	// Scan state
	const [isScanning, setIsScanning] = useState(false);
	const [scanResult, setScanResult] = useState<{
		filesFound: number;
		filesAdded: number;
		filesUpdated: number;
		filesRemoved: number;
	} | null>(null);

	const handleScanNow = useCallback(async () => {
		setIsScanning(true);
		setScanResult(null);
		try {
			const result = await api.post<{
				filesFound: number;
				filesAdded: number;
				filesUpdated: number;
				filesRemoved: number;
			}>('/sources/scan', reEncodeOnScan ? { reEncode: true } : undefined);
			setScanResult(result);
			if (result.filesAdded > 0) {
				notifySuccess(
					`Scan complete: ${result.filesAdded} new movie${result.filesAdded === 1 ? '' : 's'} added`,
				);
			} else {
				notifySuccess('Scan complete — no new movies found');
			}
		} catch {
			notifyError('Failed to scan library');
		} finally {
			setIsScanning(false);
		}
	}, []);

	const nextScanText = autoScanEnabled ? formatNextScan(nextScanAt) : null;

	// Server stats polling
	const [_serverStats, setServerStats] = useState<ServerStats | null>(null);
	const statsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (activeTab !== 'about') {
			// Clean up when leaving About tab
			if (statsTimer.current) {
				clearInterval(statsTimer.current);
				statsTimer.current = null;
			}
			return;
		}

		const fetchStats = () => {
			api.get<ServerStats>('/health/stats')
				.then(setServerStats)
				.catch(() => {});
		};

		fetchStats();
		statsTimer.current = setInterval(fetchStats, 5000);

		return () => {
			if (statsTimer.current) {
				clearInterval(statsTimer.current);
				statsTimer.current = null;
			}
		};
	}, [activeTab]);

	const user = currentUser.value;
	const isAdmin = user?.role === 'admin';

	const tabs: { id: SettingsTab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'playback', label: 'Playback' },
		{ id: 'library', label: 'Library' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'notifications', label: 'Notifications' },
		...(isAdmin
			? [
					{ id: 'plugins' as SettingsTab, label: 'Plugins' },
					{ id: 'admin' as SettingsTab, label: 'Admin' },
					{ id: 'server' as SettingsTab, label: 'Server' },
				]
			: []),
		{ id: 'about', label: 'About' },
	];

	return (
		<div class={styles.settings}>
			<h1 class={styles.title}>Settings</h1>

			<div class={styles.layout}>
				{/* Tabs */}
				<nav class={styles.tabs}>
					{tabs.map((tab) => (
						<button
							key={tab.id}
							class={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
							onClick={() => handleTabChange(tab.id)}
						>
							{tab.label}
						</button>
					))}
				</nav>

				{/* Content */}
				<div class={styles.content}>
					{/* General Tab */}
					{activeTab === 'general' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>General</h2>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Language</span>
									<span class={styles.settingDescription}>
										Display language for the interface
									</span>
								</div>
								<select class={styles.select}>
									<option value="en">English</option>
								</select>
							</div>

							<h3 class={styles.sectionTitle}>Rating</h3>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>External Sources</span>
									<span class={styles.settingDescription}>
										Show ratings from external services
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={showExternalRatings}
										onChange={(e) =>
											setShowExternalRatings(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							<h3 class={styles.sectionTitle}>Display</h3>

							{/* Show Recently Played */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Show Recently Played</span>
									<span class={styles.settingDescription}>
										Display recently played movies in the sidebar
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={showRecentlyPlayed}
										onChange={(e) =>
											setShowRecentlyPlayed(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{/* Overlay Hide Timeout */}
							<OverlayTimeoutSetting />

							<div class={styles.actions}>
								<Button
									variant="primary"
									loading={isSaving}
									onClick={handleSaveRating}
								>
									Save Changes
								</Button>
							</div>
						</div>
					)}

					{/* Appearance Tab */}
					{activeTab === 'appearance' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Appearance</h2>

							{/* Theme Mode */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Theme</span>
									<span class={styles.settingDescription}>
										Choose your preferred color scheme
									</span>
								</div>
								<div class={styles.themeSelect}>
									{(['dark', 'light', 'auto'] as Theme[]).map((t) => (
										<button
											key={t}
											class={`${styles.themeOption} ${theme.value === t ? styles.active : ''}`}
											onClick={() => setTheme(t)}
										>
											{t.charAt(0).toUpperCase() + t.slice(1)}
										</button>
									))}
								</div>
							</div>

							{/* Dark Theme Selector */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Dark Theme</span>
									<span class={styles.settingDescription}>
										Theme used in dark mode
									</span>
								</div>
								<div class={styles.settingControl}>
									<select
										class={styles.select}
										value={selectedDarkId.value}
										onChange={(e) =>
											setSelectedDarkId((e.target as HTMLSelectElement).value)
										}
									>
										{themesList.value
											.filter((t) => t.mode === 'dark')
											.map((t) => (
												<option key={t.id} value={t.id}>
													{t.name}
												</option>
											))}
									</select>
									<button
										class={styles.themeActionBtn}
										onClick={() => {
											const t = themesList.value.find(
												(t) => t.id === selectedDarkId.value,
											);
											if (t) {
												editingThemeId.value = t.id;
												setEditConfig({ ...t.config });
												setEditThemeName(t.name);
												setShowBorderEditor(false);
											}
										}}
										title="Edit theme"
									>
										Edit
									</button>
									<button
										class={styles.themeActionBtn}
										onClick={() => importDarkRef.current?.click()}
										title="Import theme"
									>
										Import
									</button>
									<input
										ref={importDarkRef}
										type="file"
										accept=".json"
										style={{ display: 'none' }}
										onChange={async (e) => {
											const file = (e.target as HTMLInputElement).files?.[0];
											if (!file) return;
											try {
												const text = await file.text();
												const parsed = JSON.parse(text);
												const imported =
													await themesApi.importTheme(parsed);
												await fetchThemes();
												if (imported?.id) setSelectedDarkId(imported.id);
												notifySuccess('Theme imported');
											} catch {
												notifyError('Failed to import theme');
											}
											(e.target as HTMLInputElement).value = '';
										}}
									/>
								</div>
							</div>

							{/* Light Theme Selector */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Light Theme</span>
									<span class={styles.settingDescription}>
										Theme used in light mode
									</span>
								</div>
								<div class={styles.settingControl}>
									<select
										class={styles.select}
										value={selectedLightId.value}
										onChange={(e) =>
											setSelectedLightId(
												(e.target as HTMLSelectElement).value,
											)
										}
									>
										{themesList.value
											.filter((t) => t.mode === 'light')
											.map((t) => (
												<option key={t.id} value={t.id}>
													{t.name}
												</option>
											))}
									</select>
									<button
										class={styles.themeActionBtn}
										onClick={() => {
											const t = themesList.value.find(
												(t) => t.id === selectedLightId.value,
											);
											if (t) {
												editingThemeId.value = t.id;
												setEditConfig({ ...t.config });
												setEditThemeName(t.name);
												setShowBorderEditor(false);
											}
										}}
										title="Edit theme"
									>
										Edit
									</button>
									<button
										class={styles.themeActionBtn}
										onClick={() => importLightRef.current?.click()}
										title="Import theme"
									>
										Import
									</button>
									<input
										ref={importLightRef}
										type="file"
										accept=".json"
										style={{ display: 'none' }}
										onChange={async (e) => {
											const file = (e.target as HTMLInputElement).files?.[0];
											if (!file) return;
											try {
												const text = await file.text();
												const parsed = JSON.parse(text);
												const imported =
													await themesApi.importTheme(parsed);
												await fetchThemes();
												if (imported?.id) setSelectedLightId(imported.id);
												notifySuccess('Theme imported');
											} catch {
												notifyError('Failed to import theme');
											}
											(e.target as HTMLInputElement).value = '';
										}}
									/>
								</div>
							</div>

							{/* Theme Editor */}
							{editingThemeId.value &&
								editConfig &&
								(() => {
									const editingTheme = themesList.value.find(
										(t) => t.id === editingThemeId.value,
									);
									if (!editingTheme) return null;

									const updateEditConfig = (patch: Partial<ThemeConfig>) => {
										const next = { ...editConfig, ...patch };
										setEditConfig(next);
										applyThemeConfig(next);
									};

									return (
										<div
											style={{
												borderTop: '1px solid var(--color-border)',
												paddingTop: 'var(--space-md)',
												marginTop: 'var(--space-md)',
											}}
										>
											<h3 class={styles.sectionTitle}>
												Editing: {editThemeName}
											</h3>

											{/* Theme Name */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Theme Name
													</span>
												</div>
												<input
													type="text"
													class={styles.skipTimeInput}
													style={{ width: '200px' }}
													value={editThemeName}
													onInput={(e) =>
														setEditThemeName(
															(e.target as HTMLInputElement).value,
														)
													}
												/>
											</div>

											{/* Accent Color */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Accent Color
													</span>
													<span class={styles.settingDescription}>
														Customize the primary accent color
													</span>
												</div>
												<div class={styles.settingControl}>
													<div class={styles.accentColorColumn}>
														<div class={styles.accentColorPicker}>
															{[
																{ label: 'Cyan', value: '#06b6d4' },
																{ label: 'Blue', value: '#3b82f6' },
																{
																	label: 'Purple',
																	value: '#8b5cf6',
																},
																{ label: 'Pink', value: '#ec4899' },
																{
																	label: 'Amber',
																	value: '#f59e0b',
																},
																{
																	label: 'Green',
																	value: '#22c55e',
																},
																{ label: 'Red', value: '#ef4444' },
															].map((preset) => (
																<button
																	key={preset.label}
																	class={`${styles.colorSwatch} ${editConfig.accentColor === preset.value ? styles.activeSwatch : ''}`}
																	style={{
																		backgroundColor:
																			preset.value,
																	}}
																	title={preset.label}
																	onClick={() =>
																		updateEditConfig({
																			accentColor:
																				preset.value,
																		})
																	}
																/>
															))}
														</div>
														<ColorPicker
															value={
																editConfig.accentColor || '#06b6d4'
															}
															onChange={(v) =>
																updateEditConfig({ accentColor: v })
															}
														/>
													</div>
												</div>
											</div>

											{/* Page Background */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Page Background
													</span>
													<span class={styles.settingDescription}>
														Main app background color
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={editConfig.pageBg || '#050709'}
														onChange={(v) =>
															updateEditConfig({ pageBg: v })
														}
													/>
												</div>
											</div>

											{/* Panel Background */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Panel Background
													</span>
													<span class={styles.settingDescription}>
														Sidebar, header, and card background color
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={editConfig.panelBg || '#090b12'}
														onChange={(v) =>
															updateEditConfig({ panelBg: v })
														}
													/>
												</div>
											</div>

											{/* Item Spacing */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Item Spacing
													</span>
													<span class={styles.settingDescription}>
														Gap between cards and items
													</span>
												</div>
												<div class={styles.settingControl}>
													<select
														class={styles.select}
														value={editConfig.itemSpacing}
														onChange={(e) =>
															updateEditConfig({
																itemSpacing: (
																	e.target as HTMLSelectElement
																).value as ItemSpacing,
															})
														}
													>
														<option value="none">None</option>
														<option value="minimal">Minimal</option>
														<option value="compact">Compact</option>
														<option value="normal">Normal</option>
														<option value="comfortable">
															Comfortable
														</option>
														<option value="spaced">Spaced</option>
													</select>
												</div>
											</div>

											{/* Item Radius */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Item Radius
													</span>
													<span class={styles.settingDescription}>
														Border radius on cards (0-40px)
													</span>
												</div>
												<div class={styles.settingControl}>
													<div class={styles.rangeWithValue}>
														<input
															type="range"
															class={styles.rangeInput}
															min="0"
															max="40"
															step="1"
															value={editConfig.itemRadius}
															onInput={(e) =>
																updateEditConfig({
																	itemRadius: parseInt(
																		(
																			e.target as HTMLInputElement
																		).value,
																		10,
																	),
																})
															}
														/>
														<span class={styles.rangeValue}>
															{editConfig.itemRadius}px
														</span>
													</div>
												</div>
											</div>

											{/* Card Border */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Card Border
													</span>
													<span class={styles.settingDescription}>
														Customize card border style
													</span>
												</div>
												<div class={styles.settingControl}>
													<button
														class={styles.borderPreview}
														onClick={() =>
															setShowBorderEditor(!showBorderEditor)
														}
														title="Edit card border"
													>
														<span
															class={styles.borderPreviewSample}
															style={{
																border: `${editConfig.cardBorder.width}px solid ${editConfig.cardBorder.color}`,
																opacity:
																	editConfig.cardBorder.opacity,
															}}
														/>
														<span class={styles.borderPreviewLabel}>
															{editConfig.cardBorder.width}px
														</span>
													</button>
												</div>
											</div>
											{showBorderEditor && (
												<div class={styles.borderEditor}>
													<div class={styles.borderEditorRow}>
														<span class={styles.borderEditorLabel}>
															Width
														</span>
														<input
															type="range"
															class={styles.rangeInput}
															min="0"
															max="5"
															step="1"
															value={editConfig.cardBorder.width}
															onInput={(e) =>
																updateEditConfig({
																	cardBorder: {
																		...editConfig.cardBorder,
																		width: parseInt(
																			(
																				e.target as HTMLInputElement
																			).value,
																			10,
																		),
																	},
																})
															}
														/>
														<span class={styles.rangeValue}>
															{editConfig.cardBorder.width}px
														</span>
													</div>
													<div class={styles.borderEditorRow}>
														<span class={styles.borderEditorLabel}>
															Color
														</span>
														<ColorPicker
															value={editConfig.cardBorder.color}
															onChange={(hex) =>
																updateEditConfig({
																	cardBorder: {
																		...editConfig.cardBorder,
																		color: hex,
																	},
																})
															}
															size={24}
														/>
													</div>
													<div class={styles.borderEditorRow}>
														<span class={styles.borderEditorLabel}>
															Opacity
														</span>
														<input
															type="range"
															class={styles.rangeInput}
															min="0"
															max="1"
															step="0.01"
															value={editConfig.cardBorder.opacity}
															onInput={(e) =>
																updateEditConfig({
																	cardBorder: {
																		...editConfig.cardBorder,
																		opacity: parseFloat(
																			(
																				e.target as HTMLInputElement
																			).value,
																		),
																	},
																})
															}
														/>
														<span class={styles.rangeValue}>
															{Math.round(
																editConfig.cardBorder.opacity * 100,
															)}
															%
														</span>
													</div>
												</div>
											)}

											{/* Disable Hover Effects */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Disable Hover Effects
													</span>
													<span class={styles.settingDescription}>
														Stop cards from animating on hover
													</span>
												</div>
												<div class={styles.settingControl}>
													<label class={styles.toggle}>
														<input
															type="checkbox"
															checked={editConfig.disableHover}
															onChange={(e) =>
																updateEditConfig({
																	disableHover: (
																		e.target as HTMLInputElement
																	).checked,
																})
															}
														/>
														<span class={styles.toggleTrack} />
													</label>
												</div>
											</div>

											{/* Font Scale */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Font Scale
													</span>
													<span class={styles.settingDescription}>
														Adjust the text size across the app
													</span>
												</div>
												<div class={styles.settingControl}>
													<div class={styles.rangeWithValue}>
														<input
															type="range"
															class={styles.rangeInput}
															min="0.8"
															max="1.2"
															step="0.05"
															value={editConfig.textScale}
															onInput={(e) =>
																updateEditConfig({
																	textScale: parseFloat(
																		(
																			e.target as HTMLInputElement
																		).value,
																	),
																})
															}
														/>
														<span class={styles.rangeValue}>
															{editConfig.textScale}x
														</span>
													</div>
												</div>
											</div>

											{/* Editor Actions */}
											<div
												class={styles.actions}
												style={{ gap: '8px', flexWrap: 'wrap' }}
											>
												<Button
													variant="primary"
													onClick={async () => {
														try {
															await themesApi.update(
																editingThemeId.value,
																{
																	name: editThemeName,
																	config: editConfig,
																},
															);
															await fetchThemes();
															notifySuccess('Theme saved');
														} catch {
															notifyError('Failed to save theme');
														}
													}}
												>
													Save
												</Button>
												<Button
													variant="secondary"
													onClick={async () => {
														try {
															const created = await themesApi.create({
																name: `Copy of ${editThemeName}`,
																mode: editingTheme.mode,
																config: editConfig,
															});
															await fetchThemes();
															if (editingTheme.mode === 'dark') {
																setSelectedDarkId(created.id);
															} else {
																setSelectedLightId(created.id);
															}
															editingThemeId.value = created.id;
															setEditThemeName(created.name);
															notifySuccess('Theme copied');
														} catch {
															notifyError('Failed to copy theme');
														}
													}}
												>
													Copy to New
												</Button>
												<Button
													variant="secondary"
													onClick={() =>
														window.open(
															themesApi.exportUrl(
																editingThemeId.value,
															),
														)
													}
												>
													Export
												</Button>
												<Button
													variant="secondary"
													onClick={() => {
														editingThemeId.value = '';
														setEditConfig(null);
														setShowBorderEditor(false);
														applyActiveTheme();
													}}
												>
													Close
												</Button>
											</div>
										</div>
									);
								})()}

							{/* Subtitles Appearance (collapsible) */}
							<CollapsibleSubtitleSettings />
						</div>
					)}

					{/* Playback Tab */}
					{activeTab === 'playback' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Playback</h2>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Default Quality</span>
									<span class={styles.settingDescription}>
										Preferred streaming quality
									</span>
								</div>
								<select
									class={styles.select}
									value={defaultQuality}
									onChange={(e) =>
										setDefaultQuality((e.target as HTMLSelectElement).value)
									}
								>
									<option value="auto">Auto</option>
									<option value="1080p">1080p</option>
									<option value="720p">720p</option>
									<option value="480p">480p</option>
									<option value="original">Original</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Preferred Audio Language
									</span>
									<span class={styles.settingDescription}>
										Default audio track language for transcoded streams
									</span>
								</div>
								<select
									class={styles.select}
									value={preferredAudioLanguage}
									onChange={(e) =>
										setPreferredAudioLanguage(
											(e.target as HTMLSelectElement).value,
										)
									}
								>
									<option value="eng">English</option>
									<option value="spa">Spanish</option>
									<option value="fra">French</option>
									<option value="deu">German</option>
									<option value="ita">Italian</option>
									<option value="por">Portuguese</option>
									<option value="rus">Russian</option>
									<option value="jpn">Japanese</option>
									<option value="kor">Korean</option>
									<option value="zho">Chinese</option>
									<option value="hin">Hindi</option>
									<option value="ara">Arabic</option>
									<option value="tha">Thai</option>
									<option value="vie">Vietnamese</option>
									<option value="pol">Polish</option>
									<option value="nld">Dutch</option>
									<option value="swe">Swedish</option>
									<option value="nor">Norwegian</option>
									<option value="dan">Danish</option>
									<option value="fin">Finnish</option>
									<option value="tur">Turkish</option>
									<option value="und">Undetermined</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Autoplay</span>
									<span class={styles.settingDescription}>
										Automatically start playing when opening a movie
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={autoplay}
										onChange={(e) =>
											setAutoplay((e.target as HTMLInputElement).checked)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Buffer Size</span>
									<span class={styles.settingDescription}>
										Amount of video to pre-load. Larger buffers improve
										stability on slow connections.
									</span>
								</div>
								<select
									class={styles.select}
									value={bufferSize}
									onChange={(e) =>
										setBufferSizeSetting((e.target as HTMLSelectElement).value)
									}
								>
									<option value="small">Small (10s)</option>
									<option value="normal">Normal (30s)</option>
									<option value="large">Large (60s)</option>
									<option value="max">Maximum (120s)</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Skip Times</span>
									<span class={styles.settingDescription}>
										Custom back/forward skip durations (1-300 seconds)
									</span>
								</div>
								<div class={styles.skipTimesRow}>
									{skipTimes.map((val, i) => (
										<input
											key={i}
											type="number"
											class={styles.skipTimeInput}
											min={1}
											max={300}
											value={val}
											onInput={(e) => {
												const raw = parseInt(
													(e.target as HTMLInputElement).value,
													10,
												);
												const clamped = Number.isNaN(raw)
													? skipTimes[i]
													: Math.max(1, Math.min(300, raw));
												const next = [...skipTimes];
												next[i] = clamped;
												setSkipTimes(next);
											}}
										/>
									))}
									<button
										class={styles.resetBtn}
										onClick={() => setSkipTimes([5, 10, 20])}
										aria-label="Reset skip times"
										title="Reset to defaults"
									>
										Reset
									</button>
								</div>
							</div>

							<h3 class={styles.encodingSectionTitle}>Encoding</h3>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Hardware Acceleration</span>
									<span class={styles.settingDescription}>
										Use GPU hardware for faster encoding when available
									</span>
								</div>
								<select
									class={styles.select}
									value={hwAccel}
									onChange={(e) =>
										setHwAccel((e.target as HTMLSelectElement).value)
									}
								>
									<option value="none">Software</option>
									<option value="nvenc">NVIDIA GPU (NVENC)</option>
									<option value="vaapi">Intel/AMD Linux (VAAPI)</option>
									<option value="qsv">Intel Quick Sync (QSV)</option>
									<option value="videotoolbox">macOS (VideoToolbox)</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Encoding Preset</span>
									<span class={styles.settingDescription}>
										Slower presets produce better quality but take longer
									</span>
								</div>
								<select
									class={styles.select}
									value={encodingPreset}
									onChange={(e) =>
										setEncodingPreset((e.target as HTMLSelectElement).value)
									}
								>
									<option value="ultrafast">Ultra Fast</option>
									<option value="superfast">Super Fast</option>
									<option value="veryfast">Very Fast</option>
									<option value="faster">Faster</option>
									<option value="fast">Fast</option>
									<option value="medium">Medium</option>
									<option value="slow">Slow</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Default Transcode Quality
									</span>
									<span class={styles.settingDescription}>
										Resolution used for background transcoding
									</span>
								</div>
								<select
									class={styles.select}
									value={encodeQuality}
									onChange={(e) =>
										setEncodeQuality((e.target as HTMLSelectElement).value)
									}
								>
									<option value="480p">480p</option>
									<option value="720p">720p</option>
									<option value="1080p">1080p</option>
									<option value="4k">4K</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Encode at Highest Quality
									</span>
									<span class={styles.settingDescription}>
										Also transcode at source resolution when it exceeds the
										default quality
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={encodeHighestAvailable}
										onChange={(e) =>
											setEncodeHighestAvailable(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{/* Stream Highest Available */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Stream Highest Available
									</span>
									<span class={styles.settingDescription}>
										Always stream the highest quality cached version, even if it
										exceeds the default encoding quality
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={streamHighestAvailable}
										onChange={(e) =>
											setStreamHighestAvailable(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Rate Control</span>
									<span class={styles.settingDescription}>
										CRF adapts bitrate to scene complexity for better quality
									</span>
								</div>
								<select
									class={styles.select}
									value={rateControl}
									onChange={(e) =>
										setRateControl((e.target as HTMLSelectElement).value)
									}
								>
									<option value="cbr">Constant Bitrate (CBR)</option>
									<option value="crf">Constant Quality (CRF)</option>
								</select>
							</div>

							{rateControl === 'crf' && (
								<div class={styles.settingRow}>
									<div class={styles.settingInfo}>
										<span class={styles.settingLabel}>CRF Value</span>
										<span class={styles.settingDescription}>
											Lower values produce higher quality but larger files
										</span>
									</div>
									<select
										class={styles.select}
										value={crfValue}
										onChange={(e) =>
											setCrfValue((e.target as HTMLSelectElement).value)
										}
									>
										<option value="18">18 — Near Lossless</option>
										<option value="20">20 — High Quality</option>
										<option value="23">23 — Balanced</option>
										<option value="26">26 — Smaller Files</option>
										<option value="28">28 — Low Quality</option>
									</select>
								</div>
							)}

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Max Concurrent Jobs</span>
									<span class={styles.settingDescription}>
										Background encoding jobs that can run simultaneously
									</span>
								</div>
								<select
									class={styles.select}
									value={maxConcurrentJobs}
									onChange={(e) =>
										setMaxConcurrentJobs((e.target as HTMLSelectElement).value)
									}
								>
									<option value="1">1</option>
									<option value="2">2</option>
									<option value="3">3</option>
									<option value="4">4</option>
									<option value="6">6</option>
									<option value="8">8</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>HLS Segment Duration</span>
									<span class={styles.settingDescription}>
										Shorter segments reduce initial load time but increase
										overhead
									</span>
								</div>
								<select
									class={styles.select}
									value={segmentDuration}
									onChange={(e) =>
										setSegmentDuration((e.target as HTMLSelectElement).value)
									}
								>
									<option value="2">2s (Fast start)</option>
									<option value="4">4s (Balanced)</option>
									<option value="6">6s (Efficient)</option>
									<option value="10">10s (Maximum efficiency)</option>
								</select>
							</div>

							{/* Chunked Transcoding */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Chunked Transcoding</span>
									<span class={styles.settingDescription}>
										Transcode movies in independent chunks for seek support and
										resumability. When enabled, you can seek to any point in a
										transcoding movie and transcoding resumes after server
										restarts.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={useChunkedTranscoding}
										onChange={(e) =>
											setUseChunkedTranscoding(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{/* Debug Transcoding */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Debug Transcoding</span>
									<span class={styles.settingDescription}>
										Log detailed transcoding diagnostics (FFmpeg commands,
										timing, segment production, errors) to a dedicated debug
										log. View via Settings or API.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={debugTranscoding}
										onChange={(e) =>
											setDebugTranscoding(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							<div class={styles.actions}>
								<Button
									variant="primary"
									loading={isSaving}
									onClick={handleSavePlayback}
								>
									Save Changes
								</Button>
							</div>
						</div>
					)}

					{/* Library Tab */}
					{activeTab === 'library' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Library</h2>

							<div class={styles.settingGroup}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Media Paths</span>
									<span class={styles.settingDescription}>
										Directories containing your movie files
									</span>
								</div>
								<MediaPathList
									entries={mediaPathEntries}
									onChange={setMediaPathEntries}
									showBrowse={true}
								/>
							</div>

							<div class={styles.scanRow}>
								<Button
									variant="secondary"
									loading={isScanning}
									onClick={handleScanNow}
								>
									{isScanning ? 'Scanning...' : 'Scan Now'}
								</Button>
								<label
									class={styles.toggle}
									title="Re-encode existing movies whose cached transcode doesn't match the encoding settings above"
								>
									<input
										type="checkbox"
										checked={reEncodeOnScan}
										onChange={(e) =>
											setReEncodeOnScan(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
								<span class={styles.settingDescription}>Re-encode on scan</span>
								{scanResult && (
									<div class={styles.scanResult}>
										<span class={styles.scanStat}>
											{scanResult.filesFound} file
											{scanResult.filesFound === 1 ? '' : 's'} found
										</span>
										{scanResult.filesAdded > 0 && (
											<span class={styles.scanStatHighlight}>
												{scanResult.filesAdded} new
											</span>
										)}
										{scanResult.filesUpdated > 0 && (
											<span class={styles.scanStat}>
												{scanResult.filesUpdated} updated
											</span>
										)}
										{scanResult.filesRemoved > 0 && (
											<span class={styles.scanStat}>
												{scanResult.filesRemoved} removed
											</span>
										)}
										{scanResult.filesAdded === 0 &&
											scanResult.filesUpdated === 0 &&
											scanResult.filesRemoved === 0 && (
												<span class={styles.scanStat}>Up to date</span>
											)}
									</div>
								)}
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Automatic Scanning</span>
									<span class={styles.settingDescription}>
										Periodically scan media directories for new files
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={autoScanEnabled}
										onChange={(e) =>
											setAutoScanEnabled(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Scan Interval</span>
									<span class={styles.settingDescription}>
										How often to check for new files
										{nextScanText && (
											<span class={styles.nextScan}>
												{' '}
												&middot; Next scan in {nextScanText}
											</span>
										)}
									</span>
								</div>
								<select
									class={styles.select}
									value={scanInterval}
									disabled={!autoScanEnabled}
									onChange={(e) =>
										setScanInterval((e.target as HTMLSelectElement).value)
									}
								>
									<option value="1">Every hour</option>
									<option value="3">Every 3 hours</option>
									<option value="6">Every 6 hours</option>
									<option value="12">Every 12 hours</option>
									<option value="24">Daily</option>
								</select>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Download Extended Metadata
									</span>
									<span class={styles.settingDescription}>
										Fetch ratings and reviews from third-party sources (IMDB,
										Rotten Tomatoes) when a new movie is scanned
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={fetchExtendedMetadata}
										onChange={(e) =>
											setFetchExtendedMetadata(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Minimum File Size</span>
									<span class={styles.settingDescription}>
										Skip files smaller than this during scanning (filters out
										junk/promo files). Set to 0 to disable.
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
									<input
										type="number"
										class={styles.input}
										style={{ width: '80px', textAlign: 'right' }}
										value={minFileSizeMB}
										min="0"
										max="1000"
										onChange={(e) =>
											setMinFileSizeMB((e.target as HTMLInputElement).value)
										}
									/>
									<span
										style={{
											fontSize: '13px',
											color: 'var(--color-text-muted)',
										}}
									>
										MB
									</span>
								</div>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Cache Transcoded Files</span>
									<span class={styles.settingDescription}>
										Keep transcoded files on disk so they don't need to be
										re-transcoded on subsequent plays
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={persistTranscodes}
										onChange={(e) =>
											setPersistTranscodes(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{persistTranscodes && (
								<div class={styles.settingRow}>
									<div class={styles.settingInfo}>
										<span class={styles.settingLabel}>Cache Directory</span>
										<span class={styles.settingDescription}>
											Where transcoded files are stored. Leave empty for
											default (data/cache/streams).
										</span>
									</div>
									<div
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: '6px',
											flex: 1,
											maxWidth: '400px',
										}}
									>
										<input
											type="text"
											class={styles.input}
											style={{ flex: 1 }}
											value={cacheDir}
											placeholder="data/cache/streams (default)"
											onInput={(e) =>
												setCacheDir((e.target as HTMLInputElement).value)
											}
										/>
										<Button
											variant="secondary"
											size="sm"
											onClick={() => setIsCacheBrowseOpen(true)}
										>
											Browse
										</Button>
									</div>
									<FolderBrowser
										isOpen={isCacheBrowseOpen}
										onClose={() => setIsCacheBrowseOpen(false)}
										onSelect={(path) => {
											setCacheDir(path);
											setIsCacheBrowseOpen(false);
										}}
										initialPath={cacheDir || undefined}
									/>
								</div>
							)}

							<h3 class={styles.encodingSectionTitle}>Library Sharing</h3>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Share My Library</span>
									<span class={styles.settingDescription}>
										Allow other servers to connect and browse your movie library
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={sharingEnabled}
										onChange={(e) =>
											setSharingEnabled(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{sharingEnabled && (
								<>
									<div class={styles.settingRow}>
										<div class={styles.settingInfo}>
											<span class={styles.settingLabel}>Server Name</span>
											<span class={styles.settingDescription}>
												Name shown to other servers when they connect
											</span>
										</div>
										<input
											type="text"
											class={styles.textInput}
											value={sharingServerName}
											onInput={(e) =>
												setSharingServerName(
													(e.target as HTMLInputElement).value,
												)
											}
											placeholder="My Library"
										/>
									</div>

									<div class={styles.settingGroup}>
										<div class={styles.settingInfo}>
											<span class={styles.settingLabel}>
												Password Protection
											</span>
											<span class={styles.settingDescription}>
												Require a password to access your shared library
											</span>
										</div>
										{!showPasswordInput ? (
											<button
												class={styles.linkButton}
												onClick={() => setShowPasswordInput(true)}
											>
												Set a password
											</button>
										) : (
											<div class={styles.passwordRow}>
												<input
													type="password"
													class={styles.textInput}
													value={sharingPassword}
													onInput={(e) =>
														setSharingPassword(
															(e.target as HTMLInputElement).value,
														)
													}
													placeholder="Enter password"
												/>
												<button
													class={styles.linkButton}
													onClick={() => {
														setSharingPassword('');
														setShowPasswordInput(false);
													}}
												>
													Remove
												</button>
											</div>
										)}
									</div>

									{sharingUrl && (
										<div class={styles.settingRow}>
											<div class={styles.settingInfo}>
												<span class={styles.settingLabel}>Server URL</span>
												<span class={styles.settingDescription}>
													Share this URL with others to connect to your
													library
												</span>
											</div>
											<div class={styles.sharingUrlRow}>
												<input
													type="text"
													class={`${styles.textInput} ${styles.sharingUrlInput}`}
													value={sharingUrl}
													readOnly
												/>
												<button
													class={styles.iconBtn}
													title="Copy to clipboard"
													onClick={() => {
														navigator.clipboard.writeText(sharingUrl);
														notifySuccess('URL copied to clipboard');
													}}
												>
													<svg
														width="14"
														height="14"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
													>
														<rect
															x="9"
															y="9"
															width="13"
															height="13"
															rx="2"
														/>
														<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
													</svg>
												</button>
											</div>
										</div>
									)}
								</>
							)}

							<h3 class={styles.encodingSectionTitle}>Connected Servers</h3>

							<div class={styles.settingGroup}>
								<span class={styles.settingDescription}>
									Add other servers to merge their libraries into yours
								</span>

								{remoteServers.map((server) => (
									<div key={server.id} class={styles.serverEntry}>
										<div class={styles.serverInfo}>
											<span class={styles.serverName}>{server.name}</span>
											<span class={styles.serverUrl}>{server.url}</span>
										</div>
										<div class={styles.serverActions}>
											<label
												class={styles.toggle}
												title={server.enabled ? 'Enabled' : 'Disabled'}
											>
												<input
													type="checkbox"
													checked={server.enabled}
													onChange={async () => {
														try {
															await api.put(
																`/remote/servers/${server.id}`,
																{ enabled: !server.enabled },
															);
															setRemoteServers((prev) =>
																prev.map((s) =>
																	s.id === server.id
																		? {
																				...s,
																				enabled: !s.enabled,
																			}
																		: s,
																),
															);
														} catch {
															notifyError('Failed to update server');
														}
													}}
												/>
												<span class={styles.toggleTrack} />
											</label>
											<button
												class={styles.iconBtn}
												title="Edit"
												onClick={() =>
													setEditingServer(
														editingServer === server.id
															? null
															: server.id,
													)
												}
											>
												{'\u2699'}
											</button>
											<button
												class={styles.iconBtn}
												title="Test connection"
												disabled={testingServer === server.id}
												onClick={async () => {
													setTestingServer(server.id);
													try {
														const result = await api.post<{
															success: boolean;
															error?: string;
															serverName?: string;
															movieCount?: number;
														}>('/remote/servers/test', {
															url: server.url,
															password: server.password || undefined,
														});
														if (result.success) {
															notifySuccess(
																`Connected: ${result.serverName} (${result.movieCount} movies)`,
															);
														} else {
															notifyError(
																`Connection failed: ${result.error}`,
															);
														}
													} catch {
														notifyError('Connection test failed');
													} finally {
														setTestingServer(null);
													}
												}}
											>
												{testingServer === server.id ? '...' : '\u21BB'}
											</button>
											<button
												class={styles.iconBtn}
												title="Remove"
												onClick={async () => {
													try {
														await api.delete(
															`/remote/servers/${server.id}`,
														);
														setRemoteServers((prev) =>
															prev.filter((s) => s.id !== server.id),
														);
														notifySuccess('Server removed');
													} catch {
														notifyError('Failed to remove server');
													}
												}}
											>
												{'\u2715'}
											</button>
										</div>
										{editingServer === server.id && (
											<div class={styles.serverEditRow}>
												<input
													type="text"
													class={styles.textInput}
													placeholder="Server name"
													value={server.name}
													onInput={(e) => {
														const val = (e.target as HTMLInputElement)
															.value;
														setRemoteServers((prev) =>
															prev.map((s) =>
																s.id === server.id
																	? { ...s, name: val }
																	: s,
															),
														);
													}}
												/>
												<input
													type="password"
													class={styles.textInput}
													placeholder="Password (optional)"
													value={server.password}
													onInput={(e) => {
														const val = (e.target as HTMLInputElement)
															.value;
														setRemoteServers((prev) =>
															prev.map((s) =>
																s.id === server.id
																	? { ...s, password: val }
																	: s,
															),
														);
													}}
												/>
												<button
													class={styles.linkButton}
													onClick={async () => {
														try {
															await api.put(
																`/remote/servers/${server.id}`,
																{
																	name: server.name,
																	password: server.password,
																},
															);
															notifySuccess('Server updated');
															setEditingServer(null);
														} catch {
															notifyError('Failed to update server');
														}
													}}
												>
													Save
												</button>
											</div>
										)}
									</div>
								))}

								{!showAddServer ? (
									<button
										class={styles.linkButton}
										onClick={() => setShowAddServer(true)}
									>
										+ Add another server
									</button>
								) : (
									<div class={styles.addServerForm}>
										<input
											type="text"
											class={styles.textInput}
											placeholder="Server URL (e.g. https://friend.example.com)"
											value={newServerUrl}
											onInput={(e) =>
												setNewServerUrl(
													(e.target as HTMLInputElement).value,
												)
											}
										/>
										<button
											class={styles.iconBtn}
											title="Configure"
											onClick={() =>
												setShowNewServerConfig(!showNewServerConfig)
											}
										>
											{'\u2699'}
										</button>
										{showNewServerConfig && (
											<div class={styles.serverEditRow}>
												<input
													type="text"
													class={styles.textInput}
													placeholder="Display name (optional)"
													value={newServerName}
													onInput={(e) =>
														setNewServerName(
															(e.target as HTMLInputElement).value,
														)
													}
												/>
												<input
													type="password"
													class={styles.textInput}
													placeholder="Password (optional)"
													value={newServerPassword}
													onInput={(e) =>
														setNewServerPassword(
															(e.target as HTMLInputElement).value,
														)
													}
												/>
											</div>
										)}
										<div class={styles.addServerActions}>
											<Button
												variant="primary"
												size="sm"
												onClick={async () => {
													if (!newServerUrl.trim()) return;
													try {
														const server = await api.post<any>(
															'/remote/servers',
															{
																url: newServerUrl.trim(),
																password:
																	newServerPassword || undefined,
																name:
																	newServerName.trim() ||
																	newServerUrl.trim(),
															},
														);
														setRemoteServers((prev) => [
															...prev,
															server,
														]);
														setNewServerUrl('');
														setNewServerPassword('');
														setNewServerName('');
														setShowAddServer(false);
														setShowNewServerConfig(false);
														notifySuccess('Server added');
													} catch {
														notifyError('Failed to add server');
													}
												}}
											>
												Add
											</Button>
											<button
												class={styles.linkButton}
												onClick={() => {
													setShowAddServer(false);
													setShowNewServerConfig(false);
													setNewServerUrl('');
													setNewServerPassword('');
													setNewServerName('');
												}}
											>
												Cancel
											</button>
										</div>
									</div>
								)}
							</div>

							<div class={styles.actions}>
								<Button
									variant="primary"
									loading={isSaving}
									onClick={handleSaveLibrary}
								>
									Save Changes
								</Button>
							</div>
						</div>
					)}

					{/* Notifications Tab */}
					{activeTab === 'notifications' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Notifications</h2>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Notify for scan results</span>
									<span class={styles.settingDescription}>
										Show toast notifications when library scans start, complete,
										or fail
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
									<span class={styles.settingLabel}>
										Notify for playlist changes
									</span>
									<span class={styles.settingDescription}>
										Show toast notifications when movies are added to or removed
										from playlists
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={notifyPlaylist}
										onChange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											setNotifyPlaylist(checked);
											localStorage.setItem(
												'mu_notify_playlist',
												String(checked),
											);
										}}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>
						</div>
					)}

					{/* Plugins Tab */}
					{activeTab === 'plugins' && isAdmin && (
						<div class={styles.panel}>
							<Plugins />
						</div>
					)}

					{/* Admin Tab */}
					{activeTab === 'admin' && isAdmin && (
						<div class={styles.panel}>
							<AdminDashboard />
						</div>
					)}

					{/* Server Tab (admin only) */}
					{activeTab === 'server' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Server</h2>
							<ServerSettings />
						</div>
					)}

					{/* About Tab */}
					{activeTab === 'about' && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>About Mu</h2>

							<div class={styles.aboutGrid}>
								<div class={styles.aboutItem}>
									<span class={styles.aboutLabel}>Version</span>
									<span class={styles.aboutValue}>1.0.0</span>
								</div>
								<div class={styles.aboutItem}>
									<span class={styles.aboutLabel}>Build</span>
									<span class={styles.aboutValue}>Production</span>
								</div>
								<div class={styles.aboutItem}>
									<span class={styles.aboutLabel}>Platform</span>
									<span class={styles.aboutValue}>Self-hosted</span>
								</div>
								<a
									href="https://github.com/rw3iss/mu"
									target="_blank"
									rel="noopener noreferrer"
									class={styles.aboutItem}
									style={{ textDecoration: 'none' }}
								>
									<span class={styles.aboutLabel}>GitHub</span>
									<span class={styles.aboutValue}>
										<svg
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="currentColor"
										>
											<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
										</svg>
									</span>
								</a>
							</div>

							<p class={styles.aboutDescription}>
								Mu is a self-hosted movie streaming platform that lets you organize,
								browse, and stream your personal movie collection from anywhere.
							</p>
						</div>
					)}
				</div>
			</div>

			<PluginSlot name={UI.SETTINGS_BOTTOM} context={{}} />
		</div>
	);
}
