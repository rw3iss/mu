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

export type PluginStatus = 'not_installed' | 'installed' | 'enabled' | 'disabled' | 'error';

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
  status: PluginStatus;
  permissions: PluginPermission[];
  settings?: PluginSettingDefinition[];
}

export interface PluginSettingsResponse {
  name: string;
  definitions: PluginSettingDefinition[];
  values: Record<string, unknown>;
}

export type PluginUiContent =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'badge'; label: string; color?: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'rating'; source: string; value: number; max?: number }
  | { type: 'key-value'; label: string; value: string }
  | { type: 'list'; items: string[] }
  | { type: 'divider' };

export interface PluginUiSlotItem {
  id: string;
  priority?: number;
  content: PluginUiContent[];
}

export interface PluginEndpointSchema {
  pluginName: string;
  basePath: string;
  endpoints: {
    methodName: string;
    method: string;
    path: string;
    schema?: Record<string, unknown>;
  }[];
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
   * Install a plugin.
   */
  install(name: string): Promise<void> {
    return api.post<void>(`/plugins/${name}/install`);
  },

  /**
   * Uninstall a plugin.
   */
  uninstall(name: string): Promise<void> {
    return api.post<void>(`/plugins/${name}/uninstall`);
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

  /**
   * Get the API schema for a plugin (for client codegen).
   */
  getSchema(name: string): Promise<PluginEndpointSchema> {
    return api.get<PluginEndpointSchema>(`/plugins/${name}/schema`);
  },

  /**
   * Get UI slot items from a plugin for a given slot.
   */
  getSlotItems(pluginName: string, slot: string): Promise<PluginUiSlotItem[]> {
    return api.get<PluginUiSlotItem[]>(`/plugins/${pluginName}/ui/${slot}`);
  },
};
