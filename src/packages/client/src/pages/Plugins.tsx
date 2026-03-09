import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { Tabs } from '@/components/common/Tabs';
import {
  pluginsService,
  type PluginInfo,
  type PluginSettingDefinition,
  type PluginStatus,
} from '@/services/plugins.service';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import styles from './Plugins.module.scss';

// ============================================
// Types
// ============================================

interface SettingValue {
  definition: PluginSettingDefinition;
  value: unknown;
}

interface PluginsProps {
  path?: string;
}

const TABS = [
  { id: 'installed', label: 'Installed' },
  { id: 'marketplace', label: 'Marketplace' },
];

// ============================================
// Component
// ============================================

export function Plugins(_props: PluginsProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('installed');
  const [togglingName, setTogglingName] = useState<string | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<PluginInfo | null>(null);
  const [settingValues, setSettingValues] = useState<SettingValue[]>([]);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const loadPlugins = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await pluginsService.list();
      setPlugins(data);
    } catch (error) {
      console.error('Failed to load plugins:', error);
      notifyError('Failed to load plugins');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const handleToggle = useCallback(async (plugin: PluginInfo) => {
    setTogglingName(plugin.name);
    const action = plugin.enabled ? 'disable' : 'enable';
    try {
      if (plugin.enabled) {
        await pluginsService.disable(plugin.name);
      } else {
        await pluginsService.enable(plugin.name);
      }
      setPlugins((prev) =>
        prev.map((p) =>
          p.name === plugin.name
            ? {
                ...p,
                enabled: !p.enabled,
                loaded: !p.enabled,
                status: (!p.enabled ? 'enabled' : 'disabled') as PluginStatus,
              }
            : p
        )
      );
      notifySuccess(
        `${plugin.displayName || plugin.name} ${plugin.enabled ? 'disabled' : 'enabled'}`
      );
    } catch {
      notifyError(`Failed to ${action} ${plugin.displayName || plugin.name}`);
    } finally {
      setTogglingName(null);
    }
  }, []);

  const handleInstall = useCallback(async (plugin: PluginInfo) => {
    setTogglingName(plugin.name);
    try {
      await pluginsService.install(plugin.name);
      setPlugins((prev) =>
        prev.map((p) =>
          p.name === plugin.name
            ? { ...p, status: 'installed' as PluginStatus }
            : p
        )
      );
      notifySuccess(`${plugin.displayName || plugin.name} installed`);
    } catch {
      notifyError(`Failed to install ${plugin.displayName || plugin.name}`);
    } finally {
      setTogglingName(null);
    }
  }, []);

  const handleUninstall = useCallback(async (plugin: PluginInfo) => {
    setTogglingName(plugin.name);
    try {
      await pluginsService.uninstall(plugin.name);
      setPlugins((prev) =>
        prev.map((p) =>
          p.name === plugin.name
            ? { ...p, enabled: false, loaded: false, status: 'not_installed' as PluginStatus }
            : p
        )
      );
      notifySuccess(`${plugin.displayName || plugin.name} uninstalled`);
    } catch {
      notifyError(`Failed to uninstall ${plugin.displayName || plugin.name}`);
    } finally {
      setTogglingName(null);
    }
  }, []);

  const handleOpenSettings = useCallback(async (plugin: PluginInfo) => {
    setSettingsPlugin(plugin);
    setIsLoadingSettings(true);
    try {
      const data = await pluginsService.getSettings(plugin.name);
      const merged: SettingValue[] = (data.definitions || []).map((def) => ({
        definition: def,
        value: data.values[def.key] ?? def.default ?? (def.type === 'boolean' ? false : ''),
      }));
      setSettingValues(merged);
    } catch {
      notifyError('Failed to load plugin settings');
      setSettingsPlugin(null);
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsPlugin(null);
    setSettingValues([]);
  }, []);

  const handleSettingChange = useCallback(
    (key: string, value: unknown) => {
      setSettingValues((prev) =>
        prev.map((s) => (s.definition.key === key ? { ...s, value } : s))
      );
    },
    []
  );

  const handleSaveSettings = useCallback(async () => {
    if (!settingsPlugin) return;

    setIsSavingSettings(true);
    try {
      const settingsMap: Record<string, unknown> = {};
      for (const sv of settingValues) {
        settingsMap[sv.definition.key] = sv.value;
      }
      await pluginsService.updateSettings(settingsPlugin.name, settingsMap);
      notifySuccess('Plugin settings saved');
      handleCloseSettings();
    } catch {
      notifyError('Failed to save plugin settings');
    } finally {
      setIsSavingSettings(false);
    }
  }, [settingsPlugin, settingValues, handleCloseSettings]);

  function getStatusLabel(plugin: PluginInfo): string {
    return plugin.status || (plugin.enabled && plugin.loaded ? 'enabled' : 'disabled');
  }

  function getStatusClass(plugin: PluginInfo): string {
    switch (plugin.status) {
      case 'enabled':
        return styles.statusActive;
      case 'installed':
      case 'disabled':
        return styles.statusEnabled;
      case 'error':
        return styles.statusDisabled;
      default:
        if (plugin.enabled && plugin.loaded) return styles.statusActive;
        if (plugin.enabled) return styles.statusEnabled;
        return styles.statusDisabled;
    }
  }

  function hasConfigurableSettings(plugin: PluginInfo): boolean {
    return Array.isArray(plugin.settings) && plugin.settings.length > 0;
  }

  if (isLoading) {
    return (
      <div class={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div class={styles.plugins}>
      <div class={styles.header}>
        <h1 class={styles.title}>Plugins</h1>
        <span class={styles.subtitle}>
          Manage extensions for your Mu instance
        </span>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'installed' ? (
        plugins.length === 0 ? (
          <div class={styles.empty}>
            <p>No plugins installed</p>
          </div>
        ) : (
          <div class={styles.grid}>
            {plugins.map((plugin) => (
              <div key={plugin.name} class={styles.card}>
                <div class={styles.cardHeader}>
                  <div class={styles.cardTitleRow}>
                    <h3 class={styles.cardName}>
                      {plugin.displayName || plugin.name}
                    </h3>
                    <span class={styles.cardVersion}>v{plugin.version}</span>
                  </div>
                  <span
                    class={`${styles.statusBadge} ${getStatusClass(plugin)}`}
                  >
                    {getStatusLabel(plugin)}
                  </span>
                </div>

                {plugin.author && (
                  <span class={styles.cardAuthor}>by {plugin.author}</span>
                )}

                <p class={styles.cardDescription}>{plugin.description}</p>

                {plugin.permissions && plugin.permissions.length > 0 && (
                  <div class={styles.permissionList}>
                    {plugin.permissions.map((perm) => (
                      <span key={perm} class={styles.permissionBadge}>
                        {perm}
                      </span>
                    ))}
                  </div>
                )}

                <div class={styles.cardActions}>
                  {plugin.status === 'not_installed' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={togglingName === plugin.name}
                      onClick={() => handleInstall(plugin)}
                    >
                      Install
                    </Button>
                  ) : (
                    <>
                      <label class={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={plugin.enabled}
                          disabled={togglingName === plugin.name}
                          onChange={() => handleToggle(plugin)}
                        />
                        <span class={styles.toggleTrack} />
                      </label>
                      {hasConfigurableSettings(plugin) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenSettings(plugin)}
                        >
                          Settings
                        </Button>
                      )}
                      {!plugin.enabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={togglingName === plugin.name}
                          onClick={() => handleUninstall(plugin)}
                        >
                          Uninstall
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div class={styles.marketplace}>
          <EmptyState
            title="Marketplace"
            message="Plugin marketplace coming soon. Stay tuned!"
          />
        </div>
      )}

      {/* Plugin Settings Modal */}
      <Modal
        isOpen={!!settingsPlugin}
        onClose={handleCloseSettings}
        title={
          settingsPlugin
            ? `${settingsPlugin.displayName || settingsPlugin.name} Settings`
            : ''
        }
        size="md"
      >
        {isLoadingSettings ? (
          <div class={styles.settingsLoading}>
            <Spinner size="md" />
          </div>
        ) : settingValues.length === 0 ? (
          <div class={styles.settingsEmpty}>
            <p>No configurable settings for this plugin.</p>
          </div>
        ) : (
          <div class={styles.settingsForm}>
            {settingValues.map((sv) => (
              <div key={sv.definition.key} class={styles.settingRow}>
                <div class={styles.settingInfo}>
                  <span class={styles.settingLabel}>
                    {sv.definition.label}
                    {sv.definition.required && (
                      <span class={styles.requiredIndicator}> *</span>
                    )}
                  </span>
                  {sv.definition.description && (
                    <span class={styles.settingDescription}>
                      {sv.definition.description}
                    </span>
                  )}
                </div>
                <div class={styles.settingControl}>
                  {sv.definition.type === 'boolean' ? (
                    <label class={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={sv.value as boolean}
                        onChange={(e) =>
                          handleSettingChange(
                            sv.definition.key,
                            (e.target as HTMLInputElement).checked
                          )
                        }
                      />
                      <span class={styles.toggleTrack} />
                    </label>
                  ) : sv.definition.type === 'select' ? (
                    <select
                      value={sv.value as string}
                      onChange={(e) =>
                        handleSettingChange(
                          sv.definition.key,
                          (e.target as HTMLSelectElement).value
                        )
                      }
                      class={styles.settingInput}
                    >
                      {(sv.definition.options || []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : sv.definition.type === 'number' ? (
                    <input
                      type="number"
                      value={sv.value as number}
                      onInput={(e) =>
                        handleSettingChange(
                          sv.definition.key,
                          Number((e.target as HTMLInputElement).value)
                        )
                      }
                      class={styles.settingInput}
                    />
                  ) : (
                    <input
                      type="text"
                      value={sv.value as string}
                      onInput={(e) =>
                        handleSettingChange(
                          sv.definition.key,
                          (e.target as HTMLInputElement).value
                        )
                      }
                      class={styles.settingInput}
                    />
                  )}
                </div>
              </div>
            ))}

            <div class={styles.settingsActions}>
              <Button variant="ghost" onClick={handleCloseSettings}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={isSavingSettings}
                onClick={handleSaveSettings}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
