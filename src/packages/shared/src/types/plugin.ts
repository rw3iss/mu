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
}
