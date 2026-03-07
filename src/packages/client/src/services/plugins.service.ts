import { api } from './api';

// ============================================
// Types
// ============================================

export type PluginPermission =
  | 'read:movies'
  | 'write:metadata'
  | 'network'
  | 'cache'
  | 'events';

export interface PluginSettingDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  options?: { label: string; value: string }[];
  required?: boolean;
}

export interface PluginInfo {
  name: string;
  displayName?: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  loaded: boolean;
  permissions: PluginPermission[];
  settings?: PluginSettingDefinition[];
}

export interface PluginSettingsResponse {
  name: string;
  definitions: PluginSettingDefinition[];
  values: Record<string, unknown>;
}

// ============================================
// Plugins Service
// ============================================

export const pluginsService = {
  /**
   * List all discovered plugins with status.
   */
  list(): Promise<PluginInfo[]> {
    return api.get<PluginInfo[]>('/plugins');
  },

  /**
   * Get details for a single plugin by name.
   */
  get(name: string): Promise<PluginInfo> {
    return api.get<PluginInfo>(`/plugins/${name}`);
  },

  /**
   * Enable a plugin.
   */
  enable(name: string): Promise<void> {
    return api.post<void>(`/plugins/${name}/enable`);
  },

  /**
   * Disable a plugin.
   */
  disable(name: string): Promise<void> {
    return api.post<void>(`/plugins/${name}/disable`);
  },

  /**
   * Get the setting definitions and current values for a plugin.
   */
  getSettings(name: string): Promise<PluginSettingsResponse> {
    return api.get<PluginSettingsResponse>(`/plugins/${name}/settings`);
  },

  /**
   * Update settings for a plugin.
   */
  updateSettings(name: string, settings: Record<string, unknown>): Promise<void> {
    return api.put<void>(`/plugins/${name}/settings`, settings);
  },
};
