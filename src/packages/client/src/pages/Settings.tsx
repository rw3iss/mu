import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import type { MediaPathEntryData } from '@/components/library/MediaPathList';
import { MediaPathList } from '@/components/library/MediaPathList';
import { useUiSetting } from '@/hooks/useUiSetting';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import { sourcesService } from '@/services/sources.service';
import { accentColor, resetAccentColor, setAccentColor } from '@/state/accentColor.state';
import {
	type ItemSpacing,
	cardBorder,
	disableHover,
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
	const colorInputRef = useRef<HTMLInputElement>(null);
	const pageBgInputRef = useRef<HTMLInputElement>(null);
	const panelBgInputRef = useRef<HTMLInputElement>(null);
	const borderColorInputRef = useRef<HTMLInputElement>(null);
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
			notifySuccess('Playback settings saved');
		} catch {
			notifyError('Failed to save settings');
		} finally {
			setIsSaving(false);
		}
	}, [defaultQuality, autoplay, bufferSize]);

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

			// Save encoding settings
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
		hwAccel,
		encodingPreset,
		encodeQuality,
		encodeHighestAvailable,
		rateControl,
		crfValue,
		maxConcurrentJobs,
		segmentDuration,
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
											const presetValues = new Set(presets.map((p) => p.value));
											const current = accentColor.value;
											const isCustom = current && !presetValues.has(current);
											const customBg = isCustom ? current : current || '#06b6d4';

											return (
												<>
													<button
														class={`${styles.colorSwatch} ${styles.customSwatch} ${isCustom ? styles.activeSwatch : !current ? styles.activeSwatch : ''}`}
														style={{
															backgroundColor: isCustom
																? current
																: undefined,
														}}
														title="Custom color — click to change"
														onClick={() => colorInputRef.current?.click()}
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
															style={isCustom ? { opacity: 0.7, filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.5))' } : undefined}
														>
															<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
															<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
														</svg>
													</button>
													<input
														ref={colorInputRef}
														type="color"
														class={styles.colorInputHidden}
														value={customBg}
														onInput={(e) =>
															setAccentColor(
																(e.target as HTMLInputElement).value,
															)
														}
													/>
													{presets.map((preset) => (
														<button
															key={preset.label}
															class={`${styles.colorSwatch} ${accentColor.value === preset.value ? styles.activeSwatch : ''}`}
															style={{
																backgroundColor: preset.value,
															}}
															title={preset.label}
															onClick={() => setAccentColor(preset.value)}
														/>
													))}
												</>
											);
										})()}
									</div>
									<button
										class={styles.resetBtn}
										onClick={resetAccentColor}
										title="Reset to default"
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
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
									<button
										class={`${styles.colorSwatch} ${pageBg.value ? styles.activeSwatch : ''}`}
										style={{ backgroundColor: pageBg.value || '#050709' }}
										title="Pick page background color"
										onClick={() => pageBgInputRef.current?.click()}
									/>
									<input
										ref={pageBgInputRef}
										type="color"
										class={styles.colorInputHidden}
										value={pageBg.value || '#050709'}
										onInput={(e) =>
											setPageBg((e.target as HTMLInputElement).value)
										}
									/>
									<button class={styles.resetBtn} onClick={resetPageBg} title="Reset to default">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
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
									<button
										class={`${styles.colorSwatch} ${panelBg.value ? styles.activeSwatch : ''}`}
										style={{ backgroundColor: panelBg.value || '#090b12' }}
										title="Pick panel background color"
										onClick={() => panelBgInputRef.current?.click()}
									/>
									<input
										ref={panelBgInputRef}
										type="color"
										class={styles.colorInputHidden}
										value={panelBg.value || '#090b12'}
										onInput={(e) =>
											setPanelBg((e.target as HTMLInputElement).value)
										}
									/>
									<button class={styles.resetBtn} onClick={resetPanelBg} title="Reset to default">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
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
												(e.target as HTMLSelectElement).value as ItemSpacing,
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
									<button class={styles.resetBtn} onClick={resetItemSpacing} title="Reset to default">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
									</button>
								</div>
							</div>

							{/* Item Radius */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Item Radius</span>
									<span class={styles.settingDescription}>
										Border radius on cards and items (0-30px)
									</span>
								</div>
								<div class={styles.settingControl}>
									<div class={styles.rangeWithValue}>
										<input
											type="range"
											class={styles.rangeInput}
											min="0"
											max="30"
											step="1"
											value={itemRadius.value}
											onInput={(e) =>
												setItemRadius(
													parseInt((e.target as HTMLInputElement).value, 10),
												)
											}
										/>
										<span class={styles.rangeValue}>{itemRadius.value}px</span>
									</div>
									<button class={styles.resetBtn} onClick={resetItemRadius} title="Reset to default">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
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
									<button class={styles.resetBtn} onClick={() => { resetCardBorder(); setShowBorderEditor(false); }} title="Reset to default">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
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
													width: parseInt((e.target as HTMLInputElement).value, 10),
												})
											}
										/>
										<span class={styles.rangeValue}>{cardBorder.value.width}px</span>
									</div>
									<div class={styles.borderEditorRow}>
										<span class={styles.borderEditorLabel}>Color</span>
										<button
											class={styles.colorSwatch}
											style={{ backgroundColor: cardBorder.value.color, width: 24, height: 24 }}
											onClick={() => borderColorInputRef.current?.click()}
										/>
										<input
											ref={borderColorInputRef}
											type="color"
											class={styles.colorInputHidden}
											value={cardBorder.value.color}
											onInput={(e) =>
												setCardBorder({
													...cardBorder.value,
													color: (e.target as HTMLInputElement).value,
												})
											}
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
													opacity: parseFloat((e.target as HTMLInputElement).value),
												})
											}
										/>
										<span class={styles.rangeValue}>{Math.round(cardBorder.value.opacity * 100)}%</span>
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
									<button class={styles.resetBtn} onClick={resetDisableHover} title="Reset to default">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
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
										Slower presets produce better quality but take longer to
										encode
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
										Resolution used for background transcoding of movies
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
										When enabled, movies whose source file exceeds the default
										quality will also be transcoded at the source's native
										resolution. Playback defaults to the highest available
										cached quality.
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
										CRF adapts bitrate to scene complexity for better quality at
										smaller file sizes
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
										Number of background encoding jobs that can run
										simultaneously
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
										Length of each HLS segment in seconds. Shorter segments
										reduce initial load time but increase overhead. Longer
										segments are more efficient but slower to start.
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

									{/* ── Activity section ── */}
									<div class={styles.statSectionLabel}>Activity</div>
									<div class={styles.statActivityGrid}>
										<div class={styles.statActivityCard}>
											<span class={styles.statActivityValue}>
												{serverStats.services.activeStreams}
											</span>
											<span class={styles.statActivityLabel}>
												Active Streams
											</span>
											<span class={styles.statTooltip}>
												Number of users currently watching a video stream
												from this server
											</span>
										</div>
										<div class={styles.statActivityCard}>
											<span class={styles.statActivityValue}>
												{serverStats.services.activeTranscodes}
											</span>
											<span class={styles.statActivityLabel}>Transcodes</span>
											<span class={styles.statTooltip}>
												Active video transcoding processes converting media
												to a compatible format in real time
											</span>
										</div>
										<div class={styles.statActivityCard}>
											<span class={styles.statActivityValue}>
												{serverStats.services.runningJobs}
											</span>
											<span class={styles.statActivityLabel}>
												Running Jobs
											</span>
											<span class={styles.statTooltip}>
												Background tasks currently executing, such as
												thumbnail generation or metadata fetching
											</span>
										</div>
										<div class={styles.statActivityCard}>
											<span class={styles.statActivityValue}>
												{serverStats.services.pendingJobs}
											</span>
											<span class={styles.statActivityLabel}>
												Pending Jobs
											</span>
											<span class={styles.statTooltip}>
												Queued background tasks waiting to be processed
											</span>
										</div>
									</div>
								</>
							)}

							<h3 class={styles.aboutSectionTitle}>Developer</h3>
							<div class={styles.developerLinks}>
								<a
									href="https://www.ryanweiss.net"
									target="_blank"
									rel="noopener noreferrer"
									class={styles.developerLink}
								>
									Ryan Weiss
								</a>
								<a
									href="https://github.com/rw3iss/mu"
									target="_blank"
									rel="noopener noreferrer"
									class={styles.developerLink}
								>
									Project Website
								</a>
								<a
									href="/changelog"
									class={styles.developerLink}
									onClick={(e) => {
										e.preventDefault();
										route('/changelog');
									}}
								>
									Recent Changes
								</a>
							</div>
						</div>
					)}
				</div>
			</div>

			<PluginSlot name={UI.SETTINGS_BOTTOM} context={{}} />
		</div>
	);
}
