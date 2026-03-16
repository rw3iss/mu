import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { ColorPicker } from '@/components/common/ColorPicker';
import type { MediaPathEntryData } from '@/components/library/MediaPathList';
import { MediaPathList } from '@/components/library/MediaPathList';
import { useUiSetting } from '@/hooks/useUiSetting';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import { sourcesService } from '@/services/sources.service';
import { accentColor, resetAccentColor, setAccentColor } from '@/state/accentColor.state';
import {
	cardBorder,
	disableHover,
	type ItemSpacing,
	itemRadius,
	itemSpacing as itemSpacingSignal,
	pageBg,
	panelBg,
	resetCardBorder,
	resetDisableHover,
	resetItemRadius,
	resetItemSpacing,
	resetPageBg,
	resetPanelBg,
	setCardBorder,
	setDisableHover,
	setItemRadius,
	setItemSpacing,
	setPageBg,
	setPanelBg,
} from '@/state/appearance.state';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import type { Theme } from '@/state/theme.state';
import { setTheme, theme } from '@/state/theme.state';
import { AdminDashboard } from './AdminDashboard';
import { Plugins } from './Plugins';
import styles from './Settings.module.scss';

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

function formatBytes(bytes: number): string {
	const gb = bytes / (1024 * 1024 * 1024);
	if (gb >= 1000) {
		return `${(gb / 1024).toFixed(1)} TB`;
	}
	return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const parts: string[] = [];
	if (d > 0) parts.push(`${d}d`);
	if (h > 0) parts.push(`${h}h`);
	parts.push(`${m}m`);
	return parts.join(' ');
}

