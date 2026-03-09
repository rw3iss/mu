export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface PluginEndpointConfig {
	/** Client-friendly method name (used in generated API client) */
	methodName: string;
	/** HTTP method */
	method: HttpMethod;
	/** Path after /plugins/:pluginId/api/ */
	path: string;
	/** Handler function */
	handler: (params: {
		query: Record<string, string>;
		body: unknown;
		params: Record<string, string>;
	}) => Promise<unknown>;
	/** Optional param schema for codegen */
	schema?: {
		params?: Record<string, 'string' | 'number'>;
		query?: Record<string, 'string' | 'number'>;
		body?: Record<string, unknown>;
		response?: Record<string, unknown>;
	};
}

export interface IPlugin {
	onLoad(context: PluginContext): Promise<void>;
	onUnload(): Promise<void>;
	getInfo(): PluginInfo;
	// Optional lifecycle hooks
	onInstall?(context: PluginContext): Promise<void>;
	onUninstall?(context: PluginContext): Promise<void>;
	onEnable?(context: PluginContext): Promise<void>;
	onDisable?(context: PluginContext): Promise<void>;
}

export interface PluginManifest {
	name: string;
	displayName?: string;
	version: string;
	description: string;
	author?: string;
	entryPoint: string;
	/** Optional client-side entry point (relative to plugin dir) */
	clientEntry?: string;
	permissions: PluginPermission[];
	settings?: PluginSettingDefinition[];
}

export type PluginPermission = 'read:movies' | 'write:metadata' | 'network' | 'cache' | 'events';

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
	api: {
		registerEndpoint(config: PluginEndpointConfig): void;
	};
	getMovies(query?: { limit?: number; offset?: number }): Promise<unknown[]>;
	getMovieById(id: string): Promise<unknown | null>;
	updateMovieMetadata(movieId: string, data: Record<string, unknown>): Promise<void>;
}

export type PluginStatus = 'not_installed' | 'installed' | 'enabled' | 'disabled' | 'error';

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
