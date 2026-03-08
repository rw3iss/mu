import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { MediaPathList } from '@/components/library/MediaPathList';
import type { MediaPathEntryData } from '@/components/library/MediaPathList';
import { theme, setTheme } from '@/state/theme.state';
import { currentUser } from '@/state/auth.state';
import { useUiSetting } from '@/hooks/useUiSetting';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import { api } from '@/services/api';
import { sourcesService } from '@/services/sources.service';
import { Plugins } from './Plugins';
import { AdminDashboard } from './AdminDashboard';
import type { Theme } from '@/state/theme.state';
import styles from './Settings.module.scss';

interface SettingsProps {
  path?: string;
  tab?: string;
}

type SettingsTab = 'general' | 'playback' | 'library' | 'notifications' | 'plugins' | 'admin' | 'about';

const VALID_TABS: SettingsTab[] = ['general', 'playback', 'library', 'notifications', 'plugins', 'admin', 'about'];

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
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

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

  // Rating settings
  const [ratingScale, setRatingScale] = useState('10');
  const [showExternalRatings, setShowExternalRatings] = useState(true);

  // Notification settings
  const [notifyScanResults, setNotifyScanResults] = useState(true);

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
          if (typeof playback.defaultQuality === 'string') setDefaultQuality(playback.defaultQuality);
          if (typeof playback.autoplay === 'boolean') setAutoplay(playback.autoplay);
          if (typeof playback.bufferSize === 'string') {
            setBufferSizeSetting(playback.bufferSize);
          }
        }

        const library = data.library as Record<string, unknown> | undefined;
        if (library) {
          if (library.scanIntervalHours != null) setScanInterval(String(library.scanIntervalHours));
          if (typeof library.fetchExtendedMetadata === 'boolean') setFetchExtendedMetadata(library.fetchExtendedMetadata);
          if (typeof library.persistTranscodes === 'boolean') setPersistTranscodes(library.persistTranscodes);
          if (typeof library.autoScanEnabled === 'boolean') setAutoScanEnabled(library.autoScanEnabled);
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
          if (typeof rating.showExternalRatings === 'boolean') setShowExternalRatings(rating.showExternalRatings);
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
      const validPaths = mediaPathEntries
        .map((e) => e.path.trim())
        .filter(Boolean);
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

      // Refresh the auto-scan schedule on the server
      const scanStatus = await sourcesService.refreshSchedule();
      setNextScanAt(scanStatus.nextScanAt);

      notifySuccess('Library settings saved');
    } catch {
      notifyError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [scanInterval, mediaPathEntries, fetchExtendedMetadata, persistTranscodes, autoScanEnabled]);

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
      }>('/sources/scan');
      setScanResult(result);
      if (result.filesAdded > 0) {
        notifySuccess(`Scan complete: ${result.filesAdded} new movie${result.filesAdded === 1 ? '' : 's'} added`);
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
    { id: 'library', label: 'Library' },
    { id: 'notifications', label: 'Notifications' },
    ...(isAdmin ? [
      { id: 'plugins' as SettingsTab, label: 'Plugins' },
      { id: 'admin' as SettingsTab, label: 'Admin' },
    ] : []),
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
                  onChange={(e) => setRatingScale((e.target as HTMLSelectElement).value)}
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
                    onChange={(e) => setShowExternalRatings((e.target as HTMLInputElement).checked)}
                  />
                  <span class={styles.toggleTrack} />
                </label>
              </div>

              <div class={styles.actions}>
                <Button variant="primary" loading={isSaving} onClick={handleSaveRating}>
                  Save Changes
                </Button>
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
                  onChange={(e) => setDefaultQuality((e.target as HTMLSelectElement).value)}
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
                    onChange={(e) => setAutoplay((e.target as HTMLInputElement).checked)}
                  />
                  <span class={styles.toggleTrack} />
                </label>
              </div>

              <div class={styles.settingRow}>
                <div class={styles.settingInfo}>
                  <span class={styles.settingLabel}>Buffer Size</span>
                  <span class={styles.settingDescription}>
                    Amount of video to pre-load. Larger buffers improve stability on slow connections.
                  </span>
                </div>
                <select
                  class={styles.select}
                  value={bufferSize}
                  onChange={(e) => setBufferSizeSetting((e.target as HTMLSelectElement).value)}
                >
                  <option value="small">Small (10s)</option>
                  <option value="normal">Normal (30s)</option>
                  <option value="large">Large (60s)</option>
                  <option value="max">Maximum (120s)</option>
                </select>
              </div>

              <div class={styles.actions}>
                <Button variant="primary" loading={isSaving} onClick={handleSavePlayback}>
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
                    onChange={(e) => setAutoScanEnabled((e.target as HTMLInputElement).checked)}
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
                      <span class={styles.nextScan}> &middot; Next scan in {nextScanText}</span>
                    )}
                  </span>
                </div>
                <select
                  class={styles.select}
                  value={scanInterval}
                  disabled={!autoScanEnabled}
                  onChange={(e) => setScanInterval((e.target as HTMLSelectElement).value)}
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
                  <span class={styles.settingLabel}>Download Extended Metadata</span>
                  <span class={styles.settingDescription}>
                    Fetch ratings and reviews from third-party sources (IMDB, Rotten Tomatoes) when a new movie is scanned
                  </span>
                </div>
                <label class={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={fetchExtendedMetadata}
                    onChange={(e) => setFetchExtendedMetadata((e.target as HTMLInputElement).checked)}
                  />
                  <span class={styles.toggleTrack} />
                </label>
              </div>

              <div class={styles.settingRow}>
                <div class={styles.settingInfo}>
                  <span class={styles.settingLabel}>Cache Transcoded Files</span>
                  <span class={styles.settingDescription}>
                    Keep transcoded files on disk so they don't need to be re-transcoded on subsequent plays
                  </span>
                </div>
                <label class={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={persistTranscodes}
                    onChange={(e) => setPersistTranscodes((e.target as HTMLInputElement).checked)}
                  />
                  <span class={styles.toggleTrack} />
                </label>
              </div>

              <div class={styles.scanSection}>
                <Button variant="secondary" loading={isScanning} onClick={handleScanNow}>
                  {isScanning ? 'Scanning...' : 'Scan Now'}
                </Button>
                {scanResult && (
                  <div class={styles.scanResult}>
                    <span class={styles.scanStat}>
                      {scanResult.filesFound} file{scanResult.filesFound === 1 ? '' : 's'} found
                    </span>
                    {scanResult.filesAdded > 0 && (
                      <span class={styles.scanStatHighlight}>
                        {scanResult.filesAdded} new movie{scanResult.filesAdded === 1 ? '' : 's'} imported
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
                    {scanResult.filesAdded === 0 && scanResult.filesUpdated === 0 && scanResult.filesRemoved === 0 && (
                      <span class={styles.scanStat}>Library is up to date</span>
                    )}
                  </div>
                )}
              </div>

              <div class={styles.actions}>
                <Button variant="primary" loading={isSaving} onClick={handleSaveLibrary}>
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
                Mu is a self-hosted movie streaming platform that lets you
                organize, browse, and stream your personal movie collection
                from anywhere.
              </p>

              <h3 class={styles.aboutSectionTitle}>Developer</h3>
              <div class={styles.developerLinks}>
                <a href="https://www.ryanweiss.net" target="_blank" rel="noopener noreferrer" class={styles.developerLink}>
                  Ryan Weiss
                </a>
                <a href="https://github.com/rw3iss/mu" target="_blank" rel="noopener noreferrer" class={styles.developerLink}>
                  Project Website
                </a>
                <a href="/changelog" class={styles.developerLink} onClick={(e) => { e.preventDefault(); route('/changelog'); }}>
                  Recent Changes
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