function meterColor(ratio: number): string {
	if (ratio < 0.6) return 'var(--color-accent, #4caf50)';
	if (ratio < 0.85) return '#ff9800';
	return '#f44336';
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
	| 'about';

const VALID_TABS: SettingsTab[] = [
	'general',
	'appearance',
	'playback',
	'library',
	'notifications',
	'plugins',
	'admin',
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

	// Playback settings
	const [defaultQuality, setDefaultQuality] = useState('auto');
	const [autoplay, setAutoplay] = useState(true);
	const [bufferSize, setBufferSizeSetting] = useUiSetting('buffer_size', 'normal');

	// Library settings
	const [scanInterval, setScanInterval] = useState('6');
	const [mediaPathEntries, setMediaPathEntries] = useState<MediaPathEntryData[]>([]);
	const [fetchExtendedMetadata, setFetchExtendedMetadata] = useState(true);
	const [persistTranscodes, setPersistTranscodes] = useState(true);
	const [autoScanEnabled, setAutoScanEnabled] = useState(true);
	const [nextScanAt, setNextScanAt] = useState<string | null>(null);

	// Encoding settings
	const [hwAccel, setHwAccel] = useState('none');
	const [encodingPreset, setEncodingPreset] = useState('veryfast');
	const [encodeQuality, setEncodeQuality] = useState('1080p');
	const [encodeHighestAvailable, setEncodeHighestAvailable] = useState(false);
	const [rateControl, setRateControl] = useState('cbr');
	const [crfValue, setCrfValue] = useState('23');
	const [maxConcurrentJobs, setMaxConcurrentJobs] = useState('2');
	const [segmentDuration, setSegmentDuration] = useState('4');
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
	const [ratingScale, setRatingScale] = useState('10');
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
					if (typeof playback.autoplay === 'boolean') setAutoplay(playback.autoplay);
					if (typeof playback.bufferSize === 'string') {
						setBufferSizeSetting(playback.bufferSize);
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
					if (typeof library.autoScanEnabled === 'boolean')
						setAutoScanEnabled(library.autoScanEnabled);
				}

				const encoding = data.encoding as Record<string, unknown> | undefined;
				if (encoding) {
					if (typeof encoding.hwAccel === 'string') setHwAccel(encoding.hwAccel);
					if (typeof encoding.preset === 'string') setEncodingPreset(encoding.preset);
					if (typeof encoding.quality === 'string') setEncodeQuality(encoding.quality);
					if (typeof encoding.encodeHighestAvailable === 'boolean')
						setEncodeHighestAvailable(encoding.encodeHighestAvailable);
					if (typeof encoding.rateControl === 'string')
						setRateControl(encoding.rateControl);
					if (encoding.crf != null) setCrfValue(String(encoding.crf));
					if (encoding.maxConcurrentJobs != null)
						setMaxConcurrentJobs(String(encoding.maxConcurrentJobs));
					if (encoding.segmentDuration != null)
						setSegmentDuration(String(encoding.segmentDuration));
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
					if (typeof rating.ratingScale === 'string') setRatingScale(rating.ratingScale);
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
				value: { defaultQuality, autoplay, bufferSize },
			});
			setBufferSizeSetting(bufferSize);

			// Save encoding settings (now in Playback tab)
			await api.put('/settings/encoding', {
				value: {
					hwAccel,
					preset: encodingPreset,
					quality: encodeQuality,
					encodeHighestAvailable,
					rateControl,
					crf: parseInt(crfValue, 10),
					maxConcurrentJobs: parseInt(maxConcurrentJobs, 10),
					segmentDuration: parseInt(segmentDuration, 10),
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
		autoplay,
		bufferSize,
		hwAccel,
		encodingPreset,
		encodeQuality,
		encodeHighestAvailable,
		rateControl,
		crfValue,
		maxConcurrentJobs,
		segmentDuration,
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
					autoScanEnabled,
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
		autoScanEnabled,
		sharingEnabled,
		sharingPassword,
		sharingServerName,
	]);

	const handleSaveRating = useCallback(async () => {
		setIsSaving(true);
		try {
			await api.put('/settings/rating', {
				value: { ratingScale, showExternalRatings },
			});
			notifySuccess('Rating settings saved');
		} catch {
			notifyError('Failed to save settings');
		} finally {
			setIsSaving(false);
		}
	}, [ratingScale, showExternalRatings]);

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
	const [serverStats, setServerStats] = useState<ServerStats | null>(null);
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
									<span class={styles.settingLabel}>Rating Scale</span>
									<span class={styles.settingDescription}>
										Scale used for your personal ratings
									</span>
								</div>
								<select
									class={styles.select}
									value={ratingScale}
									onChange={(e) =>
										setRatingScale((e.target as HTMLSelectElement).value)
									}
								>
									<option value="10">0 - 10</option>
									<option value="5">0 - 5</option>
									<option value="100">0 - 100</option>
								</select>
							</div>

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

							{/* Theme */}
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

							{/* Accent Color */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Accent Color</span>
									<span class={styles.settingDescription}>
										Customize the primary accent color across the app
									</span>
								</div>
								<div class={styles.settingControl}>
									<div class={styles.accentColorColumn}>
										<div class={styles.accentColorPicker}>
											{(() => {
												const presets = [
													{ label: 'Cyan', value: '#06b6d4' },
													{ label: 'Blue', value: '#3b82f6' },
													{ label: 'Purple', value: '#8b5cf6' },
													{ label: 'Pink', value: '#ec4899' },
													{ label: 'Amber', value: '#f59e0b' },
													{ label: 'Green', value: '#22c55e' },
													{ label: 'Red', value: '#ef4444' },
												];

												return presets.map((preset) => (
													<button
														key={preset.label}
														class={`${styles.colorSwatch} ${accentColor.value === preset.value ? styles.activeSwatch : ''}`}
														style={{
															backgroundColor: preset.value,
														}}
														title={preset.label}
														onClick={() => setAccentColor(preset.value)}
													/>
												));
											})()}
										</div>
										<ColorPicker
											value={accentColor.value || '#06b6d4'}
											onChange={setAccentColor}
										/>
									</div>
									<button
										class={styles.resetBtn}
										onClick={resetAccentColor}
										title="Reset to default"
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

							{/* Page Background */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Page Background</span>
									<span class={styles.settingDescription}>
										Main app background color
									</span>
								</div>
								<div class={styles.settingControl}>
									<ColorPicker
										value={pageBg.value || '#050709'}
										onChange={setPageBg}
									/>
									<button
										class={styles.resetBtn}
										onClick={resetPageBg}
										title="Reset to default"
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

							{/* Panel Background */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Panel Background</span>
									<span class={styles.settingDescription}>
										Sidebar, header, and card background color
									</span>
								</div>
								<div class={styles.settingControl}>
									<ColorPicker
										value={panelBg.value || '#090b12'}
										onChange={setPanelBg}
									/>
									<button
										class={styles.resetBtn}
										onClick={resetPanelBg}
										title="Reset to default"
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

							{/* Item Spacing */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Item Spacing</span>
									<span class={styles.settingDescription}>
										Gap between cards and items across the site
									</span>
								</div>
								<div class={styles.settingControl}>
									<select
										class={styles.select}
										value={itemSpacingSignal.value}
										onChange={(e) =>
											setItemSpacing(
												(e.target as HTMLSelectElement)
													.value as ItemSpacing,
											)
										}
									>
										<option value="none">None</option>
										<option value="minimal">Minimal</option>
										<option value="compact">Compact</option>
										<option value="normal">Normal</option>
										<option value="comfortable">Comfortable</option>
										<option value="spaced">Spaced</option>
									</select>
									<button
										class={styles.resetBtn}
										onClick={resetItemSpacing}
										title="Reset to default"
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

							{/* Item Radius */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Item Radius</span>
									<span class={styles.settingDescription}>
										Border radius on cards and items (0-40px)
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
											value={itemRadius.value}
											onInput={(e) =>
												setItemRadius(
													parseInt(
														(e.target as HTMLInputElement).value,
														10,
													),
												)
											}
										/>
										<span class={styles.rangeValue}>{itemRadius.value}px</span>
									</div>
									<button
										class={styles.resetBtn}
										onClick={resetItemRadius}
										title="Reset to default"
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

							{/* Card Border */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Card Border</span>
									<span class={styles.settingDescription}>
										Customize card border style
									</span>
								</div>
								<div class={styles.settingControl}>
									<button
										class={styles.borderPreview}
										onClick={() => setShowBorderEditor(!showBorderEditor)}
										title="Edit card border"
									>
										<span
											class={styles.borderPreviewSample}
											style={{
												border: `${cardBorder.value.width}px solid ${cardBorder.value.color}`,
												opacity: cardBorder.value.opacity,
											}}
										/>
										<span class={styles.borderPreviewLabel}>
											{cardBorder.value.width}px
										</span>
									</button>
									<button
										class={styles.resetBtn}
										onClick={() => {
											resetCardBorder();
											setShowBorderEditor(false);
										}}
										title="Reset to default"
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
							{showBorderEditor && (
								<div class={styles.borderEditor}>
									<div class={styles.borderEditorRow}>
										<span class={styles.borderEditorLabel}>Width</span>
										<input
											type="range"
											class={styles.rangeInput}
											min="0"
											max="5"
											step="1"
											value={cardBorder.value.width}
											onInput={(e) =>
												setCardBorder({
													...cardBorder.value,
													width: parseInt(
														(e.target as HTMLInputElement).value,
														10,
													),
												})
											}
										/>
										<span class={styles.rangeValue}>
											{cardBorder.value.width}px
										</span>
									</div>
									<div class={styles.borderEditorRow}>
										<span class={styles.borderEditorLabel}>Color</span>
										<ColorPicker
											value={cardBorder.value.color}
											onChange={(hex) =>
												setCardBorder({
													...cardBorder.value,
													color: hex,
												})
											}
											size={24}
										/>
									</div>
									<div class={styles.borderEditorRow}>
										<span class={styles.borderEditorLabel}>Opacity</span>
										<input
											type="range"
											class={styles.rangeInput}
											min="0"
											max="1"
											step="0.01"
											value={cardBorder.value.opacity}
											onInput={(e) =>
												setCardBorder({
													...cardBorder.value,
													opacity: parseFloat(
														(e.target as HTMLInputElement).value,
													),
												})
											}
										/>
										<span class={styles.rangeValue}>
											{Math.round(cardBorder.value.opacity * 100)}%
										</span>
									</div>
								</div>
							)}

							{/* Disable Hover Effects */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Disable Hover Effects</span>
									<span class={styles.settingDescription}>
										Stop cards from animating on hover
									</span>
								</div>
								<div class={styles.settingControl}>
									<label class={styles.toggle}>
										<input
											type="checkbox"
											checked={disableHover.value}
											onChange={(e) =>
												setDisableHover(
													(e.target as HTMLInputElement).checked,
												)
											}
										/>
										<span class={styles.toggleTrack} />
									</label>
									<button
										class={styles.resetBtn}
										onClick={resetDisableHover}
										title="Reset to default"
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

							<div class={styles.scanSection}>
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
								<span class={styles.settingDescription}>
									Re-encode movies that don't match current encoding settings
								</span>
								{scanResult && (
									<div class={styles.scanResult}>
										<span class={styles.scanStat}>
											{scanResult.filesFound} file
											{scanResult.filesFound === 1 ? '' : 's'} found
										</span>
										{scanResult.filesAdded > 0 && (
											<span class={styles.scanStatHighlight}>
												{scanResult.filesAdded} new movie
												{scanResult.filesAdded === 1 ? '' : 's'} imported
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
												<span class={styles.scanStat}>
													Library is up to date
												</span>
											)}
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

							{serverStats && (
								<>
									<h3 class={styles.aboutSectionTitle}>Server Statistics</h3>

									{/* ── Uptime banner ── */}
									<div class={styles.statBanner}>
										<div class={styles.statBannerIcon}>
											<svg
												width="20"
												height="20"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<circle cx="12" cy="12" r="10" />
												<polyline points="12 6 12 12 16 14" />
											</svg>
										</div>
										<div class={styles.statBannerContent}>
											<span class={styles.statBannerLabel}>
												Server Uptime
											</span>
											<span class={styles.statBannerValue}>
												{formatUptime(serverStats.system.uptime)}
											</span>
										</div>
										<span class={styles.statTooltip}>
											How long the server process has been running since last
											restart
										</span>
									</div>

									{/* ── Resources section: CPU, Memory | App Data, Disk ── */}
									<div class={styles.statSectionLabel}>Resources</div>
									<div class={styles.statColumns}>
										{/* Left column: CPU + Memory */}
										<div class={styles.statColumn}>
											{(() => {
												const cpuRatio = Math.min(
													serverStats.system.loadAvg[0] /
														serverStats.system.cpuCount,
													1,
												);
												return (
													<div class={styles.statCard}>
														<div class={styles.statCardHeader}>
															<span class={styles.statCardLabel}>
																CPU Load
															</span>
															<span class={styles.statCardValue}>
																{serverStats.system.loadAvg[0].toFixed(
																	2,
																)}{' '}
																/ {serverStats.system.cpuCount}
															</span>
														</div>
														<div class={styles.meterTrack}>
															<div
																class={styles.meterFill}
																style={{
																	width: `${cpuRatio * 100}%`,
																	backgroundColor:
																		meterColor(cpuRatio),
																}}
															/>
														</div>
														<span class={styles.statTooltip}>
															Overall system CPU load average across
															all processes, relative to{' '}
															{serverStats.system.cpuCount} available
															cores
														</span>
													</div>
												);
											})()}
											{(() => {
												const memTotal =
													serverStats.system.memoryTotal || 1;
												const memUsed =
													serverStats.system.memoryTotal -
													serverStats.system.memoryFree;
												const memRatio = memUsed / memTotal;
												const appMem =
													serverStats.system.appMemory?.total ?? 0;
												const appRatio = appMem / memTotal;
												return (
													<div class={styles.statCard}>
														<div class={styles.statCardHeader}>
															<span class={styles.statCardLabel}>
																Memory
															</span>
														</div>
														<div class={styles.statSegments}>
															<div class={styles.statSegment}>
																<span
																	class={styles.statSegmentLabel}
																>
																	App
																</span>
																<span
																	class={styles.statSegmentValue}
																>
																	{formatBytes(appMem)}
																</span>
															</div>
															<div
																class={styles.statSegmentDivider}
															/>
															<div class={styles.statSegment}>
																<span
																	class={styles.statSegmentLabel}
																>
																	System
																</span>
																<span
																	class={styles.statSegmentValue}
																>
																	{formatBytes(memUsed)}
																</span>
															</div>
															<div
																class={styles.statSegmentDivider}
															/>
															<div class={styles.statSegment}>
																<span
																	class={styles.statSegmentLabel}
																>
																	Total
																</span>
																<span
																	class={styles.statSegmentValue}
																>
																	{formatBytes(memTotal)}
																</span>
															</div>
														</div>
														<div class={styles.meterTrack}>
															<div
																class={styles.meterFill}
																style={{
																	width: `${memRatio * 100}%`,
																	backgroundColor:
																		meterColor(memRatio),
																}}
															/>
															<div
																class={`${styles.meterFill} ${styles.meterFillFront}`}
																style={{
																	width: `${Math.max(appRatio * 100, 0.5)}%`,
																}}
															/>
														</div>
														<span class={styles.statTooltip}>
															App memory (Mu process + children) vs
															total system RAM usage
														</span>
													</div>
												);
											})()}
										</div>

										{/* Right column: Disk */}
										<div class={styles.statColumn}>
											{serverStats.system.diskTotal > 0 &&
												(() => {
													const diskTotal =
														serverStats.system.diskTotal || 1;
													const diskUsed =
														diskTotal - serverStats.system.diskFree;
													const diskRatio = diskUsed / diskTotal;
													const appSize =
														serverStats.system.dataDirSize || 0;
													const appRatio = appSize / diskTotal;
													return (
														<div class={styles.statCard}>
															<div class={styles.statCardHeader}>
																<span class={styles.statCardLabel}>
																	Disk
																</span>
															</div>
															<div class={styles.statSegments}>
																<div class={styles.statSegment}>
																	<span
																		class={
																			styles.statSegmentLabel
																		}
																	>
																		App
																	</span>
																	<span
																		class={
																			styles.statSegmentValue
																		}
																	>
																		{formatBytes(appSize)}
																	</span>
																</div>
																<div
																	class={
																		styles.statSegmentDivider
																	}
																/>
																<div class={styles.statSegment}>
																	<span
																		class={
																			styles.statSegmentLabel
																		}
																	>
																		Used
																	</span>
																	<span
																		class={
																			styles.statSegmentValue
																		}
																	>
																		{formatBytes(diskUsed)}
																	</span>
																</div>
																<div
																	class={
																		styles.statSegmentDivider
																	}
																/>
																<div class={styles.statSegment}>
																	<span
																		class={
																			styles.statSegmentLabel
																		}
																	>
																		Total
																	</span>
																	<span
																		class={
																			styles.statSegmentValue
																		}
																	>
																		{formatBytes(diskTotal)}
																	</span>
																</div>
															</div>
															<div class={styles.meterTrack}>
																<div
																	class={styles.meterFill}
																	style={{
																		width: `${diskRatio * 100}%`,
																		backgroundColor:
																			meterColor(diskRatio),
																	}}
																/>
																<div
																	class={`${styles.meterFill} ${styles.meterFillFront}`}
																	style={{
																		width: `${Math.max(appRatio * 100, 0.5)}%`,
																	}}
																/>
															</div>
															<span class={styles.statTooltip}>
																App data (database, thumbnails,
																cache, transcodes) vs total disk
																usage
															</span>
														</div>
													);
												})()}
										</div>
									</div>

									{/* Activity section — disabled for now */}
								</>
							)}
						</div>
					)}
				</div>
			</div>

			<PluginSlot name={UI.SETTINGS_BOTTOM} context={{}} />
		</div>
	);
}
