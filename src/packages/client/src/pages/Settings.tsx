import { DEFAULT_THUMBNAIL_SIZE, type ThemeConfig, type ThumbnailSize } from '@mu/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { JobsPanel } from '@/components/admin/JobsPanel';
import { Button } from '@/components/common/Button';
import { ColorPicker } from '@/components/common/ColorPicker';
import { FolderBrowser } from '@/components/common/FolderBrowser';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import { ThemeSwatchRow } from '@/components/common/ThemeSwatchRow';
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
import {
	BASE_FONT_SCALE_MAX,
	BASE_FONT_SCALE_MIN,
	BASE_FONT_SCALE_STEP,
	baseFontScale,
	disableHover,
	type ItemSpacing,
	reduceMotion,
	setBaseFontScale,
	setDisableHover,
	setReduceMotion,
} from '@/state/appearance.state';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { fetchPlaybackSettings } from '@/state/playbackSettings.state';
import type { Theme } from '@/state/theme.state';
import { totalMovies } from '@/state/library.state';
import { setTheme, theme } from '@/state/theme.state';
import { estimateSpriteLibrarySize } from '@/utils/sprite-size-estimate';
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
import { About } from './settings/About';
import { Connections } from './settings/Connections';
import { Matching } from './settings/Matching';
import { Notifications } from './settings/Notifications';
import { Users } from './settings/Users';

