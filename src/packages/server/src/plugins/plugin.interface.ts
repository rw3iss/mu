export interface IPlugin {
  onLoad(context: PluginContext): Promise<void>;
  onUnload(): Promise<void>;
  getInfo(): PluginInfo;
}

export interface PluginManifest {
  name: string;
  displayName?: string;
  version: string;
  description: string;
  author?: string;
  entryPoint: string;
  permissions: PluginPermission[];
  settings?: PluginSettingDefinition[];
}

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

export interface PluginContext {
  cache: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
  };
  events: {
    emit(event: string, data: unknown): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
  logger: {
    log(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  };
  config: Record<string, unknown>;
  http: {
    fetch(url: string, options?: RequestInit): Promise<Response>;
  };
  getMovies(query?: { limit?: number; offset?: number }): Promise<unknown[]>;
  getMovieById(id: string): Promise<unknown | null>;
  updateMovieMetadata(
    movieId: string,
    data: Record<string, unknown>,
  ): Promise<void>;
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
