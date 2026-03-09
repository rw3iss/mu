export type PluginPermission = 'read:movies' | 'write:metadata' | 'network' | 'cache' | 'events';

export type PluginStatus = 'not_installed' | 'installed' | 'enabled' | 'disabled' | 'error';

export interface PluginManifest {
	name: string;
	displayName?: string;
	version: string;
	description: string;
	author?: string;
	entryPoint: string;
	clientEntry?: string;
	permissions: PluginPermission[];
	settings?: PluginSettingDefinition[];
}

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
	hasClientEntry?: boolean;
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
