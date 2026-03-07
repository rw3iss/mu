import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { theme, setTheme } from '@/state/theme.state';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import { api } from '@/services/api';
import type { Theme } from '@/state/theme.state';
import styles from './Settings.module.scss';

interface SettingsProps {
  path?: string;
}

type SettingsTab = 'general' | 'playback' | 'library' | 'notifications' | 'rating' | 'about';

export function Settings(_props: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // Playback settings
  const [defaultQuality, setDefaultQuality] = useState('auto');
  const [autoplay, setAutoplay] = useState(true);

  // Library settings
  const [scanInterval, setScanInterval] = useState('6');
  const [mediaPath, setMediaPath] = useState('');
  const [fetchExtendedMetadata, setFetchExtendedMetadata] = useState(true);

  // Rating settings
  const [ratingScale, setRatingScale] = useState('10');
  const [showExternalRatings, setShowExternalRatings] = useState(true);

  // Notification settings
  const [notifyScanResults, setNotifyScanResults] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await api.get<Record<string, unknown>>('/settings');

        const playback = data.playback as Record<string, unknown> | undefined;
        if (playback) {
          if (typeof playback.defaultQuality === 'string') setDefaultQuality(playback.defaultQuality);
          if (typeof playback.autoplay === 'boolean') setAutoplay(playback.autoplay);
        }

        const library = data.library as Record<string, unknown> | undefined;
        if (library) {
          if (typeof library.mediaPath === 'string') setMediaPath(library.mediaPath);
          if (library.scanIntervalHours != null) setScanInterval(String(library.scanIntervalHours));
          if (typeof library.fetchExtendedMetadata === 'boolean') setFetchExtendedMetadata(library.fetchExtendedMetadata);
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
        value: { defaultQuality, autoplay },
      });
      notifySuccess('Playback settings saved');
    } catch {
      notifyError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [defaultQuality, autoplay]);

  const handleSaveLibrary = useCallback(async () => {
    setIsSaving(true);
    try {
      await api.put('/settings/library', {
        value: {
          scanIntervalHours: parseInt(scanInterval, 10),
          mediaPath: mediaPath || undefined,
          fetchExtendedMetadata,
        },
      });
      notifySuccess('Library settings saved');
    } catch {
      notifyError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [scanInterval, mediaPath, fetchExtendedMetadata]);

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

  const handleScanNow = useCallback(async () => {
    try {
      await api.post('/sources/scan');
      notifySuccess('Library scan started');
    } catch {
      notifyError('Failed to start scan');
    }
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'playback', label: 'Playback' },
    { id: 'library', label: 'Library' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'rating', label: 'Rating' },
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
              onClick={() => setActiveTab(tab.id)}
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

              <div class={styles.settingRow}>
                <div class={styles.settingInfo}>
                  <span class={styles.settingLabel}>Media Path</span>
                  <span class={styles.settingDescription}>
                    Path to your movie files
                  </span>
                </div>
                <input
                  type="text"
                  class={styles.input}
                  value={mediaPath}
                  onInput={(e) => setMediaPath((e.target as HTMLInputElement).value)}
                  placeholder="/path/to/movies"
                />
              </div>

              <div class={styles.settingRow}>
                <div class={styles.settingInfo}>
                  <span class={styles.settingLabel}>Scan Interval</span>
                  <span class={styles.settingDescription}>
                    How often to check for new files (in hours)
                  </span>
                </div>
                <select
                  class={styles.select}
                  value={scanInterval}
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

              <div class={styles.actions}>
                <Button variant="secondary" onClick={handleScanNow}>
                  Scan Now
                </Button>
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

          {/* Rating Tab */}
          {activeTab === 'rating' && (
            <div class={styles.panel}>
              <h2 class={styles.panelTitle}>Rating</h2>

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
