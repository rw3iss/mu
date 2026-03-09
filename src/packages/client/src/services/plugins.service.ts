import { api } from './api';

// ============================================
// Types
// ============================================

export type PluginPermission = 'read:movies' | 'write:metadata' | 'network' | 'cache' | 'events';

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
	hasClientEntry?: boolean;
}

export interface PluginSettingsResponse {
	name: string;
	definitions: PluginSettingDefinition[];
	values: Record<string, unknown>;
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
	list(): Promise<PluginInfo[]> {
		return api.get<PluginInfo[]>('/plugins');
	},

	get(name: string): Promise<PluginInfo> {
		return api.get<PluginInfo>(`/plugins/${name}`);
	},

	install(name: string): Promise<void> {
		return api.post<void>(`/plugins/${name}/install`);
	},

	uninstall(name: string): Promise<void> {
		return api.post<void>(`/plugins/${name}/uninstall`);
	},

	enable(name: string): Promise<void> {
		return api.post<void>(`/plugins/${name}/enable`);
	},

	disable(name: string): Promise<void> {
		return api.post<void>(`/plugins/${name}/disable`);
	},

	getSettings(name: string): Promise<PluginSettingsResponse> {
		return api.get<PluginSettingsResponse>(`/plugins/${name}/settings`);
	},

	updateSettings(name: string, settings: Record<string, unknown>): Promise<void> {
		return api.put<void>(`/plugins/${name}/settings`, settings);
	},

	getSchema(name: string): Promise<PluginEndpointSchema> {
		return api.get<PluginEndpointSchema>(`/plugins/${name}/schema`);
	},

	getAllSchemas(): Promise<PluginEndpointSchema[]> {
		return api.get<PluginEndpointSchema[]>('/plugins/schemas/all');
	},
};
