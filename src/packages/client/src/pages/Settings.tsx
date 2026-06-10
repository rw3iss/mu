import { DEFAULT_THUMBNAIL_SIZE, type ThemeConfig, type ThumbnailSize } from '@mu/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { FeedbackAdmin } from '@/components/admin/FeedbackAdmin';
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
import { totalMovies } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { fetchPlaybackSettings } from '@/state/playbackSettings.state';
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
import { estimateSpriteLibrarySize } from '@/utils/sprite-size-estimate';
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
	| 'encoding'
	| 'feedback'
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
	'encoding',
	'feedback',
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
	const [bufferSize, setBufferSizeSetting] = useUiSetting('buffer_size', 'large');
	const [skipTimes, setSkipTimes] = useUiSetting<number[]>('skip_times', [5, 10, 20]);

	// Library settings
	const [scanInterval, setScanInterval] = useState('6');
	const [mediaPathEntries, setMediaPathEntries] = useState<MediaPathEntryData[]>([]);
	const [fetchExtendedMetadata, setFetchExtendedMetadata] = useState(true);
	const [autoSanitizeTitles, setAutoSanitizeTitles] = useState(true);
	const [persistTranscodes, setPersistTranscodes] = useState(true);
	const [cacheDir, setCacheDir] = useState('');
	const [dbPath, setDbPath] = useState('');
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
	const [maxConcurrentIoJobs, setMaxConcurrentIoJobs] = useState('1');
	const [cpuParallelTranscode, setCpuParallelTranscode] = useState(false);
	const [maxCpuTranscodeJobs, setMaxCpuTranscodeJobs] = useState('1');
	const [segmentDuration, setSegmentDuration] = useState('4');
	const [useChunkedTranscoding, setUseChunkedTranscoding] = useState(false);
	const [debugTranscoding, setDebugTranscoding] = useState(false);
	// Direct-play MP4 conversion (default on)
	const [autoConvertToMp4, setAutoConvertToMp4] = useState(true);
	const [convertOriginalFile, setConvertOriginalFile] = useState(true);
	const [conversionGrowthThreshold, setConversionGrowthThreshold] = useState('1.25');
	const [convertHevcToAv1, setConvertHevcToAv1] = useState(false);
	const [av1Cq, setAv1Cq] = useState('32');
	// Shrink oversized H.264 files: re-encode any whose bitrate exceeds this many
	// Mbps. 0 = off.
	const [reencodeAboveMbps, setReencodeAboveMbps] = useState('0');
	const [memoryCacheMaxGb, setMemoryCacheMaxGb] = useState('0');
	const [memCacheStatus, setMemCacheStatus] = useState<{
		vmtouch: boolean;
		usedBytes: number;
		fileCount: number;
		systemTotalBytes: number;
		systemFreeBytes: number;
	} | null>(null);
	// Scheduled, time-boxed library conversion sweep (admin).
	const [convertSweepEnabled, setConvertSweepEnabled] = useState(false);
	const [convertSweepStartTime, setConvertSweepStartTime] = useState('02:00');
	const [convertSweepDurationHours, setConvertSweepDurationHours] = useState('4');
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

	// In-RAM file-cache status + system memory (for the Encoding tab control).
	useEffect(() => {
		if (activeTab !== 'encoding') return;
		let cancelled = false;
		api.get<typeof memCacheStatus>('/stream/memory-cache/status')
			.then((s) => {
				if (!cancelled) setMemCacheStatus(s);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [activeTab, memoryCacheMaxGb]);

	const handleTabChange = useCallback((tab: SettingsTab) => {
		setActiveTab(tab);
		const url = tab === 'general' ? '/settings' : `/settings/${tab}`;
		route(url, true);
	}, []);

	useEffect(() => {
		async function loadSettings() {
			// Per-user playback preferences (general + watch tracking) — available
			// to every role, loaded from the current user's own settings (not global).
			try {
				const pb = await api.get<Record<string, unknown>>('/settings/playback');
				if (pb) {
					if (typeof pb.defaultQuality === 'string') setDefaultQuality(pb.defaultQuality);
					if (typeof pb.preferredAudioLanguage === 'string')
						setPreferredAudioLanguage(pb.preferredAudioLanguage);
					if (typeof pb.autoplay === 'boolean') setAutoplay(pb.autoplay);
					if (typeof pb.bufferSize === 'string') setBufferSizeSetting(pb.bufferSize);
					if (Array.isArray(pb.skipTimes) && pb.skipTimes.length === 3)
						setSkipTimes(pb.skipTimes as number[]);
					if (typeof pb.watchedThresholdSeconds === 'number')
						setWatchedThreshold(pb.watchedThresholdSeconds);
					if (typeof pb.completedTailSeconds === 'number')
						setCompletedTail(pb.completedTailSeconds);
				}
			} catch {
				// keep defaults
			}

			try {
				const data = await api.get<Record<string, unknown>>('/settings');

				// Resolved SQLite file the server is using (read-only display).
				api.get<{ dbPath?: string }>('/admin/server/info')
					.then((info) => {
						if (info?.dbPath) setDbPath(info.dbPath);
					})
					.catch(() => {});

				const library = data.library as Record<string, unknown> | undefined;
				if (library) {
					if (library.scanIntervalHours != null)
						setScanInterval(String(library.scanIntervalHours));
					if (typeof library.fetchExtendedMetadata === 'boolean')
						setFetchExtendedMetadata(library.fetchExtendedMetadata);
					if (typeof library.autoSanitizeTitles === 'boolean')
						setAutoSanitizeTitles(library.autoSanitizeTitles);
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
					if (encoding.maxConcurrentIoJobs != null)
						setMaxConcurrentIoJobs(String(encoding.maxConcurrentIoJobs));
					if (encoding.cpuParallelTranscode != null)
						setCpuParallelTranscode(!!encoding.cpuParallelTranscode);
					if (encoding.maxCpuTranscodeJobs != null)
						setMaxCpuTranscodeJobs(String(encoding.maxCpuTranscodeJobs));
					if (encoding.segmentDuration != null)
						setSegmentDuration(String(encoding.segmentDuration));
					if (encoding.useChunkedTranscoding != null)
						setUseChunkedTranscoding(!!encoding.useChunkedTranscoding);
					if (encoding.debugTranscoding != null)
						setDebugTranscoding(!!encoding.debugTranscoding);
					// Default ON when the key is absent (existing installs).
					if (typeof encoding.autoConvertToMp4 === 'boolean')
						setAutoConvertToMp4(encoding.autoConvertToMp4);
					if (typeof encoding.convertOriginalFile === 'boolean')
						setConvertOriginalFile(encoding.convertOriginalFile);
					if (encoding.conversionGrowthThreshold != null)
						setConversionGrowthThreshold(String(encoding.conversionGrowthThreshold));
					if (typeof encoding.convertHevcToAv1 === 'boolean')
						setConvertHevcToAv1(encoding.convertHevcToAv1);
					if (encoding.av1Cq != null) setAv1Cq(String(encoding.av1Cq));
					if (encoding.reencodeAboveMbps != null)
						setReencodeAboveMbps(String(encoding.reencodeAboveMbps));
					if (encoding.memoryCacheMaxGb != null)
						setMemoryCacheMaxGb(String(encoding.memoryCacheMaxGb));
					const sweep = encoding.convertSweep as Record<string, unknown> | undefined;
					if (sweep) {
						if (typeof sweep.enabled === 'boolean')
							setConvertSweepEnabled(sweep.enabled);
						if (typeof sweep.startTime === 'string')
							setConvertSweepStartTime(sweep.startTime);
						if (sweep.durationHours != null)
							setConvertSweepDurationHours(String(sweep.durationHours));
					}
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

				// (Watch-tracking thresholds load with the per-user playback blob above.)
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

	// Playback + watch-tracking are PER-USER (saved to the current user's
	// settings, not global) — one blob via PUT /settings/playback.
	const handleSavePlayback = useCallback(async () => {
		setIsSaving(true);
		try {
			await api.put('/settings/playback', {
				value: {
					defaultQuality,
					preferredAudioLanguage,
					autoplay,
					bufferSize,
					skipTimes,
					watchedThresholdSeconds: Math.max(4, Math.min(1800, watchedThreshold)),
					completedTailSeconds: Math.max(0, Math.min(3600, completedTail)),
				},
			});
			setBufferSizeSetting(bufferSize);
			setSkipTimes(skipTimes);
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
		watchedThreshold,
		completedTail,
	]);

	// Encoding settings are GLOBAL and admin-only (PUT /settings/encoding).
	const handleSaveEncoding = useCallback(async () => {
		setIsSaving(true);
		try {
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
					maxConcurrentIoJobs: parseInt(maxConcurrentIoJobs, 10),
					cpuParallelTranscode,
					maxCpuTranscodeJobs: parseInt(maxCpuTranscodeJobs, 10) || 1,
					segmentDuration: parseInt(segmentDuration, 10),
					useChunkedTranscoding,
					debugTranscoding,
					autoConvertToMp4,
					convertOriginalFile,
					conversionGrowthThreshold: parseFloat(conversionGrowthThreshold) || 1.25,
					convertHevcToAv1,
					av1Cq: parseInt(av1Cq, 10) || 32,
					reencodeAboveMbps: parseFloat(reencodeAboveMbps) || 0,
					memoryCacheMaxGb: parseFloat(memoryCacheMaxGb) || 0,
					convertSweep: {
						enabled: convertSweepEnabled,
						startTime: convertSweepStartTime,
						durationHours: parseFloat(convertSweepDurationHours) || 4,
					},
				},
			});
			notifySuccess('Encoding settings saved');
		} catch {
			notifyError('Failed to save encoding settings');
		} finally {
			setIsSaving(false);
		}
	}, [
		hwAccel,
		encodingPreset,
		encodeQuality,
		encodeHighestAvailable,
		streamHighestAvailable,
		rateControl,
		crfValue,
		maxConcurrentJobs,
		maxConcurrentIoJobs,
		cpuParallelTranscode,
		maxCpuTranscodeJobs,
		segmentDuration,
		useChunkedTranscoding,
		debugTranscoding,
		autoConvertToMp4,
		convertOriginalFile,
		conversionGrowthThreshold,
		convertHevcToAv1,
		av1Cq,
		reencodeAboveMbps,
		memoryCacheMaxGb,
		convertSweepEnabled,
		convertSweepStartTime,
		convertSweepDurationHours,
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
					autoSanitizeTitles,
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
		autoSanitizeTitles,
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
					{ id: 'encoding' as SettingsTab, label: 'Encoding' },
					{ id: 'feedback' as SettingsTab, label: 'Feedback' },
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

											<div class={styles.themeGroupHeader}>Backgrounds</div>
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

											{/* Button Background */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Button Background
													</span>
													<span class={styles.settingDescription}>
														Filled / primary button background color
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.buttonBg ||
															editConfig.accentColor ||
															'#06b6d4'
														}
														onChange={(v) =>
															updateEditConfig({ buttonBg: v })
														}
													/>
												</div>
											</div>
											<div class={styles.themeGroupHeader}>Text</div>
											{/* Section Label */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Section Label
													</span>
													<span class={styles.settingDescription}>
														Field labels and section headings
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.labelColor ||
															editConfig.tokens?.[
																'color-text-primary'
															] ||
															'#d8dee9'
														}
														onChange={(v) =>
															updateEditConfig({ labelColor: v })
														}
													/>
												</div>
											</div>

											{/* Body Text */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Body Text
													</span>
													<span class={styles.settingDescription}>
														General page, card, and movie-detail text
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.textColor ||
															editConfig.tokens?.[
																'color-text-primary'
															] ||
															'#d8dee9'
														}
														onChange={(v) =>
															updateEditConfig({ textColor: v })
														}
													/>
												</div>
											</div>

											{/* Button Text */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Button Text
													</span>
													<span class={styles.settingDescription}>
														Text on filled buttons
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.buttonText ||
															editConfig.tokens?.[
																'color-text-inverse'
															] ||
															'#050709'
														}
														onChange={(v) =>
															updateEditConfig({ buttonText: v })
														}
													/>
												</div>
											</div>

											<div class={styles.themeGroupHeader}>Items</div>
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

											<div class={styles.themeGroupHeader}>Hover</div>
											{/* Hover Background */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Hover Background
													</span>
													<span class={styles.settingDescription}>
														Highlight behind rows, section headers, and
														sidebar/menu items on hover
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.hoverBg ||
															editConfig.panelBg ||
															'#161b27'
														}
														onChange={(v) =>
															updateEditConfig({ hoverBg: v })
														}
													/>
												</div>
											</div>

											{/* Hover Text */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Hover Text
													</span>
													<span class={styles.settingDescription}>
														Text colour of hovered rows / items
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.hoverText ||
															editConfig.tokens?.[
																'color-text-primary'
															] ||
															'#d8dee9'
														}
														onChange={(v) =>
															updateEditConfig({ hoverText: v })
														}
													/>
												</div>
											</div>

											<div class={styles.themeGroupHeader}>Inputs</div>
											{/* Input Background */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Input Background
													</span>
													<span class={styles.settingDescription}>
														Text field, search, and dropdown background
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.inputBg ||
															editConfig.tokens?.[
																'color-bg-elevated'
															] ||
															'#10141e'
														}
														onChange={(v) =>
															updateEditConfig({ inputBg: v })
														}
													/>
												</div>
											</div>

											{/* Input Text */}
											<div class={styles.settingRow}>
												<div class={styles.settingInfo}>
													<span class={styles.settingLabel}>
														Input Text
													</span>
													<span class={styles.settingDescription}>
														Text inside input / search fields
													</span>
												</div>
												<div class={styles.settingControl}>
													<ColorPicker
														value={
															editConfig.inputText ||
															editConfig.tokens?.[
																'color-text-primary'
															] ||
															'#d8dee9'
														}
														onChange={(v) =>
															updateEditConfig({ inputText: v })
														}
													/>
												</div>
											</div>

											<div class={styles.themeGroupHeader}>Text Size</div>
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
										stability on slow connections or a busy media drive.
									</span>
								</div>
								<Select
									value={bufferSize}
									onChange={setBufferSizeSetting}
									options={[
										{ value: 'small', label: 'Small (20s)' },
										{ value: 'normal', label: 'Normal (45s)' },
										{ value: 'large', label: 'Large (90s)' },
										{ value: 'max', label: 'Maximum (180s)' },
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
										300s (5 minutes) covers most credit sequences. Range: 0–3600
										seconds.
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

					{/* Encoding Tab (admin only) */}
					{activeTab === 'encoding' && isAdmin && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Encoding</h2>
							<p class={styles.settingDescription}>
								Global transcoding settings — apply to all users (admin only).
							</p>

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
											{
												value: '18',
												label: '18',
												description: 'Near Lossless',
											},
											{ value: '19', label: '19' },
											{
												value: '20',
												label: '20',
												description: 'High Quality',
											},
											{ value: '21', label: '21' },
											{ value: '22', label: '22' },
											{
												value: '23',
												label: '23',
												description: 'Balanced (default)',
											},
											{ value: '24', label: '24' },
											{ value: '25', label: '25' },
											{
												value: '26',
												label: '26',
												description: 'Smaller Files',
											},
											{ value: '27', label: '27' },
											{
												value: '28',
												label: '28',
												description: 'Low Quality',
											},
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
										Total background jobs (metadata, scans, encoding, sprites)
										that can run at once
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
									<span class={styles.settingLabel}>
										Max Concurrent Disk-Heavy Jobs
									</span>
									<span class={styles.settingDescription}>
										How many whole-file jobs (sprite previews, transcoding, MP4
										conversion) read a movie off disk at once. Keep at 1 on a
										single HDD so new-movie processing doesn’t starve playback.
									</span>
								</div>
								<Select
									value={maxConcurrentIoJobs}
									onChange={setMaxConcurrentIoJobs}
									options={[
										{ value: '1', label: '1 (Serialize — recommended)' },
										{ value: '2', label: '2' },
										{ value: '3', label: '3' },
										{ value: '4', label: '4' },
									]}
								/>
							</div>

							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Transcode with both CPU and GPU
									</span>
									<span class={styles.settingDescription}>
										Transcode/convert jobs use the GPU (if configured) by
										default. With this on, extra queued jobs run on the CPU in
										parallel while the GPU is busy, finishing the backlog
										faster. GPU encodes are much faster with slightly larger
										files; CPU encodes are slower but typically a touch
										smaller/higher quality at the same setting. Sources are
										pre-warmed into RAM, so parallel jobs don't thrash the disk.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={cpuParallelTranscode}
										onChange={(e) =>
											setCpuParallelTranscode(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{cpuParallelTranscode && (
								<div class={styles.settingRow}>
									<div class={styles.settingInfo}>
										<span class={styles.settingLabel}>Maximum CPU Jobs</span>
										<span class={styles.settingDescription}>
											How many extra encode jobs may run on the CPU while the
											GPU is busy. Each CPU encode uses most of the machine's
											cores — keep low on a shared box.
										</span>
									</div>
									<Select
										value={maxCpuTranscodeJobs}
										onChange={setMaxCpuTranscodeJobs}
										options={[
											{ value: '1', label: '1 (recommended)' },
											{ value: '2', label: '2' },
											{ value: '3', label: '3' },
										]}
									/>
								</div>
							)}

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

							<h3 class={styles.sectionTitle}>Direct-Play Conversion</h3>

							{/* Auto-convert to MP4 */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Auto-convert to MP4</span>
									<span class={styles.settingDescription}>
										When a movie needs transcoding, convert it to a native
										direct-play MP4 instead of building an HLS cache. H.264
										files are remuxed losslessly; other codecs are re-encoded
										(cases predicted to grow the file are skipped and stay on
										on-demand HLS). Direct play also re-enables EQ/Compressor
										audio effects.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={autoConvertToMp4}
										onChange={(e) =>
											setAutoConvertToMp4(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{/* Convert Original File (in-place, destructive) */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Convert Original File</span>
									<span class={styles.settingDescription}>
										Replace the original file on disk with the converted MP4
										(new file is verified first, then the original is deleted
										and the movie record repointed). Keeps the library slim and
										makes every converted title direct-play natively.{' '}
										<strong>Irreversible — originals are removed.</strong> When
										off, a cached copy is used and originals are kept.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={convertOriginalFile}
										onChange={(e) =>
											setConvertOriginalFile(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{/* Growth guard */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Re-encode Growth Limit</span>
									<span class={styles.settingDescription}>
										Safety guard, not a trigger: skip a re-encode when the
										estimated MP4 would exceed the original size × this factor,
										so already-efficient HEVC/AV1 files aren't bloated. 1.0 =
										never grow; 1.25 = allow up to 25% larger (default). To
										actively shrink large files, use “Shrink Files Above” below.
									</span>
								</div>
								<input
									type="number"
									class={styles.select}
									min={1}
									max={3}
									step={0.05}
									value={conversionGrowthThreshold}
									onInput={(e) =>
										setConversionGrowthThreshold(
											(e.target as HTMLInputElement).value,
										)
									}
									style={{ width: '80px' }}
								/>
							</div>

							{/* Shrink oversized files */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Shrink Files Above</span>
									<span class={styles.settingDescription}>
										Re-encode any file whose overall bitrate exceeds this many
										Mbps to shrink it — including already-playable H.264 (which
										is otherwise copied verbatim, so a 22 Mbps BluRay rip stays
										huge). Uses AV1 on the GPU when available, else H.264 CRF.
										Only proceeds when it would actually get smaller. 0 = off;
										~12 is a good ceiling for 1080p.
									</span>
								</div>
								<input
									type="number"
									class={styles.select}
									min={0}
									max={100}
									step={1}
									value={reencodeAboveMbps}
									onInput={(e) =>
										setReencodeAboveMbps((e.target as HTMLInputElement).value)
									}
									style={{ width: '80px' }}
								/>
							</div>

							{/* In-RAM file cache (page-cache residency) */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Maximum Cache Memory (GB)
									</span>
									<span class={styles.settingDescription}>
										Keep recently played / processed movie files resident in RAM
										(the OS page cache) up to this many GB, evicting the oldest
										first — so re-watching, sprite generation, and conversions
										read from memory instead of the disk. 0 = off (rely on the
										OS default).
										{memCacheStatus && (
											<>
												{' '}
												System memory:{' '}
												<strong>
													{(
														memCacheStatus.systemTotalBytes /
														1024 ** 3
													).toFixed(1)}{' '}
													GB
												</strong>{' '}
												total,{' '}
												{(
													memCacheStatus.systemFreeBytes /
													1024 ** 3
												).toFixed(1)}{' '}
												GB free. In cache:{' '}
												{(memCacheStatus.usedBytes / 1024 ** 3).toFixed(2)}{' '}
												GB across {memCacheStatus.fileCount} file(s).
												{!memCacheStatus.vmtouch &&
													' (vmtouch not installed — warm-only, OS handles eviction.)'}
											</>
										)}
									</span>
								</div>
								<input
									type="number"
									class={styles.select}
									min={0}
									max={
										memCacheStatus
											? Math.floor(
													memCacheStatus.systemTotalBytes / 1024 ** 3,
												)
											: 256
									}
									step={1}
									value={memoryCacheMaxGb}
									onInput={(e) =>
										setMemoryCacheMaxGb((e.target as HTMLInputElement).value)
									}
									style={{ width: '80px' }}
								/>
							</div>

							{/* Convert HEVC to AV1 (GPU) */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Convert HEVC to AV1 (GPU)
									</span>
									<span class={styles.settingDescription}>
										HEVC/H.265 movies can't play in most browsers. When a
										working GPU AV1 encoder (NVENC) is available, convert them
										to AV1 MP4 in place instead of building an H.264 cache. AV1
										plays in all modern browsers and stays ~the same size as
										HEVC (no doubling like H.264). Roughly 5–10 min per episode
										/ 10–25 min per movie on the GPU. Requires Hardware
										Acceleration = NVIDIA (NVENC) on an interactive-session GPU;
										otherwise HEVC still transcodes to H.264 as before.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={convertHevcToAv1}
										onChange={(e) =>
											setConvertHevcToAv1(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{/* AV1 quality (CQ) */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>AV1 Quality (CQ)</span>
									<span class={styles.settingDescription}>
										AV1 NVENC constant-quality (0–63; lower = better and
										larger). ~28 high quality, 32 balanced (default), 38
										smaller.
									</span>
								</div>
								<input
									type="number"
									class={styles.select}
									min={18}
									max={50}
									step={1}
									value={av1Cq}
									onInput={(e) => setAv1Cq((e.target as HTMLInputElement).value)}
									style={{ width: '80px' }}
								/>
							</div>

							{/* Scheduled conversion sweep */}
							<div class={styles.settingRow}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>
										Scheduled Conversion Window
									</span>
									<span class={styles.settingDescription}>
										Run the library-wide MP4/AV1 conversion only inside a
										nightly window instead of 24/7, so it doesn't saturate the
										media drive while people are watching. Pending jobs are
										cancelled when the window closes.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={convertSweepEnabled}
										onChange={(e) =>
											setConvertSweepEnabled(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
							</div>

							{convertSweepEnabled && (
								<>
									<div class={styles.settingRow}>
										<div class={styles.settingInfo}>
											<span class={styles.settingLabel}>Start Time</span>
											<span class={styles.settingDescription}>
												Local time of day the conversion window opens.
											</span>
										</div>
										<input
											type="time"
											class={styles.select}
											value={convertSweepStartTime}
											onInput={(e) =>
												setConvertSweepStartTime(
													(e.target as HTMLInputElement).value,
												)
											}
											style={{ width: '120px' }}
										/>
									</div>

									<div class={styles.settingRow}>
										<div class={styles.settingInfo}>
											<span class={styles.settingLabel}>
												Duration (hours)
											</span>
											<span class={styles.settingDescription}>
												How long the window stays open before remaining
												conversions are cancelled until the next night.
											</span>
										</div>
										<input
											type="number"
											class={styles.select}
											min={1}
											max={12}
											step={0.5}
											value={convertSweepDurationHours}
											onInput={(e) =>
												setConvertSweepDurationHours(
													(e.target as HTMLInputElement).value,
												)
											}
											style={{ width: '80px' }}
										/>
									</div>
								</>
							)}

							<div class={styles.actions}>
								<Button
									variant="primary"
									loading={isSaving}
									onClick={handleSaveEncoding}
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

							<div class={styles.settingGroup}>
								<div class={styles.settingInfo}>
									<span class={styles.settingLabel}>Database File</span>
									<span class={styles.settingDescription}>
										SQLite database the server is currently using (set via{' '}
										<code>MU_DATABASE_SQLITE_PATH</code> /{' '}
										<code>MU_DATA_DIR</code> in the environment). Read-only.
									</span>
								</div>
								<input
									class={styles.input}
									type="text"
									value={dbPath}
									readOnly
									spellcheck={false}
									onFocus={(e) => (e.target as HTMLInputElement).select()}
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
									title="Re-encode existing movies whose cached transcode doesn't match the current Encoding settings (Settings → Encoding)"
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
									<span class={styles.settingLabel}>
										Automatically Sanitize Titles
									</span>
									<span class={styles.settingDescription}>
										Run the "Sanitize Title" routine on newly scanned movies —
										clean the title from the filename (strip quality tags,
										release groups, junk) before metadata is fetched.
									</span>
								</div>
								<label class={styles.toggle}>
									<input
										type="checkbox"
										checked={autoSanitizeTitles}
										onChange={(e) =>
											setAutoSanitizeTitles(
												(e.target as HTMLInputElement).checked,
											)
										}
									/>
									<span class={styles.toggleTrack} />
								</label>
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
									<span class={styles.settingLabel}>Thumbnail Size</span>
									<span class={styles.settingDescription}>
										Seek-bar preview thumbnails. {(() => {
											const count = totalMovies.value;
											const est = estimateSpriteLibrarySize(
												count,
												thumbnailSize,
											);
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
									options={[
										{
											value: 'small' as ThumbnailSize,
											label: 'Small (120 × 68)',
										},
										{
											value: 'medium' as ThumbnailSize,
											label: 'Medium (240 × 135)',
										},
										{
											value: 'large' as ThumbnailSize,
											label: 'Large (360 × 203)',
										},
										{
											value: 'xlarge' as ThumbnailSize,
											label: 'Extra Large (480 × 270)',
										},
									].map((o) => ({
										value: o.value,
										label: `${o.label} · ~${estimateSpriteLibrarySize(0, o.value).perMovieLabel}/movie`,
									}))}
									style={{ minWidth: 320 }}
								/>
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

					{/* Feedback Tab (admin only) */}
					{activeTab === 'feedback' && isAdmin && (
						<div class={styles.panel}>
							<h2 class={styles.panelTitle}>Feedback</h2>
							<FeedbackAdmin />
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
