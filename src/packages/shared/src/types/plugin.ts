export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissions: PluginPermission[];
  settings?: PluginSettingDefinition[];
  ui?: {
    movieDetails?: { component: string; position: 'before-actions' | 'after-actions' | 'sidebar' };
    dashboard?: { component: string; position: 'widget' };
    settings?: { component: string };
  };
}

export type PluginPermission = 'network' | 'database' | 'filesystem';

export interface PluginSettingDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  options?: { label: string; value: string }[];
  required?: boolean;
}

export type PluginStatus = 'not_installed' | 'installed' | 'enabled' | 'disabled' | 'error';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  hasError?: boolean;
  errorMessage?: string;
  settings?: Record<string, unknown>;
  permissions: PluginPermission[];
  status?: PluginStatus;
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
    schema?: {
      params?: Record<string, 'string' | 'number'>;
      query?: Record<string, 'string' | 'number'>;
      body?: Record<string, unknown>;
      response?: Record<string, unknown>;
    };
  }[];
}