function OverlayTimeoutSetting() {
	const [val, setVal] = useUiSetting('overlay_hide_timeout', 1000);
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
				<span style={{ display: 'inline-flex', color: 'var(--color-text-muted)' }}>
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
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
	| 'users'
	| 'connections'
	| 'matching'
	| 'jobs'
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
	'users',
	'connections',
	'matching',
	'jobs',
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

	// Appearance settings
	const [showRecentlyPlayed, setShowRecentlyPlayed] = useUiSetting('show_recently_played', true);
	// Seek-preview thumbnail size. Drives which sprite-sheet variant
	// is requested from the server. Default 'large' so new users get
	// the sharpest experience; the server resolver downgrades
	// gracefully if only a smaller stored size is available, and
	// upgrades by queuing regeneration when the user picks a size
	// larger than what's cached.
	const [thumbnailSize, setThumbnailSize] = useUiSetting<ThumbnailSize>(
		'thumbnail_size',
		DEFAULT_THUMBNAIL_SIZE,
	);
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

	// Watch tracking settings
	const [watchedThreshold, setWatchedThreshold] = useState(30);
	const [completedTail, setCompletedTail] = useState(300);

	// Notification settings

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

				// Load watch-tracking thresholds
				api.get<{ value: number }>('/settings/watchedThresholdSeconds')
					.then((res) => {
						if (res?.value) setWatchedThreshold(res.value);
					})
					.catch(() => {});
				api.get<{ value: number }>('/settings/completedTailSeconds')
					.then((res) => {
						if (res?.value) setCompletedTail(res.value);
					})
					.catch(() => {});
			} catch {
				// Settings may not exist yet — use defaults
			}
		}
		loadSettings();

		// Ensure totalMovies is populated so the Thumbnail Size sublabel
		// can show a realistic library footprint estimate even when the
		// user opens Settings without visiting the Library tab first.
		if (totalMovies.value === 0) {
			api.get<{ total: number }>('/movies', { pageSize: '1' })
				.then((res) => {
					if (typeof res?.total === 'number') totalMovies.value = res.total;
				})
				.catch(() => {});
		}
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

			// Watch tracking thresholds (Playback tab)
			await api.put('/settings/watchedThresholdSeconds', {
				value: Math.max(4, Math.min(1800, watchedThreshold)),
			});
			await api.put('/settings/completedTailSeconds', {
				value: Math.max(0, Math.min(3600, completedTail)),
			});
			void fetchPlaybackSettings();

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
		watchedThreshold,
		completedTail,
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
			notifySuccess('General settings saved');
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


	const user = currentUser.value;
	const isAdmin = user?.role === 'admin';

	const tabs: { id: SettingsTab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'playback', label: 'Playback' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'notifications', label: 'Notifications' },
		...(isAdmin
			? [
					{ id: 'library' as SettingsTab, label: 'Library' },
					{ id: 'users' as SettingsTab, label: 'Users' },
					{ id: 'plugins' as SettingsTab, label: 'Plugins' },
					{ id: 'admin' as SettingsTab, label: 'Admin' },
					{ id: 'connections' as SettingsTab, label: 'Sources' },
					{ id: 'matching' as SettingsTab, label: 'Matching' },
					{ id: 'jobs' as SettingsTab, label: 'Jobs' },
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
								<Select
									value="en"
									onChange={() => {}}
									options={[{ value: 'en', label: 'English' }]}
								/>
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

							{/* ============================================ */}
							{/* Global Appearance — applies across all themes */}
							{/* ============================================ */}
							<h3 class={styles.sectionTitle}>Global appearance</h3>

							{/* Base Font Scale */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Base Font Scale</span>
									<span class={styles.settingDescription}>
										Canonical text scale applied to the root. Themes inherit via
										rems; per-theme font scale multiplies on top.
									</span>
								</div>
								<div class={styles.settingControl}>
									<div class={styles.rangeWithValue}>
										<input
											type="range"
											class={styles.rangeInput}
											min={BASE_FONT_SCALE_MIN}
											max={BASE_FONT_SCALE_MAX}
											step={BASE_FONT_SCALE_STEP}
											value={baseFontScale.value}
											onInput={(e) =>
												setBaseFontScale(
													parseFloat(
														(e.target as HTMLInputElement).value,
													),
												)
											}
										/>
										<span class={styles.rangeValue}>
											{baseFontScale.value.toFixed(2)}x
										</span>
									</div>
								</div>
							</div>

							{/* Disable Hover Effects (global) */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Disable Hover Effects</span>
									<span class={styles.settingDescription}>
										Stop cards and links from animating on hover
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
								</div>
							</div>

							{/* Reduce Motion (global) */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Reduce Motion</span>
									<span class={styles.settingDescription}>
										Minimize animations and transitions across the app
									</span>
								</div>
								<div class={styles.settingControl}>
									<label class={styles.toggle}>
										<input
											type="checkbox"
											checked={reduceMotion.value}
											onChange={(e) =>
												setReduceMotion(
													(e.target as HTMLInputElement).checked,
												)
											}
										/>
										<span class={styles.toggleTrack} />
									</label>
								</div>
							</div>

							{/* ============================================ */}
							{/* Theme — per-theme settings                    */}
							{/* ============================================ */}
							<h3 class={styles.sectionTitle}>Theme</h3>

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
									<ThemeSwatchRow
										themes={themesList.value}
										selectedId={selectedDarkId.value}
										onSelect={setSelectedDarkId}
										mode="dark"
									/>
								</div>
								<div class={styles.settingControl}>
									<Select
										value={selectedDarkId.value}
										onChange={(v) => setSelectedDarkId(v)}
										options={themesList.value
											.filter((t) => t.mode === 'dark')
											.map((t) => ({ value: t.id, label: t.name }))}
									/>
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
									<ThemeSwatchRow
										themes={themesList.value}
										selectedId={selectedLightId.value}
										onSelect={setSelectedLightId}
										mode="light"
									/>
								</div>
								<div class={styles.settingControl}>
									<Select
										value={selectedLightId.value}
										onChange={(v) => setSelectedLightId(v)}
										options={themesList.value
											.filter((t) => t.mode === 'light')
											.map((t) => ({ value: t.id, label: t.name }))}
									/>
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
													<Select<ItemSpacing>
														value={editConfig.itemSpacing}
														onChange={(v) =>
															updateEditConfig({ itemSpacing: v })
														}
														options={[
															{ value: 'none', label: 'None' },
															{ value: 'minimal', label: 'Minimal' },
															{ value: 'compact', label: 'Compact' },
															{ value: 'normal', label: 'Normal' },
															{
																value: 'comfortable',
																label: 'Comfortable',
															},
															{ value: 'spaced', label: 'Spaced' },
														]}
													/>
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

											{/* Theme Font Scale (multiplier on top of base) */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Theme Font Scale
													</span>
													<span class={styles.settingDescription}>
														Multiplier applied on top of the global base
														font scale
													</span>
												</div>
												<div class={styles.settingControl}>
													<div class={styles.rangeWithValue}>
														<input
															type="range"
															class={styles.rangeInput}
															min="0.8"
															max="1.5"
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
								<Select
									value={defaultQuality}
									onChange={setDefaultQuality}
									options={[
										{ value: 'auto', label: 'Auto' },
										{ value: '1080p', label: '1080p' },
										{ value: '720p', label: '720p' },
										{ value: '480p', label: '480p' },
										{ value: 'original', label: 'Original' },
									]}
								/>
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
								<Select
									value={preferredAudioLanguage}
									onChange={setPreferredAudioLanguage}
									options={[
										{ value: 'eng', label: 'English' },
										{ value: 'spa', label: 'Spanish' },
										{ value: 'fra', label: 'French' },
										{ value: 'deu', label: 'German' },
										{ value: 'ita', label: 'Italian' },
										{ value: 'por', label: 'Portuguese' },
										{ value: 'rus', label: 'Russian' },
										{ value: 'jpn', label: 'Japanese' },
										{ value: 'kor', label: 'Korean' },
										{ value: 'zho', label: 'Chinese' },
										{ value: 'hin', label: 'Hindi' },
										{ value: 'ara', label: 'Arabic' },
										{ value: 'tha', label: 'Thai' },
										{ value: 'vie', label: 'Vietnamese' },
										{ value: 'pol', label: 'Polish' },
										{ value: 'nld', label: 'Dutch' },
										{ value: 'swe', label: 'Swedish' },
										{ value: 'nor', label: 'Norwegian' },
										{ value: 'dan', label: 'Danish' },
										{ value: 'fin', label: 'Finnish' },
										{ value: 'tur', label: 'Turkish' },
										{ value: 'und', label: 'Undetermined' },
									]}
								/>
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
								<Select
									value={bufferSize}
									onChange={setBufferSizeSetting}
									options={[
										{ value: 'small', label: 'Small (10s)' },
										{ value: 'normal', label: 'Normal (30s)' },
										{ value: 'large', label: 'Large (60s)' },
										{ value: 'max', label: 'Maximum (120s)' },
									]}
								/>
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
								<Select
									value={hwAccel}
									onChange={setHwAccel}
									options={[
										{ value: 'none', label: 'Software' },
										{ value: 'nvenc', label: 'NVIDIA GPU (NVENC)' },
										{ value: 'vaapi', label: 'Intel/AMD Linux (VAAPI)' },
										{ value: 'qsv', label: 'Intel Quick Sync (QSV)' },
										{ value: 'videotoolbox', label: 'macOS (VideoToolbox)' },
									]}
								/>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Encoding Preset</span>
									<span class={styles.settingDescription}>
										Slower presets produce better quality but take longer
									</span>
								</div>
								<Select
									value={encodingPreset}
									onChange={setEncodingPreset}
									options={[
										{ value: 'ultrafast', label: 'Ultra Fast' },
										{ value: 'superfast', label: 'Super Fast' },
										{ value: 'veryfast', label: 'Very Fast' },
										{ value: 'faster', label: 'Faster' },
										{ value: 'fast', label: 'Fast' },
										{ value: 'medium', label: 'Medium' },
										{ value: 'slow', label: 'Slow' },
									]}
								/>
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
								<Select
									value={encodeQuality}
									onChange={setEncodeQuality}
									options={[
										{ value: '480p', label: '480p' },
										{ value: '720p', label: '720p' },
										{ value: '1080p', label: '1080p' },
										{ value: '4k', label: '4K' },
									]}
								/>
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
								<Select
									value={rateControl}
									onChange={setRateControl}
									options={[
										{ value: 'cbr', label: 'Constant Bitrate (CBR)' },
										{ value: 'crf', label: 'Constant Quality (CRF)' },
									]}
								/>
							</div>

							{rateControl === 'crf' && (
								<div class={styles.settingRow}>
									<div class={styles.settingInfo}>
										<span class={styles.settingLabel}>CRF Value</span>
										<span class={styles.settingDescription}>
											Lower = better quality, bigger files. Each +1 ≈ 15%
											smaller. 18 ≈ visually lossless, 23 default, 28+ shows
											artifacts.
										</span>
									</div>
									<Select
										value={crfValue}
										onChange={setCrfValue}
										menuAlign="end"
										class={styles.crfSelect}
										options={[
											{ value: '17', label: '17' },
											{ value: '18', label: '18 — Near Lossless' },
											{ value: '19', label: '19' },
											{ value: '20', label: '20 — High Quality' },
											{ value: '21', label: '21' },
											{ value: '22', label: '22' },
											{ value: '23', label: '23 — Balanced (default)' },
											{ value: '24', label: '24' },
											{ value: '25', label: '25' },
											{ value: '26', label: '26 — Smaller Files' },
											{ value: '27', label: '27' },
											{ value: '28', label: '28 — Low Quality' },
											{ value: '29', label: '29' },
											{ value: '30', label: '30' },
										]}
									/>
								</div>
							)}

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Max Concurrent Jobs</span>
									<span class={styles.settingDescription}>
										Background encoding jobs that can run simultaneously
									</span>
								</div>
								<Select
									value={maxConcurrentJobs}
									onChange={setMaxConcurrentJobs}
									options={[
										{ value: '1', label: '1' },
										{ value: '2', label: '2' },
										{ value: '3', label: '3' },
										{ value: '4', label: '4' },
										{ value: '6', label: '6' },
										{ value: '8', label: '8' },
									]}
								/>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>HLS Segment Duration</span>
									<span class={styles.settingDescription}>
										Shorter segments reduce initial load time but increase
										overhead
									</span>
								</div>
								<Select
									value={segmentDuration}
									onChange={setSegmentDuration}
									options={[
										{ value: '2', label: '2s (Fast start)' },
										{ value: '4', label: '4s (Balanced)' },
										{ value: '6', label: '6s (Efficient)' },
										{ value: '10', label: '10s (Maximum efficiency)' },
									]}
								/>
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

							<h3 class={styles.sectionTitle}>Watch Tracking</h3>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Minimum Watch Time</span>
									<span class={styles.settingDescription}>
										Minimum cumulative play time before a resume position is
										recorded. Sub-threshold clicks (e.g. preview taps) don't
										clutter your history. Range: 4–1800 seconds.
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<input
										type="number"
										class={styles.select}
										min={4}
										max={1800}
										value={watchedThreshold}
										onInput={(e) => {
											const val = parseInt(
												(e.target as HTMLInputElement).value,
												10,
											);
											if (!Number.isNaN(val)) setWatchedThreshold(val);
										}}
										style={{ width: '80px' }}
									/>
									<span
										style={{
											fontSize: 'var(--font-size-sm)',
											color: 'var(--color-text-secondary)',
										}}
									>
										seconds
									</span>
								</div>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Completed Tail</span>
									<span class={styles.settingDescription}>
										Once playback is within this many seconds of a movie's end
										(i.e. during the credits), it's considered fully watched —
										history is cleared and the resume bar disappears. Default
										300s (5 minutes) covers most credit sequences. Range:
										0–3600 seconds.
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<input
										type="number"
										class={styles.select}
										min={0}
										max={3600}
										value={completedTail}
										onInput={(e) => {
											const val = parseInt(
												(e.target as HTMLInputElement).value,
												10,
											);
											if (!Number.isNaN(val)) setCompletedTail(val);
										}}
										style={{ width: '80px' }}
									/>
									<span
										style={{
											fontSize: 'var(--font-size-sm)',
											color: 'var(--color-text-secondary)',
										}}
									>
										seconds
									</span>
								</div>
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
					{activeTab === 'library' && isAdmin && (
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
								<Select
									value={scanInterval}
									disabled={!autoScanEnabled}
									onChange={setScanInterval}
									options={[
										{ value: '1', label: 'Every hour' },
										{ value: '3', label: 'Every 3 hours' },
										{ value: '6', label: 'Every 6 hours' },
										{ value: '12', label: 'Every 12 hours' },
										{ value: '24', label: 'Daily' },
									]}
								/>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Thumbnail Size</span>
									<span class={styles.settingDescription}>
										Seek-bar preview thumbnails.{' '}
										{(() => {
											const count = totalMovies.value;
											const est = estimateSpriteLibrarySize(count, thumbnailSize);
											return (
												<>
													~{est.perMovieLabel}/movie
													{count > 0
														? ` · ${est.totalLabel} for ${count.toLocaleString()} movies`
														: ''}
													.
												</>
											);
										})()}
									</span>
								</div>
								<Select
									value={thumbnailSize}
									onChange={(v) => setThumbnailSize(v as ThumbnailSize)}
									options={(
										[
											{ value: 'small' as ThumbnailSize, label: 'Small (120 × 68)' },
											{ value: 'medium' as ThumbnailSize, label: 'Medium (240 × 135)' },
											{ value: 'large' as ThumbnailSize, label: 'Large (360 × 203)' },
											{ value: 'xlarge' as ThumbnailSize, label: 'Extra Large (480 × 270)' },
										]
									).map((o) => ({
										value: o.value,
										label: `${o.label} · ~${estimateSpriteLibrarySize(0, o.value).perMovieLabel}/movie`,
									}))}
									style={{ minWidth: 320 }}
								/>
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
												<Icon name="settings" size={14} />
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
												{testingServer === server.id ? (
													'…'
												) : (
													<Icon name="refresh" size={14} />
												)}
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
												<Icon name="x" size={14} />
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
										<div class={styles.serverFieldsRow}>
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
					{activeTab === 'notifications' && <Notifications />}

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

					{/* Users Tab (admin only) */}
					{activeTab === 'users' && isAdmin && (
						<div class={styles.panel}>
							<Users />
						</div>
					)}

					{/* Connections Tab (admin only) */}
					{activeTab === 'connections' && isAdmin && (
						<div class={styles.panel}>
							<Connections />
						</div>
					)}

					{/* Matching Tab (admin only) */}
					{activeTab === 'matching' && isAdmin && (
						<div class={styles.panel}>
							<Matching />
						</div>
					)}

					{/* Jobs Tab (admin only) */}
					{activeTab === 'jobs' && isAdmin && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Jobs</h2>
							<JobsPanel />
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
					{activeTab === 'about' && <About />}
				</div>
			</div>

			<PluginSlot name={UI.SETTINGS_BOTTOM} context={{}} />
		</div>
	);
}
